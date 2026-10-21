"""会话、/api/me、角色依赖与 CSRF。"""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from emc_api.hashing import sha256_hex
from emc_api.models import SessionRecord
from emc_api.security import (
    CSRF_HEADER,
    SESSION_COOKIE,
    create_session,
    revoke_player_sessions,
    revoke_session,
    set_session_cookie,
)
from emc_api.timeutil import utcnow

from .support import router as support_router


@pytest.fixture
def app(app_factory) -> FastAPI:
    return app_factory(support_router)


def session_row(db_session, id_hash: str) -> SessionRecord:
    db_session.expire_all()
    return db_session.get(SessionRecord, id_hash)


# ---------------------------------------------------------------- /api/me


def test_me_anonymous(client: TestClient) -> None:
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json() == {"authenticated": False}


def test_me_player(client: TestClient, make_player, login_as) -> None:
    player = make_player(display_name="小店主", email="shop@example.com")
    new_session = login_as(player)
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json() == {
        "authenticated": True,
        "player": {"id": player.id, "display_name": "小店主", "email": "shop@example.com"},
        "roles": ["player"],
        "csrf_token": new_session.csrf_token,
    }


def test_me_reviewer(client: TestClient, make_player, login_as) -> None:
    reviewer = make_player()
    login_as(reviewer, reviewer=True)
    assert client.get("/api/me").json()["roles"] == ["player", "reviewer"]


def test_reviewer_role_only_from_server_config(client: TestClient, make_player, login_as) -> None:
    player = make_player()
    login_as(player)
    resp = client.get("/api/me", headers={"X-Role": "reviewer"}, params={"role": "reviewer"})
    assert resp.json()["roles"] == ["player"]


def test_me_with_unknown_or_garbage_cookie(client: TestClient) -> None:
    for value in ("not-a-session", "x" * 500):
        client.cookies.set(SESSION_COOKIE, value)
        assert client.get("/api/me").json() == {"authenticated": False}


# ---------------------------------------------------------------- require_player / reviewer


def test_require_player(client: TestClient, make_player, login_as) -> None:
    assert client.get("/api/_t/private").json()["error"]["code"] == "unauthenticated"
    player = make_player()
    login_as(player)
    assert client.get("/api/_t/private").json() == {"id": player.id}


def test_require_reviewer(client: TestClient, make_client, make_player, login_as) -> None:
    assert client.get("/api/_t/reviewer").status_code == 401

    player = make_player()
    login_as(player)
    resp = client.get("/api/_t/reviewer")
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "forbidden"

    reviewer = make_player()
    other = make_client()
    login_as(reviewer, reviewer=True, test_client=other)
    assert other.get("/api/_t/reviewer").json() == {"id": reviewer.id}


# ---------------------------------------------------------------- 会话存储与过期


def test_session_stores_only_hash(db_session, make_player, settings) -> None:
    player = make_player()
    new_session = create_session(db_session, player, settings)
    db_session.commit()
    assert new_session.id_hash == sha256_hex(new_session.token)
    row = session_row(db_session, new_session.id_hash)
    assert row is not None and row.player_id == player.id
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(SessionRecord)
            .where(SessionRecord.id_hash == new_session.token)
        )
        == 0
    )
    assert row.expires_at - row.created_at == timedelta(seconds=settings.session_absolute_seconds)


def test_session_idle_expiry(client: TestClient, make_player, login_as, settings) -> None:
    player = make_player()
    login_as(player, now=utcnow() - timedelta(seconds=settings.session_idle_seconds + 5))
    assert client.get("/api/me").json() == {"authenticated": False}
    assert client.get("/api/_t/private").status_code == 401


def test_session_just_inside_idle_window(client, make_player, login_as, settings) -> None:
    player = make_player()
    login_as(player, now=utcnow() - timedelta(seconds=settings.session_idle_seconds - 60))
    assert client.get("/api/me").json()["authenticated"] is True


def test_session_absolute_expiry(
    client: TestClient, make_player, login_as, settings, db_session
) -> None:
    player = make_player()
    old = utcnow() - timedelta(seconds=settings.session_absolute_seconds + 5)
    new_session = login_as(player, now=old)
    # 一直活跃（last_seen 很新），仍要在绝对期限后失效
    row = session_row(db_session, new_session.id_hash)
    row.last_seen_at = utcnow()
    db_session.commit()
    assert client.get("/api/me").json() == {"authenticated": False}


def test_absolute_expiry_follows_config(
    client: TestClient, make_player, login_as, settings
) -> None:
    player = make_player()
    login_as(player, now=utcnow() - timedelta(hours=2))
    settings.session_absolute_seconds = 3600
    assert client.get("/api/me").json() == {"authenticated": False}


