"""端到端生命周期、OpenAPI 契约与六关模拟数据自动化测试（#37, #42, #43, #44）。"""

from __future__ import annotations

import json
from pathlib import Path

from emc_api.config import Settings
from emc_api.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_openapi_json_is_up_to_date() -> None:
    """确保 docs/openapi.json 与当前 FastAPI 应用导出的 Schema 完全一致（#37）。"""
    settings = Settings(
        _env_file=None,
        env="dev",
        public_origin="https://money.acosx.top",
        database_url="mysql+pymysql://emc:emc@127.0.0.1:3307/ecommerce_money_copilot?charset=utf8mb4",
        session_secret="x" * 48,
    )
    app = create_app(settings)
    expected = app.openapi()
    openapi_path = REPO_ROOT / "docs" / "openapi.json"
    assert openapi_path.is_file()
    actual = json.loads(openapi_path.read_text(encoding="utf-8"))
    assert actual == expected
    for required_path in (
        "/auth/login",
        "/auth/callback",
        "/auth/logout",
        "/api/health",
        "/api/me",
        "/api/projects",
        "/api/artifacts",
        "/api/evidence",
        "/api/verifications",
        "/api/admin/verifications",
    ):
        assert required_path in actual["paths"]


def test_all_six_level_mock_payloads_accepted(client, make_player, login_as) -> None:
    """验证关卡开发者指南中 L1–L6 的六种成果负载均可通过服务端校验（#37）。"""
    login_as(make_player(display_name="六关测试店主"))
    proj = client.post(
        "/api/projects",
        json={"name": "六关全流程项目", "platform": "xiaohongshu", "category": "womenswear"},
    )
    assert proj.status_code == 201
    pid = proj.json()["id"]

    payloads = [
        {
            "artifact_type": "business_plan",
            "schema_version": 1,
            "title": "L1 生意规划：小个子通勤半身裙破零方案",
            "origin": "formal",
            "content": {
                "niche": "小个子高腰A字半身裙",
                "platform": "xiaohongshu",
                "differentiation": "155cm 真人实拍对比 + 不显胯版型筛选",
                "first_order_goal": {"sku_count": 3, "target_price_yuan": 79, "window_days": 14},
            },
        },
        {
            "artifact_type": "product_selection",
            "schema_version": 1,
            "title": "L2 选品落地：四维评估选品单",
            "origin": "formal",
            "content": {
                "items": [
                    {
                        "name": "高腰防走光百褶半身裙",
                        "source_platform": "1688",
                        "target_platform": "xiaohongshu",
                        "supply_price_yuan": 29.5,
                        "retail_price_yuan": 79.0,
                        "scores": {"heat": 88, "competition": 72, "growth": 85, "margin": 84},
                    }
                ]
            },
        },
        {
            "artifact_type": "asset_pack",
            "schema_version": 1,
            "title": "L3 素材优化：首图与详情页素材包",
            "origin": "formal",
            "content": {"sku_name": "高腰防走光百褶半身裙", "image_count": 6},
        },
        {
            "artifact_type": "listing_record",
            "schema_version": 1,
            "title": "L4 自动化上架：商品上架核查记录",
            "origin": "formal",
            "content": {"platform": "xiaohongshu", "platform_item_id": "xhs_001", "sku_count": 3},
        },
        {
            "artifact_type": "content_post",
            "schema_version": 1,
            "title": "L5 内容生成发布：种草笔记发布记录",
            "origin": "formal",
            "content": {
                "platform": "xiaohongshu",
                "post_title": "春季通勤穿搭",
                "manual_checked": True,
            },
        },
        {
            "artifact_type": "data_review",
            "schema_version": 1,
            "title": "L6 数据复盘：首单破零与归因复盘报告",
            "origin": "formal",
            "content": {
                "impressions": 4280,
                "clicks": 386,
                "orders_count": 2,
                "first_order_achieved": True,
            },
        },
    ]

    for item in payloads:
        res = client.post("/api/artifacts", json={"project_id": pid, **item})
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["status"] == "draft"
        assert body["artifact_type"] == item["artifact_type"]


