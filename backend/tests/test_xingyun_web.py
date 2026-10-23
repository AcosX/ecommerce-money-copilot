"""Native Web callback tests against MariaDB: trusted scope, revocation and retry."""

from datetime import timedelta

from emc_api.models import SessionRecord, XingyunWebSession
from emc_api.services import xingyun_web
from emc_api.timeutil import utcnow

ROOT = "/api/agent/xingyun/web-sessions"
BRIDGE = "/api/agent/v1/chat/completions"


def setup_turn(client, message="现在先做什么？", level="L2"):
    response = client.post(ROOT)
    assert response.status_code == 200
    grant = response.json()["id"]
    response = client.post(
        f"{ROOT}/{grant}/turns",
        json={
            "message": message,
            "level_id": level,
            "session_id": "test-project:L2",
            "client_context": {"coaching_mode": True, "current_task": {"id": level}},
        },
    )
    assert response.status_code == 200
    turn = response.json()
    return grant, turn, message + "\n[" + turn["ticket"] + "]"


def callback(client, settings, grant, question, **extra):
    return client.post(
        BRIDGE,
        headers={"Authorization": "Bearer " + xingyun_web.bearer(settings, grant)},
        json={
            "model": "xiaoshang-agent-v1",
            "messages": [{"role": "user", "content": question}],
            **extra,
        },
    )


def test_callback_uses_prepared_identity_context_and_caches_replay(
    client, settings, login_as, make_player, monkeypatch
):
    player = make_player()
    login_as(player)
    grant, turn, question = setup_turn(client)
    calls = []

    def run(db, settings, **kwargs):
        calls.append(kwargs)
        return {
            "reply": "先选一个你熟悉的商品。",
            "spoken_text": "先选一个你熟悉的商品。",
            "provider": "ai_gateway_live",
        }

    monkeypatch.setattr(xingyun_web, "run_companion_chat", run)
    response = callback(
        client, settings, grant, question, player_id="another-player", level_id="L6"
    )
    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "先选一个你熟悉的商品。"
    assert calls[0]["player_id"] == player.id
    assert calls[0]["level_id"] == "L2"
    assert calls[0]["message"] == "现在先做什么？"
    assert calls[0]["session_id"] == "test-project:L2"
    assert calls[0]["client_context"]["coaching_mode"] is True
    assert callback(client, settings, grant, question, stream=True).status_code == 200
    assert len(calls) == 1
    receipt = client.get(f"{ROOT}/{grant}/turns/{turn['id']}").json()
    assert receipt["state"] == "done"
    assert receipt["result"]["provider"] == "ai_gateway_live"
    assert "body" not in receipt
    next_turn = client.post(f"{ROOT}/{grant}/turns", json={"message": "第二条", "level_id": "L3"})
    assert next_turn.status_code == 200
    assert callback(client, settings, grant, question).status_code == 422


def test_owner_receipt_and_prepare_reject_other_login_and_csrf(
    client, settings, login_as, make_player, make_client
):
    login_as(make_player())
    grant, turn, _ = setup_turn(client)
    other = make_client()
    login_as(make_player(), test_client=other)
    assert other.get(f"{ROOT}/{grant}/turns/{turn['id']}").status_code == 404
    assert other.post(f"{ROOT}/{grant}/turns", json={"message": "偷看"}).status_code == 404
    client.headers.pop("X-CSRF-Token")
    assert client.post(ROOT).status_code == 403


def test_callback_rejects_unsigned_unprepared_expired_and_revoked(
    client, settings, db_session, login_as, make_player
):
    login_as(make_player())
    grant, _, question = setup_turn(client)
    assert (
        client.post(BRIDGE, json={"messages": [{"role": "user", "content": question}]}).status_code
        == 401
    )
    assert callback(client, settings, grant, "未在网页确认的问题").status_code == 422
    row = db_session.get(XingyunWebSession, grant)
    row.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert callback(client, settings, grant, question).status_code == 409
    grant, _, question = setup_turn(client)
    row = db_session.get(XingyunWebSession, grant)
    login = db_session.get(SessionRecord, row.session_id_hash)
    login.revoked_at = utcnow()
    db_session.commit()
    assert callback(client, settings, grant, question).status_code == 401