def test_revoked_session(client: TestClient, make_player, login_as, db_session) -> None:
    player = make_player()
    new_session = login_as(player)
    assert client.get("/api/me").json()["authenticated"] is True
    assert revoke_session(db_session, new_session.id_hash) is True
    db_session.commit()
    assert client.get("/api/me").json() == {"authenticated": False}
    assert client.get("/api/_t/private").status_code == 401
    assert revoke_session(db_session, new_session.id_hash) is False


def test_revoke_player_sessions(client, make_client, make_player, login_as, db_session) -> None:
    player = make_player()
    login_as(player)
    second = make_client()
    login_as(player, test_client=second)
    assert revoke_player_sessions(db_session, player.id) == 2
    db_session.commit()
    assert client.get("/api/me").json() == {"authenticated": False}
    assert second.get("/api/me").json() == {"authenticated": False}


def test_last_seen_touched_after_a_minute(
    client: TestClient, make_player, login_as, db_session
) -> None:
    player = make_player()
    two_minutes_ago = utcnow() - timedelta(minutes=2)
    new_session = login_as(player, now=two_minutes_ago)
    before = utcnow()
    assert client.get("/api/me").json()["authenticated"] is True
    row = session_row(db_session, new_session.id_hash)
    assert row.last_seen_at >= before - timedelta(seconds=1)


def test_last_seen_not_touched_within_a_minute(
    client: TestClient, make_player, login_as, db_session
) -> None:
    player = make_player()
    recent = utcnow() - timedelta(seconds=20)
    new_session = login_as(player, now=recent)
    for _ in range(3):
        assert client.get("/api/me").json()["authenticated"] is True
    assert session_row(db_session, new_session.id_hash).last_seen_at == recent


def test_set_session_cookie_flags(settings) -> None:
    from fastapi import Response

    from emc_api.security import NewSession

    settings.cookie_secure = True
    resp = Response()
    set_session_cookie(
        resp, NewSession(token="tok", id_hash="h", csrf_token="c", expires_at=utcnow()), settings
    )
    cookie = resp.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=tok;")
    for flag in (
        "HttpOnly",
        "Secure",
        "SameSite=lax",
        "Path=/",
        f"Max-Age={settings.session_absolute_seconds}",
    ):
        assert flag.lower() in cookie.lower()


# ---------------------------------------------------------------- CSRF


def post_thing(c: TestClient, **kwargs):
    return c.post("/api/_t/things", json={"name": "店铺"}, **kwargs)


def test_csrf_anonymous_post_is_401(client: TestClient) -> None:
    resp = post_thing(client, headers={"Origin": "http://testserver"})
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "unauthenticated"


def test_csrf_correct(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    assert post_thing(client).status_code == 201


def test_csrf_missing_token(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    del client.headers[CSRF_HEADER]
    resp = post_thing(client)
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "csrf_failed"


def test_csrf_wrong_token(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    resp = post_thing(client, headers={CSRF_HEADER: "wrong-token"})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "csrf_failed"


def test_csrf_token_of_other_session(client, make_client, make_player, login_as) -> None:
    login_as(make_player())
    other_session = login_as(make_player(), test_client=make_client())
    resp = post_thing(client, headers={CSRF_HEADER: other_session.csrf_token})
    assert resp.status_code == 403


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example.com",
        "http://testserver.evil.com",
        "https://testserver",
        "http://testserver:8080",
        "null",
        "",
    ],
)
def test_csrf_wrong_origin(client: TestClient, make_player, login_as, origin: str) -> None:
    login_as(make_player())
    resp = post_thing(client, headers={"Origin": origin})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "csrf_failed"


def test_csrf_origin_default_port_normalized(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    assert post_thing(client, headers={"Origin": "http://TESTSERVER:80"}).status_code == 201


def test_csrf_missing_origin_and_referer(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    del client.headers["Origin"]
    assert post_thing(client).status_code == 403


def test_csrf_referer_fallback(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    del client.headers["Origin"]
    assert (
        post_thing(client, headers={"Referer": "http://testserver/level/2?x=1"}).status_code == 201
    )
    resp = post_thing(client, headers={"Referer": "https://evil.example.com/http://testserver/"})
    assert resp.status_code == 403


def test_csrf_origin_takes_precedence_over_referer(client, make_player, login_as) -> None:
    login_as(make_player())
    resp = post_thing(
        client, headers={"Origin": "https://evil.example.com", "Referer": "http://testserver/"}
    )
    assert resp.status_code == 403


def test_csrf_not_required_for_get(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    del client.headers[CSRF_HEADER]
    del client.headers["Origin"]
    assert client.get("/api/_t/things").status_code == 200


def test_csrf_checked_before_validation(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    resp = client.post("/api/_t/things", json={}, headers={CSRF_HEADER: "wrong"})
    assert resp.status_code == 403