def test_full_e2e_player_and_reviewer_journey(client, make_client, make_player, login_as) -> None:
    """完整端到端闭环（#42, #43, #44）：
    游客匿名态 -> 登录 -> 教学复制草稿（来自教学模拟，不直接通过） -> 修订版本 ->
    上传证据 -> 提交认证（冻结快照） -> 越权隔离校验 -> 审核驳回 -> 玩家修订重提 -> 审核通过。
    """
    # 1. 游客匿名态访问 /api/me 返回 authenticated=false，访问受保护接口返回 401
    me_anon = client.get("/api/me")
    assert me_anon.status_code == 200
    assert me_anon.json() == {"authenticated": False}
    for protected in (
        "/api/projects",
        "/api/artifacts",
        "/api/verifications",
        "/api/admin/verifications",
    ):
        assert client.get(protected).status_code == 401

    # 2. 玩家 A 登录，创建经营项目并将教学模拟成果复制为正式草稿
    player_a = make_player(display_name="玩家A")
    login_as(player_a, test_client=client)

    proj = client.post(
        "/api/projects",
        json={"name": "玩家A女装店", "platform": "xiaohongshu", "category": "womenswear"},
    ).json()

    art_v1 = client.post(
        "/api/artifacts",
        json={
            "project_id": proj["id"],
            "artifact_type": "business_plan",
            "schema_version": 1,
            "title": "L1 练习转正式经营方案",
            "origin": "tutorial_copy",
            "source_level_id": "L1",
            "content": {
                "niche": "通勤半身裙",
                "platform": "xiaohongshu",
                "differentiation": "155cm 小个子高腰实测",
                "first_order_goal": {"sku_count": 2, "target_price_yuan": 69, "window_days": 14},
            },
        },
    )
    assert art_v1.status_code == 201
    art_data = art_v1.json()
    assert art_data["status"] == "draft"
    assert art_data["origin"] == "tutorial_copy"
    assert art_data["origin_label"] == "来自教学模拟"

    # 3. 玩家 A 修订成果（生成 revision 2）
    art_v2 = client.patch(
        f"/api/artifacts/{art_data['id']}",
        json={
            "version": art_data["version"],
            "title": "L1 正式经营方案（补充真实货源）",
            "content": {
                "niche": "通勤半身裙",
                "platform": "xiaohongshu",
                "differentiation": "155cm 小个子高腰实测 + 广州十三行现货",
                "first_order_goal": {"sku_count": 3, "target_price_yuan": 79, "window_days": 10},
            },
        },
    )
    assert art_v2.status_code == 200
    assert art_v2.json()["current_revision"] == 2
    assert art_v2.json()["version"] == 2

    # 4. 上传证据并提交第一次认证申请
    ev1 = client.post(
        "/api/evidence",
        files={"file": ("evidence1.png", PNG_BYTES, "image/png")},
    )
    assert ev1.status_code == 201
    ev1_id = ev1.json()["id"]

    sub1 = client.post(
        "/api/verifications",
        json={
            "artifact_id": art_data["id"],
            "artifact_version": 2,
            "evidence_ids": [ev1_id],
            "note": "首次提交审核",
        },
    )
    assert sub1.status_code == 201
    sub1_id = sub1.json()["id"]
    frozen_snap_1 = sub1.json()["snapshot"]
    assert sub1.json()["status"] == "pending"

    # 5. 玩家 B（普通用户）不能读取玩家 A 的任何资源（404），也不能访问审核接口（403）
    client_b = make_client()
    player_b = make_player(display_name="玩家B", email="b@example.com")
    login_as(player_b, test_client=client_b)
    assert client_b.get(f"/api/projects/{proj['id']}").status_code == 404
    assert client_b.get(f"/api/artifacts/{art_data['id']}").status_code == 404
    assert client_b.get(f"/api/evidence/{ev1_id}/content").status_code == 404
    assert client_b.get(f"/api/verifications/{sub1_id}").status_code == 404
    assert client_b.get("/api/admin/verifications").status_code == 403

    # 6. 审核员驳回第一次申请（附原因）
    client_rev = make_client()
    reviewer = make_player(display_name="审核员", email="reviewer@example.com")
    login_as(reviewer, reviewer=True, test_client=client_rev)

    rej = client_rev.post(
        f"/api/admin/verifications/{sub1_id}/review",
        json={"decision": "rejected", "reason": "请补充真实首单物流单号轨迹截图"},
    )
    assert rej.status_code == 200
    assert rej.json()["status"] == "rejected"

    # 7. 玩家 A 查看驳回原因，修改成果（生成 revision 3）并重新上传证据提交第二次申请
    sub1_view = client.get(f"/api/verifications/{sub1_id}").json()
    assert sub1_view["status"] == "rejected"
    assert sub1_view["reviews"][0]["reason"] == "请补充真实首单物流单号轨迹截图"

    art_after_rej = client.get(f"/api/artifacts/{art_data['id']}").json()
    assert art_after_rej["status"] == "rejected"

    art_v3 = client.patch(
        f"/api/artifacts/{art_data['id']}",
        json={
            "version": art_after_rej["version"],
            "title": "L1 正式经营方案（已补物流凭证）",
            "content": {
                "niche": "通勤半身裙",
                "platform": "xiaohongshu",
                "differentiation": "155cm 小个子高腰实测 + 真实发货单号核验",
                "first_order_goal": {"sku_count": 3, "target_price_yuan": 79, "window_days": 7},
            },
        },
    )
    assert art_v3.status_code == 200
    assert art_v3.json()["current_revision"] == 3

    ev2 = client.post(
        "/api/evidence",
        files={"file": ("evidence2.png", PNG_BYTES, "image/png")},
    ).json()

    sub2 = client.post(
        "/api/verifications",
        json={
            "artifact_id": art_data["id"],
            "artifact_version": art_v3.json()["version"],
            "evidence_ids": [ev2["id"]],
            "note": "已补充物流轨迹截图，再次提交",
        },
    )
    assert sub2.status_code == 201
    sub2_id = sub2.json()["id"]

    # 8. 审核员通过第二次申请；第一次申请的快照保持不可变
    app_res = client_rev.post(
        f"/api/admin/verifications/{sub2_id}/review",
        json={"decision": "approved", "reason": "凭证真实有效，予以通过"},
    )
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "approved"

    final_art = client.get(f"/api/artifacts/{art_data['id']}").json()
    assert final_art["status"] == "approved"
    assert client.get(f"/api/verifications/{sub1_id}").json()["snapshot"] == frozen_snap_1
