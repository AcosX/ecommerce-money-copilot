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


def test_full_e2e_six_submissions_without_reviewer(client, make_player, login_as):
    login_as(make_player())
    project = client.post(
        "/api/projects", json={"name": "六关小店", "platform": "xiaohongshu", "category": "收纳"}
    ).json()
    for kind in (
        "business_plan",
        "product_selection",
        "asset_pack",
        "listing_record",
        "content_post",
        "data_review",
    ):
        art = client.post(
            "/api/artifacts",
            json={
                "project_id": project["id"],
                "artifact_type": kind,
                "schema_version": 1,
                "title": "本关成果",
                "content": {
                    "summary": "真实成果与观察记录，所有未验证数据均保留来源和待补说明。" * 3
                },
            },
        )
        assert art.status_code == 201, art.text
        art = art.json()
        ev = client.post(
            "/api/evidence", files={"file": ("proof.png", PNG_BYTES, "image/png")}
        ).json()
        sub = client.post(
            "/api/verifications",
            json={
                "artifact_id": art["id"],
                "artifact_version": art["version"],
                "evidence_ids": [ev["id"]],
            },
        )
        assert sub.status_code == 201, sub.text
        assert sub.json()["status"] == "approved"
    items = client.get("/api/verifications").json()["items"]
    assert len(items) == 6 and all(item["status"] == "approved" for item in items)
