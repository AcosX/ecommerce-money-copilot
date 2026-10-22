"""小商 3D 数字人伴随 Agent 与六关（L1–L6）成果审核集成测试（#62）。"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from emc_api.security import CSRF_HEADER
from emc_api.services.agent_runtime import (
    build_xingyun_session_payload,
    sign_xingyun_request,
)

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_agent_config_anonymous_and_authenticated(
    client: TestClient, make_player, login_as
) -> None:
    resp = client.get("/api/agent/config")
    assert resp.status_code == 200
    data = resp.json()
    assert (
        data["architecture"]["selected_scheme"]
        == "scheme_3_xingyun_sdk_plus_fastapi_runtime"
    )
    assert data["authenticated"] is False
    assert data["xingyun"]["gateway_server"] == "/api/agent/xingyun/session"
    preset_ids = {p["preset_id"] for p in data["xingyun"]["presets"]}
    assert {"yingyi", "xingya", "huahua"} <= preset_ids
    tool_names = {t["name"] for t in data["tools"]}
    assert {
        "get_player_progress",
        "get_shop_context",
        "get_level_guide",
        "search_game_knowledge",
        "get_artifact_summary",
        "get_review_feedback",
        "open_game_card",
        "save_business_draft",
    } == tool_names

    player = make_player(display_name="小商测试店主")
    login_as(player)
    auth_resp = client.get("/api/agent/config")
    assert auth_resp.status_code == 200
    auth_data = auth_resp.json()
    assert auth_data["authenticated"] is True
    assert auth_data["player"]["id"] == player.id
    assert auth_data["memory"]["player_id"] == player.id
    assert auth_data["progress"]["player_id"] == player.id


def test_xingyun_signature_and_preset_injection_resolves_1008(
    client: TestClient, settings, monkeypatch, make_player, login_as
) -> None:
    from pydantic import SecretStr

    settings.xingyun_app_id = "test_xingyun_app_id"
    settings.xingyun_app_secret = SecretStr("test_xingyun_app_secret")
    payload = build_xingyun_session_payload({"config": {"OS": "Web"}}, preset_id="yingyi")
    cfg = payload["config"]
    assert cfg["look_name"] == "wangyana_V2_14946_new"
    assert cfg["figure_name"] == "SCF25_001"
    assert cfg["mp_service_id"] == "F_CN02_show52"
    assert cfg["tts_vcn_id"] == "XMOV_HN_TTS__43"
    assert cfg["studio_name"] == "jushen_v1_warm_sun_cute_pet_shop_01"

    ts, token = sign_xingyun_request(
        api_path="/user/v1/ttsa/session",
        method="POST",
        payload={"a": 1, "b": 2},
        app_secret="secret123",
        timestamp=1700000000,
    )
    assert ts == "1700000000"
    assert len(token) == 32

    captured: dict[str, Any] = {}

    class DummyResponse:
        def json(self) -> dict[str, Any]:
            return {
                "error_code": 0,
                "error_reason": "",
                "data": {"session_id": "xy_sess_demo_001"},
            }

    class DummyClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> DummyClient:
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def post(self, url: str, *, json: dict[str, Any], headers: dict[str, str]) -> DummyResponse:
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return DummyResponse()

        def request(
            self, method: str, url: str, *, json: dict[str, Any], headers: dict[str, str]
        ) -> DummyResponse:
            captured["stop_method"] = method
            captured["stop_url"] = url
            return DummyResponse()

    monkeypatch.setattr("emc_api.services.agent_runtime.httpx.Client", DummyClient)

    player = make_player()
    login_as(player)
    start_resp = client.post(
        "/api/agent/xingyun/session?preset=xingya",
        json={"config": {"OS": "Web"}},
    )
    assert start_resp.status_code == 200
    assert start_resp.json()["error_code"] == 0
    assert captured["json"]["config"]["look_name"] == "erciyuan_f_001"
    assert "X-TOKEN" in captured["headers"]
    assert "X-APP-ID" in captured["headers"]

    stop_resp = client.request(
        "DELETE",
        "/api/agent/xingyun/session",
        json={"session_id": "xy_sess_demo_001"},
    )
    assert stop_resp.status_code == 200
    assert captured["stop_method"] == "DELETE"


def test_companion_chat_guest_and_authenticated_roi_and_draft(
    client: TestClient, make_player, login_as
) -> None:
    # 1. 游客模式可直接算账与对话（只读陪伴，兼容前端 emc-avatar-agent.js 请求体）
    guest_resp = client.post(
        "/api/agent/chat",
        json={
            "message": "小商，我的宠物饮水机售价 120 元，拿货成本 60 元，帮我算下保本 ROI",
            "current_level": "L2",
            "current_view": "town",
            "mood": 0,
            "preset_id": "yingyi",
            "save_as_draft": False,
        },
    )
    assert guest_resp.status_code == 200
    g_data = guest_resp.json()
    assert g_data["roi_calculation"] is not None
    assert g_data["roi_calculation"]["gross_margin_pct"] == 50.0
    assert g_data["roi_calculation"]["breakeven_roi"] == 2.0
    assert g_data["roi_calculation"]["retail_price_yuan"] == 120.0
    assert g_data["roi_calculation"]["supply_price_yuan"] == 60.0
    assert "score_4d" in g_data["roi_calculation"]
    assert isinstance(g_data["tool_calls"], list)
    assert "<speak>" in g_data["ssml"]
    assert "<ue4event>" in g_data["ssml"]

    # 2. 登录玩家必须通过 CSRF 校验，并支持保存草稿与记忆增长
    player = make_player(display_name="冻干店主")
    login_as(player)

    bad_csrf = client.post(
        "/api/agent/chat",
        json={"message": "你好"},
        headers={CSRF_HEADER: "invalid-csrf"},
    )
    assert bad_csrf.status_code == 403

    chat_resp = client.post(
        "/api/agent/chat",
        json={
            "message": "我在小红书做宠物赛道，请帮我保存草稿：猫咪冻干选品与定位方案",
            "level_id": "L1",
            "preset_id": "yingyi",
        },
    )
    assert chat_resp.status_code == 200
    c_data = chat_resp.json()
    assert c_data["memory"]["preferred_platform"] == "小红书"
    assert c_data["memory"]["preferred_category"] == "宠物"
    assert c_data["memory"]["intimacy_score"] > 25
    assert any(t["tool"] == "save_business_draft" for t in c_data["tool_traces"])
    assert any(a["card_id"] == "formal_drawer" for a in c_data["ui_actions"])

    # 验证保存的成果状态严格为 draft，绝不绕过认证状态机直接置为 approved
    arts = client.get("/api/artifacts").json()["items"]
    assert len(arts) == 1
    assert arts[0]["status"] == "draft"


def test_agent_tool_cross_player_isolation(
    client: TestClient, make_client, make_player, login_as
) -> None:
    player_a = make_player(display_name="店主A")
    player_b = make_player(display_name="店主B")

    client_a = make_client()
    client_b = make_client()
    login_as(player_a, test_client=client_a)
    login_as(player_b, test_client=client_b)

    # 店主 A 通过工具创建 L1 草稿并产生对话记忆
    res_a = client_a.post(
        "/api/agent/tools/execute",
        json={
            "tool_name": "save_business_draft",
            "arguments": {
                "level_id": "L1",
                "title": "店主A的机密定位画布",
                "content": {"goal": "A的独门秘籍"},
            },
        },
    )
    assert res_a.status_code == 200
    artifact_a_id = res_a.json()["result"]["artifact_id"]

    client_a.post("/api/agent/chat", json={"message": "我在抖音做女装高客单"})

    # 店主 B 试图在 arguments 中伪造 player_id / owner_id 或直接传入 artifact_a_id 读取店主 A 的成果
    steal_attempt = client_b.post(
        "/api/agent/tools/execute",
        json={
            "tool_name": "get_artifact_summary",
            "arguments": {
                "player_id": player_a.id,
                "owner_id": player_a.id,
                "artifact_id": artifact_a_id,
            },
        },
    )
    assert steal_attempt.status_code == 404

    # 店主 B 读取自己的记忆，绝不包含店主 A 的对话或偏好
    mem_b = client_b.get("/api/agent/memory").json()
    assert mem_b["memory"]["player_id"] == player_b.id
    assert mem_b["memory"]["preferred_platform"] is None
    assert mem_b["recent_conversation"] == []


def test_ai_deliverable_review_l3_and_cross_player_protection(
    client: TestClient, make_client, make_player, login_as
) -> None:
    owner = make_player(display_name="闯关店主")
    stranger = make_player(display_name="旁观店主")
    reviewer = make_player(display_name="官方审核员")

    c_owner = make_client()
    c_stranger = make_client()
    c_reviewer = make_client()
    login_as(owner, test_client=c_owner)
    login_as(stranger, test_client=c_stranger)
    login_as(reviewer, reviewer=True, test_client=c_reviewer)

    proj = c_owner.post(
        "/api/projects",
        json={
            "name": "小红书萌宠生活馆",
            "platform": "小红书",
            "category": "宠物用品",
            "description": "专注猫咪饮水与喂食",
        },
    ).json()

    art = c_owner.post(
        "/api/artifacts",
        json={
            "project_id": proj["id"],
            "artifact_type": "asset_pack",
            "schema_version": 1,
            "title": "L3 智能宠物饮水机素材包与保本 ROI 测算表",
            "content": {
                "platform": "小红书",
                "selling_price": 100.0,
                "cogs": 45.0,
                "shipping_cost": 5.0,
                "gross_margin_rate": 0.5,
                "breakeven_roi": 2.0,
            },
        },
    ).json()

    ev = c_owner.post(
        "/api/evidence",
        data={"project_id": proj["id"]},
        files={"file": ("profit_sheet.png", PNG_BYTES, "image/png")},
    ).json()

    sub = c_owner.post(
        "/api/verifications",
        json={
            "artifact_id": art["id"],
            "artifact_version": art["version"],
            "evidence_ids": [ev["id"]],
            "note": "已完成 1688 拿样与保本 ROI 核算",
        },
    ).json()

    # 其他玩家无权触发或读取该认证申请的 AI 审核报告
    assert c_stranger.post(f"/api/agent/reviews/{sub['id']}").status_code == 404
    assert c_stranger.get(f"/api/agent/reviews/{sub['id']}").status_code == 404

    # 申请人本人触发小商 AI 预审
    rev_resp = c_owner.post(f"/api/agent/reviews/{sub['id']}")
    assert rev_resp.status_code == 200
    report = rev_resp.json()
    assert report["submission_id"] == sub["id"]
    assert report["level_id"] == "L3"
    assert report["status"] == "approved"
    assert report["score"] >= 85
    assert len(report["evidence_inspected"]) == 1
    assert report["evidence_inspected"][0]["verified_on_disk"] is True
    assert "<speak>" in report["ssml"]

    # 审核员也可直接查看最新 AI 审核结论
    get_resp = c_reviewer.get(f"/api/agent/reviews/{sub['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["has_ai_review"] is True
    assert get_resp.json()["ai_review"]["score"] == report["score"]


def test_openai_compatible_bridge_json_and_sse(client: TestClient) -> None:
    json_resp = client.post(
        "/api/agent/v1/chat/completions",
        json={
            "model": "xiaoshang-agent-v1",
            "stream": False,
            "messages": [{"role": "user", "content": "第二关选品有什么避坑重点？"}],
        },
    )
    assert json_resp.status_code == 200
    payload = json_resp.json()
    assert payload["object"] == "chat.completion"
    assert len(payload["choices"][0]["message"]["content"]) > 10

    sse_resp = client.post(
        "/api/agent/v1/chat/completions",
        json={
            "model": "xiaoshang-agent-v1",
            "stream": True,
            "messages": [{"role": "user", "content": "你好小商"}],
        },
    )
    assert sse_resp.status_code == 200
    assert "data: [DONE]" in sse_resp.text
