"""Phase 3 经营项目与正式成果测试（#23、#24、#25、#26、#27、#28）。"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from emc_api.errors import ValidationFailed
from emc_api.hashing import json_sha256
from emc_api.models import (
    AppendOnlyViolation,
    Artifact,
    ArtifactRevision,
    AuditEvent,
    BusinessProject,
)
from emc_api.services import artifact_types
from emc_api.services.artifact_types import (
    ALLOWED_ARTIFACT_TYPES,
    ALLOWED_LEVEL_IDS,
    ARTIFACT_TYPE_TO_LEVEL,
    LEVEL_TO_ARTIFACT_TYPE,
    MAX_CONTENT_BYTES,
    MAX_CONTENT_DEPTH,
    register_artifact_schema,
    validate_artifact_content,
)


def assert_api_error(resp, status: int, code: str) -> dict[str, Any]:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert "error" in body
    err = body["error"]
    assert err["code"] == code
    assert err["request_id"] == resp.headers["X-Request-ID"]
    return err


def count_rows(db: Session, model) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model)) or 0


# ================================================================ 1. 经营项目 (#23, #27, #28)


def test_projects_require_login_and_csrf(client: TestClient, make_player, login_as) -> None:
    assert_api_error(client.get("/api/projects"), 401, "unauthenticated")
    assert_api_error(
        client.post(
            "/api/projects",
            json={"name": "新店"},
            headers={"Origin": "http://testserver"},
        ),
        401,
        "unauthenticated",
    )

    player = make_player()
    login_as(player)
    resp = client.post(
        "/api/projects",
        json={"name": "新店"},
        headers={"X-CSRF-Token": "bad-token"},
    )
    assert_api_error(resp, 403, "csrf_failed")


def test_project_crud_and_audit(
    client: TestClient, make_player, login_as, db_session: Session
) -> None:
    player = make_player()
    login_as(player)

    create_resp = client.post(
        "/api/projects",
        json={
            "name": "  拼多多家居小店  ",
            "platform": " 拼多多 ",
            "category": " 家居日用 ",
            "description": "主营高性价比收纳用品",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    proj = create_resp.json()
    assert proj["id"].startswith("prj_")
    assert proj["owner_id"] == player.id
    assert proj["name"] == "拼多多家居小店"
    assert proj["platform"] == "拼多多"
    assert proj["category"] == "家居日用"
    assert proj["description"] == "主营高性价比收纳用品"
    assert proj["status"] == "active"
    assert proj["version"] == 1
    assert proj["created_at"].endswith("Z")
    assert proj["updated_at"].endswith("Z")

    get_resp = client.get(f"/api/projects/{proj['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json() == proj

    patch_resp = client.patch(
        f"/api/projects/{proj['id']}",
        json={
            "version": 1,
            "name": "拼多多旗舰店",
            "platform": None,
            "status": "archived",
        },
    )
    assert patch_resp.status_code == 200, patch_resp.text
    updated = patch_resp.json()
    assert updated["name"] == "拼多多旗舰店"
    assert updated["platform"] is None
    assert updated["category"] == "家居日用"
    assert updated["status"] == "archived"
    assert updated["version"] == 2

    db_session.expire_all()
    events = db_session.scalars(
        select(AuditEvent)
        .where(AuditEvent.target_type == "project", AuditEvent.target_id == proj["id"])
        .order_by(AuditEvent.id.asc())
    ).all()
    assert [e.action for e in events] == ["project.create", "project.update"]
    assert events[0].actor_player_id == player.id
    assert events[0].details == {"name": "拼多多家居小店"}
    assert events[1].details == {"version": 2}


def test_project_list_pagination_and_status_filter(
    client: TestClient, make_player, login_as
) -> None:
    login_as(make_player())
    ids_created = []
    for i in range(4):
        r = client.post("/api/projects", json={"name": f"项目{i}"})
        assert r.status_code == 201
        ids_created.append(r.json()["id"])

    # 将第一个项目归档
    r_arch = client.patch(
        f"/api/projects/{ids_created[0]}",
        json={"version": 1, "status": "archived"},
    )
    assert r_arch.status_code == 200

    active_list = client.get("/api/projects", params={"status": "active"}).json()
    assert [item["id"] for item in active_list["items"]] == list(reversed(ids_created[1:]))

    archived_list = client.get("/api/projects", params={"status": "archived"}).json()
    assert [item["id"] for item in archived_list["items"]] == [ids_created[0]]

    # 分页遍历全部 4 个项目
    seen: list[str] = []
    cursor = None
    while True:
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = client.get("/api/projects", params=params).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == list(reversed(ids_created))

    assert_api_error(
        client.get("/api/projects", params={"status": "deleted"}), 422, "validation_error"
    )


def test_project_optimistic_lock_and_validation(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    proj = client.post("/api/projects", json={"name": "初始店"}).json()

    # 版本号不匹配 -> 409 version_conflict
    err = assert_api_error(
        client.patch(f"/api/projects/{proj['id']}", json={"version": 99, "name": "并发修改"}),
        409,
        "version_conflict",
    )
    assert err["details"] == {"current_version": 1}

    # 未提供任何可修改字段 -> 422
    assert_api_error(
        client.patch(f"/api/projects/{proj['id']}", json={"version": 1}),
        422,
        "validation_error",
    )
    # name / status 显式传 null -> 422
    assert_api_error(
        client.patch(f"/api/projects/{proj['id']}", json={"version": 1, "name": None}),
        422,
        "validation_error",
    )
    assert_api_error(
        client.patch(f"/api/projects/{proj['id']}", json={"version": 1, "status": None}),
        422,
        "validation_error",
    )
    # 空白名称或超长名称 -> 422
    assert_api_error(client.post("/api/projects", json={"name": "   "}), 422, "validation_error")
    assert_api_error(client.post("/api/projects", json={"name": "x" * 81}), 422, "validation_error")


def test_project_idempotency(
    client: TestClient, make_player, login_as, db_session: Session
) -> None:
    login_as(make_player())
    headers = {"Idempotency-Key": "prj-idem-1"}
    r1 = client.post("/api/projects", json={"name": "幂等店铺"}, headers=headers)
    assert r1.status_code == 201
    assert "Idempotency-Replayed" not in r1.headers

    r2 = client.post("/api/projects", json={"name": "幂等店铺"}, headers=headers)
    assert r2.status_code == 201
    assert r2.headers["Idempotency-Replayed"] == "true"
    assert r2.json() == r1.json()
    assert count_rows(db_session, BusinessProject) == 1

    r3 = client.post("/api/projects", json={"name": "不同店铺"}, headers=headers)
    assert_api_error(r3, 422, "idempotency_key_reuse")


def test_project_cross_player_isolation(
    client: TestClient, make_client, make_player, login_as
) -> None:
    alice = make_player(display_name="Alice")
    bob = make_player(display_name="Bob")
    login_as(alice)
    proj = client.post("/api/projects", json={"name": "Alice的店"}).json()

    bob_client = make_client()
    login_as(bob, test_client=bob_client)

    assert bob_client.get("/api/projects").json() == {"items": [], "next_cursor": None}
    assert_api_error(bob_client.get(f"/api/projects/{proj['id']}"), 404, "not_found")
    assert_api_error(
        bob_client.patch(f"/api/projects/{proj['id']}", json={"version": 1, "name": "篡改"}),
        404,
        "not_found",
    )
    assert_api_error(bob_client.get("/api/projects/bad_id"), 404, "not_found")


# ================================================================ 2. 成果类型与结构校验 (#26)


def test_level_and_artifact_type_mapping() -> None:
    assert LEVEL_TO_ARTIFACT_TYPE == {
        "L1": "business_plan",
        "L2": "product_selection",
        "L3": "asset_pack",
        "L4": "listing_record",
        "L5": "content_post",
        "L6": "data_review",
    }
    assert ARTIFACT_TYPE_TO_LEVEL["business_plan"] == "L1"
    assert ALLOWED_LEVEL_IDS == frozenset({"L1", "L2", "L3", "L4", "L5", "L6"})
    assert len(ALLOWED_ARTIFACT_TYPES) == 6


def test_validate_artifact_content_limits_and_extensions() -> None:
    # 深度刚好为 8 层（根 dict 为第 1 层）允许通过
    d8: dict[str, Any] = {"leaf": "ok"}
    for _ in range(MAX_CONTENT_DEPTH - 1):
        d8 = {"nested": d8}
    assert validate_artifact_content("asset_pack", 1, d8) == d8

    # 深度为 9 层被拒绝
    d9 = {"nested": d8}
    with pytest.raises(ValidationFailed) as excinfo:
        validate_artifact_content("asset_pack", 1, d9)
    assert excinfo.value.details["errors"][0]["loc"] == ["body", "content"]

    # 超过 128 KiB 被拒绝
    huge = {"data": "a" * (MAX_CONTENT_BYTES + 100)}
    with pytest.raises(ValidationFailed) as excinfo2:
        validate_artifact_content("asset_pack", 1, huge)
    assert excinfo2.value.details["errors"][0]["loc"] == ["body", "content"]

    # extensions 必须是 dict
    with pytest.raises(ValidationFailed) as excinfo3:
        validate_artifact_content("asset_pack", 1, {"a": 1, "extensions": "not-a-dict"})
    assert excinfo3.value.details["errors"][0]["loc"] == ["body", "content", "extensions"]

    # 空对象或仅有 extensions 的空内容被拒绝
    for empty_payload in ({}, {"extensions": {"x": 1}}):
        with pytest.raises(ValidationFailed):
            validate_artifact_content("business_plan", 1, empty_payload)

    # business_plan 的数值字段不能为负数或 bool
    with pytest.raises(ValidationFailed):
        validate_artifact_content("business_plan", 1, {"budget": -1})
    with pytest.raises(ValidationFailed):
        validate_artifact_content("business_plan", 1, {"budget": True})
    with pytest.raises(ValidationFailed):
        validate_artifact_content("business_plan", 1, {"positioning": "   "})


def test_dynamic_register_artifact_schema(monkeypatch) -> None:
    class StrictAssetPackV2(BaseModel):
        model_config = ConfigDict(extra="forbid")
        main_image_url: str = Field(min_length=5)
        extensions: dict[str, Any] | None = None

    monkeypatch.setitem(artifact_types._SCHEMA_REGISTRY, ("asset_pack", 2), StrictAssetPackV2)
    register_artifact_schema("asset_pack", 2, StrictAssetPackV2)

    # V1 仍然保持宽松兼容
    assert validate_artifact_content("asset_pack", 1, {"any_field": 123}) == {"any_field": 123}

    # V2 按新注册模型严格校验
    valid_v2 = {"main_image_url": "https://example.com/a.png"}
    assert validate_artifact_content("asset_pack", 2, valid_v2) == valid_v2

    with pytest.raises(ValidationFailed) as excinfo:
        validate_artifact_content("asset_pack", 2, {"main_image_url": "abc"})
    assert excinfo.value.details["errors"][0]["loc"] == ["body", "content", "main_image_url"]


# ================================================================ 3. 正式成果与教学复制 (#24-#28)


def test_create_formal_and_tutorial_copy_artifacts(
    client: TestClient, make_player, login_as, db_session: Session
) -> None:
    player = make_player()
    login_as(player)
    proj = client.post("/api/projects", json={"name": "主营店铺"}).json()

    # 1. 创建正式成果（L1 business_plan）+ 幂等重放
    bp_content = {
        "positioning": "  高性价比宠物智能喂食器  ",
        "platform": "抖音电商",
        "budget": 5000,
        "extensions": {"ai_score": 92},
    }
    idem_headers = {"Idempotency-Key": "art-create-1"}
    r1 = client.post(
        "/api/artifacts",
        json={
            "project_id": proj["id"],
            "artifact_type": "business_plan",
            "schema_version": 1,
            "title": "  2026 Q4 宠物喂食器经营方案  ",
            "content": bp_content,
            "origin": "formal",
        },
        headers=idem_headers,
    )
    assert r1.status_code == 201, r1.text
    art1 = r1.json()
    expected_bp = {
        "positioning": "高性价比宠物智能喂食器",
        "platform": "抖音电商",
        "budget": 5000,
        "extensions": {"ai_score": 92},
    }
    assert art1["id"].startswith("art_")
    assert art1["project_id"] == proj["id"]
    assert art1["owner_id"] == player.id
    assert art1["artifact_type"] == "business_plan"
    assert art1["level_id"] == "L1"
    assert art1["schema_version"] == 1
    assert art1["title"] == "2026 Q4 宠物喂食器经营方案"
    assert art1["status"] == "draft"
    assert art1["origin"] == "formal"
    assert art1["origin_label"] == "正式经营"
    assert art1["source_level_id"] is None
    assert art1["current_revision"] == 1
    assert art1["version"] == 1
    assert art1["content"] == expected_bp
    assert art1["content_sha256"] == json_sha256(expected_bp)

    # 幂等重放返回相同响应且不重复创建
    r1_replay = client.post(
        "/api/artifacts",
        json={
            "project_id": proj["id"],
            "artifact_type": "business_plan",
            "schema_version": 1,
            "title": "  2026 Q4 宠物喂食器经营方案  ",
            "content": bp_content,
            "origin": "formal",
        },
        headers=idem_headers,
    )
    assert r1_replay.status_code == 201
    assert r1_replay.headers["Idempotency-Replayed"] == "true"
    assert r1_replay.json() == art1

    # 2. 从教学模拟复制为正式成果草稿（必须带 source_level_id，且状态固定为 draft）
    ps_content = {
        "category": "宠物用品",
        "items": [{"name": "智能喂食器Pro", "price": 199, "cost": 85}],
    }
    r2 = client.post(
        "/api/artifacts",
        json={
            "project_id": proj["id"],
            "artifact_type": "product_selection",
            "schema_version": 1,
            "title": "L2 练习复制选品单",
            "content": ps_content,
            "origin": "tutorial_copy",
            "source_level_id": "L2",
        },
    )
    assert r2.status_code == 201, r2.text
    art2 = r2.json()
    assert art2["status"] == "draft"
    assert art2["origin"] == "tutorial_copy"
    assert art2["origin_label"] == "来自教学模拟"
    assert art2["source_level_id"] == "L2"
    assert art2["level_id"] == "L2"

    # tutorial_copy 缺少或带非法 source_level_id -> 422
    assert_api_error(
        client.post(
            "/api/artifacts",
            json={
                "project_id": proj["id"],
                "artifact_type": "business_plan",
                "title": "缺少来源关卡",
                "content": {"positioning": "女装"},
                "origin": "tutorial_copy",
            },
        ),
        422,
        "validation_error",
    )
    assert_api_error(
        client.post(
            "/api/artifacts",
            json={
                "project_id": proj["id"],
                "artifact_type": "business_plan",
                "title": "非法来源关卡",
                "content": {"positioning": "女装"},
                "origin": "tutorial_copy",
                "source_level_id": "L99",
            },
        ),
        422,
        "validation_error",
    )

    # 校验审计记录包含来源信息
    db_session.expire_all()
    audit_rows = db_session.scalars(
        select(AuditEvent)
        .where(AuditEvent.action == "artifact.create")
        .order_by(AuditEvent.id.asc())
    ).all()
    assert len(audit_rows) == 2
    assert audit_rows[1].details == {
        "project_id": proj["id"],
        "artifact_type": "product_selection",
        "origin": "tutorial_copy",
        "source_level_id": "L2",
    }


def test_create_artifact_validation_and_archived_project(
    client: TestClient, make_player, login_as
) -> None:
    login_as(make_player())
    proj = client.post("/api/projects", json={"name": "测试店"}).json()

    # L3-L6 受限 JSON 对象均可正常创建
    other_levels = [
        ("L3", "asset_pack"),
        ("L4", "listing_record"),
        ("L5", "content_post"),
        ("L6", "data_review"),
    ]
    for level_id, art_type in other_levels:
        resp = client.post(
            "/api/artifacts",
            json={
                "project_id": proj["id"],
                "artifact_type": art_type,
                "title": f"{level_id} 成果",
                "content": {"data": f"payload-{level_id}"},
            },
        )
        assert resp.status_code == 201
        assert resp.json()["level_id"] == level_id

    # L2 product_selection 结构错误 -> 422
    assert_api_error(
        client.post(
            "/api/artifacts",
            json={
                "project_id": proj["id"],
                "artifact_type": "product_selection",
                "title": "错误选品单",
                "content": {"items": [{"price": 99}]},  # 缺少 name/title/sku
            },
        ),
        422,
        "validation_error",
    )

    # 归档项目不可新增成果 -> 409 invalid_state
    client.patch(f"/api/projects/{proj['id']}", json={"version": 1, "status": "archived"})
    assert_api_error(
        client.post(
            "/api/artifacts",
            json={
                "project_id": proj["id"],
                "artifact_type": "business_plan",
                "title": "归档后新增",
                "content": {"positioning": "测试"},
            },
        ),
        409,
        "invalid_state",
    )


def test_artifact_update_revisions_and_state_machine(
    client: TestClient, make_player, login_as, db_session: Session
) -> None:
    player = make_player()
    login_as(player)
    proj = client.post("/api/projects", json={"name": "版本测试店"}).json()

    created = client.post(
        "/api/artifacts",
        json={
            "project_id": proj["id"],
            "artifact_type": "business_plan",
            "title": "V1标题",
            "content": {"positioning": "第一版方案"},
        },
    ).json()
    art_id = created["id"]

    # 1. 仅修改标题：version 加 1，但 current_revision 仍为 1（不新增重复 revision）
    r_title = client.patch(
        f"/api/artifacts/{art_id}",
        json={"version": 1, "title": "  V2新标题  "},
    )
    assert r_title.status_code == 200
    assert r_title.json()["title"] == "V2新标题"
    assert r_title.json()["version"] == 2
    assert r_title.json()["current_revision"] == 1

    # 1b. 提交与当前相同的 content：version 加 1，但不重复追加 revision
    r_same_content = client.patch(
        f"/api/artifacts/{art_id}",
        json={"version": 2, "content": {"positioning": "第一版方案"}},
    )
    assert r_same_content.status_code == 200
    assert r_same_content.json()["version"] == 3
    assert r_same_content.json()["current_revision"] == 1

    # 2. 修改内容：version 加 1，追加 revision 2
    r_content = client.patch(
        f"/api/artifacts/{art_id}",
        json={"version": 3, "content": {"positioning": "第二版方案", "budget": 3000}},
    )
    assert r_content.status_code == 200
    assert r_content.json()["version"] == 4
    assert r_content.json()["current_revision"] == 2
    assert r_content.json()["content"] == {"positioning": "第二版方案", "budget": 3000}

    # 3. 乐观锁冲突 -> 409 version_conflict
    err = assert_api_error(
        client.patch(f"/api/artifacts/{art_id}", json={"version": 1, "title": "旧版本"}),
        409,
        "version_conflict",
    )
    assert err["details"] == {"current_version": 4}

    # 4. 查看版本历史（按 revision DESC 排序）
    revs_resp = client.get(f"/api/artifacts/{art_id}/revisions")
    assert revs_resp.status_code == 200
    revs = revs_resp.json()["items"]
    assert [r["revision"] for r in revs] == [2, 1]
    assert revs[0]["content"] == {"positioning": "第二版方案", "budget": 3000}
    assert revs[1]["content"] == {"positioning": "第一版方案"}
    assert revs[0]["created_by"] == player.id

    # 5. ArtifactRevision 表只追加（ORM 禁止篡改/删除）
    db_session.expire_all()
    rev_row = db_session.get(ArtifactRevision, (art_id, 1))
    assert rev_row is not None
    rev_row.content = {"positioning": "篡改"}
    with pytest.raises(AppendOnlyViolation):
        db_session.flush()
    db_session.rollback()

    # 6. submitted 与 approved 状态禁止修改 -> 409 invalid_state
    for locked_status in ("submitted", "approved"):
        art_row = db_session.get(Artifact, art_id)
        assert art_row is not None
        art_row.status = locked_status
        db_session.commit()
        assert_api_error(
            client.patch(f"/api/artifacts/{art_id}", json={"version": 4, "title": "试图修改"}),
            409,
            "invalid_state",
        )

    # 7. rejected 状态允许修改，修改后自动回到 draft，生成新 revision 以便重新提交认证
    art_row = db_session.get(Artifact, art_id)
    assert art_row is not None
    art_row.status = "rejected"
    db_session.commit()

    r_reedit = client.patch(
        f"/api/artifacts/{art_id}",
        json={"version": 4, "content": {"positioning": "驳回后修订第三版"}},
    )
    assert r_reedit.status_code == 200
    assert r_reedit.json()["status"] == "draft"
    assert r_reedit.json()["version"] == 5
    assert r_reedit.json()["current_revision"] == 3


def test_artifact_list_filters_and_cross_player_isolation(
    client: TestClient, make_client, make_player, login_as
) -> None:
    alice = make_player(display_name="Alice")
    bob = make_player(display_name="Bob")
    login_as(alice)

    p1 = client.post("/api/projects", json={"name": "店1"}).json()
    p2 = client.post("/api/projects", json={"name": "店2"}).json()

    a1 = client.post(
        "/api/artifacts",
        json={
            "project_id": p1["id"],
            "artifact_type": "business_plan",
            "title": "方案1",
            "content": {"positioning": "A"},
        },
    ).json()
    a2 = client.post(
        "/api/artifacts",
        json={
            "project_id": p2["id"],
            "artifact_type": "data_review",
            "title": "复盘2",
            "content": {"roi": 2.4},
        },
    ).json()

    # 按 project_id 与 artifact_type 过滤
    by_proj = client.get("/api/artifacts", params={"project_id": p1["id"]}).json()
    assert [i["id"] for i in by_proj["items"]] == [a1["id"]]

    by_type = client.get("/api/artifacts", params={"artifact_type": "data_review"}).json()
    assert [i["id"] for i in by_type["items"]] == [a2["id"]]

    # 非法过滤参数 -> 422
    assert_api_error(
        client.get("/api/artifacts", params={"status": "unknown"}), 422, "validation_error"
    )
    assert_api_error(
        client.get("/api/artifacts", params={"artifact_type": "unknown"}), 422, "validation_error"
    )

    # Bob 不能访问或操作 Alice 的项目与成果（统一返回 404 防止枚举）
    bob_client = make_client()
    login_as(bob, test_client=bob_client)

    assert bob_client.get("/api/artifacts").json() == {"items": [], "next_cursor": None}
    assert_api_error(
        bob_client.get("/api/artifacts", params={"project_id": p1["id"]}), 404, "not_found"
    )
    assert_api_error(
        bob_client.post(
            "/api/artifacts",
            json={
                "project_id": p1["id"],
                "artifact_type": "business_plan",
                "title": "越权创建",
                "content": {"positioning": "X"},
            },
        ),
        404,
        "not_found",
    )
    assert_api_error(bob_client.get(f"/api/artifacts/{a1['id']}"), 404, "not_found")
    assert_api_error(
        bob_client.patch(f"/api/artifacts/{a1['id']}", json={"version": 1, "title": "越权修改"}),
        404,
        "not_found",
    )
    assert_api_error(bob_client.get(f"/api/artifacts/{a1['id']}/revisions"), 404, "not_found")