def test_guests_remain_read_only_and_callback_never_gets_browser_selected_owner(
    client, settings, monkeypatch
):
    grant, turn, question = setup_turn(client, message="字" * 2000)
    calls = []

    def run(db, settings, **kwargs):
        calls.append(kwargs)
        return {"reply": "请先说说你的方向", "spoken_text": "请先说说你的方向"}

    monkeypatch.setattr(xingyun_web, "run_companion_chat", run)
    assert callback(client, settings, grant, question).status_code == 200
    assert calls[0]["player_id"] is None
    assert len(calls[0]["message"]) == 2000
    assert client.get(f"{ROOT}/{grant}/turns/{turn['id']}").json()["state"] == "done"


def test_gateway_overrides_browser_brain_and_keeps_capability_server_side(
    client, settings, monkeypatch
):
    grant, _, _ = setup_turn(client)
    calls = []

    def proxy(settings, payload, **kwargs):
        calls.append(payload)
        return {
            "error_code": 0,
            "data": {"session_id": "test", "brain_config": {"api_key": "upstream-echo"}},
        }

    monkeypatch.setattr("emc_api.routers.agent.proxy_xingyun_session", proxy)
    response = client.post(
        "/api/agent/xingyun/e2e-session?grant_id=" + grant,
        json={
            "config": {"sdk_version": "2.4.1", "avatar_id": "not-allowed"},
            "brain_config": {"base_url": "https://attacker.example", "api_key": "client-key"},
        },
    )
    assert response.status_code == 200
    assert calls[0]["brain_config"]["base_url"] == settings.public_origin + "/api/agent/v1"
    assert "api_key" not in response.text and "client-key" not in response.text
    assert "upstream-echo" not in response.text
    assert calls[0]["config"]["sdk_version"] == "2.4.1"
    assert "avatar_id" not in calls[0]["config"]
    assert calls[0]["session_speak_req_id"] == 1


def test_disconnect_revokes_callback_and_expired_receipts_do_not_log_out_player(
    client, settings, login_as, make_player
):
    login_as(make_player())
    grant, _, question = setup_turn(client)
    assert client.delete(f"{ROOT}/{grant}").status_code == 200
    assert callback(client, settings, grant, question).status_code == 409
    assert client.get("/api/me").json()["authenticated"] is True


def test_teardown_cannot_stop_another_upstream_connection(client, settings, monkeypatch):
    grant, _, _ = setup_turn(client)
    stopped = []
    monkeypatch.setattr(
        "emc_api.routers.agent.proxy_xingyun_session",
        lambda *args, **kwargs: {"error_code": 0, "data": {"session_id": "owned-session"}},
    )
    monkeypatch.setattr(
        "emc_api.routers.agent.proxy_xingyun_stop_session",
        lambda *args, **kwargs: stopped.append(args[1]) or {"error_code": 0},
    )
    endpoint = "/api/agent/xingyun/e2e-session?grant_id=" + grant
    assert client.post(endpoint, json={}).status_code == 200
    assert (
        client.request("DELETE", endpoint, json={"session_id": "someone-else"}).status_code == 200
    )
    assert stopped == []
    assert (
        client.request(
            "DELETE", endpoint, json={"session_id": "owned-session", "api_key": "forged"}
        ).status_code
        == 200
    )
    assert stopped[0]["session_id"] == "owned-session"
    assert "api_key" not in stopped[0]


def test_native_generation_does_not_block_receipt_polling(client, settings, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from time import monotonic

    grant, turn, question = setup_turn(client)
    entered, release = Event(), Event()

    def run(db, settings, **kwargs):
        entered.set()
        release.wait(5)
        return {"reply": "完成", "spoken_text": "完成"}

    monkeypatch.setattr(xingyun_web, "run_companion_chat", run)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(callback, client, settings, grant, question)
        try:
            assert entered.wait(3)
            start = monotonic()
            response = client.get(f"{ROOT}/{grant}/turns/{turn['id']}")
            assert monotonic() - start < 2
            assert response.json()["state"] == "processing"
        finally:
            release.set()
        assert future.result(timeout=5).status_code == 200


def test_disconnect_during_generation_suppresses_late_reply(client, settings, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    grant, _, question = setup_turn(client)
    entered, release = Event(), Event()

    def run(db, settings, **kwargs):
        entered.set()
        release.wait(5)
        return {"reply": "不应返回的晚到消息", "spoken_text": "不应返回的晚到消息"}

    monkeypatch.setattr(xingyun_web, "run_companion_chat", run)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(callback, client, settings, grant, question)
        try:
            assert entered.wait(3)
            assert client.delete(f"{ROOT}/{grant}").status_code == 200
        finally:
            release.set()
        assert future.result(timeout=5).status_code == 409
