"""阶段 4 测试：证据上传/受控下载、认证状态机、快照冻结、人工审核、越权与防篡改（#29–#35）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from emc_api import ids
from emc_api.config import Settings
from emc_api.errors import NotFound
from emc_api.hashing import json_sha256, sha256_hex
from emc_api.models import (
    AppendOnlyViolation,
    Artifact,
    ArtifactRevision,
    AuditEvent,
    BusinessProject,
    EvidenceFile,
    Player,
    VerificationReview,
)
from emc_api.services.storage import read_evidence_file
from emc_api.timeutil import utcnow

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
)
JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
WEBP_BYTES = (
    b"RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00\x30\x01\x00\x9d\x01\x2a\x01\x00\x01\x00\x00\x00"
)
PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"


def assert_error(resp, status: int, code: str) -> dict[str, Any]:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"}
    err = body["error"]
    assert err["code"] == code
    assert err["request_id"] == resp.headers["X-Request-ID"]
    return err


def create_project_and_artifact(
    db_session: Session,
    owner: Player,
    *,
    title: str = "Q4 抖音女装选品单",
    artifact_type: str = "product_selection",
    schema_version: int = 1,
    origin: str = "formal",
    source_level_id: str | None = None,
    content: dict[str, Any] | None = None,
) -> Artifact:
    now = utcnow()
    project = BusinessProject(
        id=ids.new_id(ids.PROJECT),
        owner_id=owner.id,
        name="女装主营店",
        platform="抖音电商",
        category="服饰内衣",
        description="测试经营项目",
        status="active",
        version=1,
        created_at=now,
        updated_at=now,
    )
    db_session.add(project)
    db_session.flush()

    payload = content or {
        "target_platform": "抖音电商",
        "items": [{"sku": "SKU-001", "price": 99.0, "margin": 0.42}],
    }
    artifact = Artifact(
        id=ids.new_id(ids.ARTIFACT),
        project_id=project.id,
        owner_id=owner.id,
        artifact_type=artifact_type,
        schema_version=schema_version,
        title=title,
        status="draft",
        origin=origin,
        source_level_id=source_level_id,
        current_revision=1,
        version=1,
        created_at=now,
        updated_at=now,
    )
    db_session.add(artifact)
    db_session.flush()

    rev = ArtifactRevision(
        artifact_id=artifact.id,
        revision=1,
        content=payload,
        content_sha256=json_sha256(payload),
        created_by=owner.id,
        created_at=now,
    )
    db_session.add(rev)
    db_session.commit()
    return artifact


def add_artifact_revision(
    db_session: Session,
    artifact: Artifact,
    *,
    title: str,
    content: dict[str, Any],
) -> Artifact:
    """模拟玩家在驳回后修改成果内容并生成新 revision（回到 draft）。"""
    now = utcnow()
    next_rev = artifact.current_revision + 1
    rev = ArtifactRevision(
        artifact_id=artifact.id,
        revision=next_rev,
        content=content,
        content_sha256=json_sha256(content),
        created_by=artifact.owner_id,
        created_at=now,
    )
    db_session.add(rev)
    artifact.title = title
    artifact.status = "draft"
    artifact.current_revision = next_rev
    artifact.version += 1
    artifact.updated_at = now
    db_session.commit()
    return artifact


def upload_sample_evidence(
    client: TestClient,
    *,
    filename: str = "order_proof.png",
    data: bytes = PNG_BYTES,
    content_type: str = "image/png",
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    resp = client.post(
        "/api/evidence",
        files={"file": (filename, data, content_type)},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------- #31 证据附件上传与受控下载


@pytest.mark.parametrize(
    ("filename", "payload", "client_mime", "expected_mime"),
    [
        ("screen.png", PNG_BYTES, "image/png", "image/png"),
        ("photo.jpg", JPEG_BYTES, "image/jpeg", "image/jpeg"),
        ("banner.webp", WEBP_BYTES, "image/webp", "image/webp"),
        ("invoice.pdf", PDF_BYTES, "application/pdf", "application/pdf"),
        # 扩展名与客户端 Content-Type 均伪装成二进制，但魔数为 PNG：按真实文件头识别
        ("disguised.bin", PNG_BYTES, "application/octet-stream", "image/png"),
    ],
)
def test_evidence_upload_supported_formats(
    client: TestClient,
    settings: Settings,
    db_session: Session,
    make_player,
    login_as,
    filename: str,
    payload: bytes,
    client_mime: str,
    expected_mime: str,
) -> None:
    player = make_player()
    login_as(player)

    resp = client.post(
        "/api/evidence",
        files={"file": (filename, payload, client_mime)},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert ids.has_prefix(body["id"], ids.EVIDENCE)
    assert body["owner_id"] == player.id
    assert body["submission_id"] is None
    assert body["content_type"] == expected_mime
    assert body["size_bytes"] == len(payload)
    assert body["sha256"] == sha256_hex(payload)
    assert body["download_url"] == f"/api/evidence/{body['id']}/content"

    ev = db_session.get(EvidenceFile, body["id"])
    assert ev is not None
    disk_path = read_evidence_file(settings, ev.storage_key)
    assert disk_path.read_bytes() == payload
    assert disk_path.is_relative_to(Path(settings.upload_dir).resolve())

    audit = db_session.scalars(
        select(AuditEvent).where(
            AuditEvent.action == "evidence.upload",
            AuditEvent.target_id == body["id"],
        )
    ).one()
    assert audit.actor_player_id == player.id
    assert audit.details["sha256"] == sha256_hex(payload)


@pytest.mark.parametrize(
    ("fake_name", "fake_bytes", "fake_mime"),
    [
        ("evil.png", b"<script>alert(1)</script>", "image/png"),
        ("vector.png", b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/png"),
        ("prog.pdf", b"MZ\x90\x00\x03\x00\x00\x00", "application/pdf"),
        ("fake_webp.webp", b"RIFF\x10\x00\x00\x00WAVEfmt ", "image/webp"),
        ("text.jpg", b"plain text disguised as jpeg", "image/jpeg"),
    ],
)
def test_evidence_upload_rejects_spoofed_magic_bytes(
    client: TestClient,
    make_player,
    login_as,
    fake_name: str,
    fake_bytes: bytes,
    fake_mime: str,
) -> None:
    login_as(make_player())
    resp = client.post(
        "/api/evidence",
        files={"file": (fake_name, fake_bytes, fake_mime)},
    )
    assert_error(resp, 415, "unsupported_media_type")


def test_evidence_upload_size_and_multipart_validation(
    client: TestClient,
    settings: Settings,
    make_player,
    login_as,
) -> None:
    login_as(make_player())

    # 非 multipart/form-data 请求
    resp = client.post("/api/evidence", json={"file": "not-multipart"})
    assert_error(resp, 422, "validation_error")

    # 缺少 file 字段
    resp = client.post("/api/evidence", files={"other": ("a.png", PNG_BYTES, "image/png")})
    assert_error(resp, 422, "validation_error")

    # 多个 file 字段
    resp = client.post(
        "/api/evidence",
        files=[
            ("file", ("a.png", PNG_BYTES, "image/png")),
            ("file", ("b.png", PNG_BYTES, "image/png")),
        ],
    )
    assert_error(resp, 422, "validation_error")

    # 空文件
    resp = client.post("/api/evidence", files={"file": ("empty.png", b"", "image/png")})
    assert_error(resp, 422, "validation_error")

    # 超过 max_upload_bytes
    settings.max_upload_bytes = 128
    oversized = PNG_BYTES + b"\x00" * 200
    resp = client.post("/api/evidence", files={"file": ("big.png", oversized, "image/png")})
    assert_error(resp, 413, "payload_too_large")


def test_evidence_filename_sanitization_and_idempotency(
    client: TestClient,
    db_session: Session,
    make_player,
    login_as,
) -> None:
    login_as(make_player())

    ev1 = upload_sample_evidence(
        client,
        filename=r"..\..\etc\passwd;evil" + ("a" * 240) + ".png",
        data=PNG_BYTES,
        headers={"Idempotency-Key": "ev-idem-1"},
    )
    assert "/" not in ev1["original_filename"]
    assert "\\" not in ev1["original_filename"]
    assert ".." not in ev1["original_filename"].split(".")[0]
    assert len(ev1["original_filename"]) <= 200

    # 同一幂等键 + 相同文件 → 重放首次结果
    replay = client.post(
        "/api/evidence",
        files={"file": (r"..\..\etc\passwd;evil" + ("a" * 240) + ".png", PNG_BYTES, "image/png")},
        headers={"Idempotency-Key": "ev-idem-1"},
    )
    assert replay.status_code == 201
    assert replay.headers.get("Idempotency-Replayed") == "true"
    assert replay.json()["id"] == ev1["id"]
    assert db_session.query(EvidenceFile).count() == 1

    # 同一幂等键 + 不同文件内容 → 422 idempotency_key_reuse
    reuse = client.post(
        "/api/evidence",
        files={"file": ("other.pdf", PDF_BYTES, "application/pdf")},
        headers={"Idempotency-Key": "ev-idem-1"},
    )
    assert_error(reuse, 422, "idempotency_key_reuse")


def test_evidence_download_permissions_and_path_traversal(
    client: TestClient,
    make_client,
    settings: Settings,
    make_player,
    login_as,
) -> None:
    owner = make_player(display_name="卖家甲")
    other_player = make_player(display_name="卖家乙")
    reviewer = make_player(display_name="官方审核员")

    login_as(owner)
    ev = upload_sample_evidence(client, filename="后台订单截图.png", data=PNG_BYTES)

    # 本人可下载，带安全响应头
    dl_owner = client.get(ev["download_url"])
    assert dl_owner.status_code == 200
    assert dl_owner.content == PNG_BYTES
    assert dl_owner.headers["content-type"] == "image/png"
    assert "attachment" in dl_owner.headers["content-disposition"]
    assert dl_owner.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in dl_owner.headers["cache-control"]

    # 其他普通玩家访问返回 404（防枚举）
    other_client = make_client()
    login_as(other_player, test_client=other_client)
    dl_other = other_client.get(ev["download_url"])
    assert_error(dl_other, 404, "not_found")

    # 审核员可下载任意玩家的证据附件
    reviewer_client = make_client()
    login_as(reviewer, reviewer=True, test_client=reviewer_client)
    dl_rev = reviewer_client.get(ev["download_url"])
    assert dl_rev.status_code == 200
    assert dl_rev.content == PNG_BYTES

    # 未登录游客返回 401
    guest_client = make_client()
    assert_error(guest_client.get(ev["download_url"]), 401, "unauthenticated")

    # 格式非法或不存在的 ID 返回 404
    assert_error(client.get("/api/evidence/bad_id/content"), 404, "not_found")
    assert_error(client.get(f"/api/evidence/{ids.new_id(ids.EVIDENCE)}/content"), 404, "not_found")

    # 路径穿越防护
    for bad_key in ("../secret.txt", "/etc/passwd", "2026/10/../../outside.png", ""):
        with pytest.raises(NotFound):
            read_evidence_file(settings, bad_key)


# -------------------------------------------------------- #29 #30 #32 #33 状态机与人工审核闭环


def test_full_verification_lifecycle_reject_revise_resubmit_approve(
    client: TestClient,
    make_client,
    db_session: Session,
    make_player,
    login_as,
) -> None:
    player = make_player(display_name="创业店主")
    reviewer = make_player(display_name="审核组长")
    login_as(player)

    rev1_content = {
        "target_platform": "拼多多",
        "items": [{"sku": "PDD-101", "price": 39.9, "margin": 0.35}],
    }
    artifact = create_project_and_artifact(
        db_session,
        player,
        title="拼多多日用百货选品方案 v1",
        origin="tutorial_copy",
        source_level_id="L2",
        content=rev1_content,
    )

    ev1 = upload_sample_evidence(client, filename="supplier_quote.png", data=PNG_BYTES)
    ev2 = upload_sample_evidence(client, filename="margin_sheet.pdf", data=PDF_BYTES)

    # 1. 提交认证申请（附幂等键）
    submit_resp = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [ev1["id"], ev2["id"]],
            "note": "已完成供应商核价与毛利测算",
        },
        headers={"Idempotency-Key": "sub-1"},
    )
    assert submit_resp.status_code == 201, submit_resp.text
    sub1 = submit_resp.json()
    assert ids.has_prefix(sub1["id"], ids.VERIFICATION)
    assert sub1["status"] == "pending"
    assert sub1["method"] == "agent_review"
    assert sub1["artifact_revision"] == 1
    assert sub1["rejection_reason"] is None
    assert sub1["evidence_count"] == 2
    assert [e["id"] for e in sub1["evidence"]] == [ev1["id"], ev2["id"]]
    assert sub1["snapshot"] == {
        "artifact_id": artifact.id,
        "project_id": artifact.project_id,
        "artifact_type": "product_selection",
        "schema_version": 1,
        "title": "拼多多日用百货选品方案 v1",
        "origin": "tutorial_copy",
        "source_level_id": "L2",
        "revision": 1,
        "content": rev1_content,
        "content_sha256": json_sha256(rev1_content),
    }
    assert sub1["snapshot_sha256"] == json_sha256(sub1["snapshot"])

    # 幂等重放返回同一申请
    replay = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [ev1["id"], ev2["id"]],
            "note": "已完成供应商核价与毛利测算",
        },
        headers={"Idempotency-Key": "sub-1"},
    )
    assert replay.status_code == 201
    assert replay.headers.get("Idempotency-Replayed") == "true"
    assert replay.json()["id"] == sub1["id"]

    # 成果已变为 submitted，再次发起新申请返回 409 invalid_state
    ev_extra = upload_sample_evidence(client, filename="extra.jpg", data=JPEG_BYTES)
    dup_submit = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 2,
            "evidence_ids": [ev_extra["id"]],
        },
    )
    assert_error(dup_submit, 409, "invalid_state")

    # 2. 审核员在后台查看待审核列表并执行驳回
    rev_client = make_client()
    login_as(reviewer, reviewer=True, test_client=rev_client)

    pending_list = rev_client.get("/api/admin/verifications", params={"status": "pending"}).json()
    assert [i["id"] for i in pending_list["items"]] == [sub1["id"]]
    assert pending_list["items"][0]["owner_display_name"] == "创业店主"

    # 驳回时未填原因 → 422 validation_error
    no_reason = rev_client.post(
        f"/api/admin/verifications/{sub1['id']}/review",
        json={"decision": "rejected", "reason": "   "},
    )
    assert_error(no_reason, 422, "validation_error")

    reject_resp = rev_client.post(
        f"/api/admin/verifications/{sub1['id']}/review",
        json={"decision": "rejected", "reason": "请补充 1688 真实拿货凭证截图"},
        headers={"Idempotency-Key": "rev-decision-1"},
    )
    assert reject_resp.status_code == 200, reject_resp.text
    rejected_sub = reject_resp.json()
    assert rejected_sub["status"] == "rejected"
    assert rejected_sub["decided_at"] is not None
    assert rejected_sub["rejection_reason"] == "请补充 1688 真实拿货凭证截图"
    assert len(rejected_sub["reviews"]) == 1
    assert rejected_sub["reviews"][0]["decision"] == "rejected"
    assert rejected_sub["reviews"][0]["reviewer_id"] == reviewer.id

    # 审核幂等重放
    reject_replay = rev_client.post(
        f"/api/admin/verifications/{sub1['id']}/review",
        json={"decision": "rejected", "reason": "请补充 1688 真实拿货凭证截图"},
        headers={"Idempotency-Key": "rev-decision-1"},
    )
    assert reject_replay.status_code == 200
    assert reject_replay.headers.get("Idempotency-Replayed") == "true"

    # 玩家查询本人申请详情与列表，看到驳回原因与历史记录
    my_detail = client.get(f"/api/verifications/{sub1['id']}")
    assert my_detail.status_code == 200
    assert my_detail.json()["status"] == "rejected"
    assert my_detail.json()["rejection_reason"] == "请补充 1688 真实拿货凭证截图"

    my_list = client.get("/api/verifications", params={"status": "rejected"}).json()
    assert [i["id"] for i in my_list["items"]] == [sub1["id"]]

    # 3. 玩家修改成果生成 revision 2，但第一次申请的快照必须保持不可变
    db_session.expire_all()
    art_db = db_session.get(Artifact, artifact.id)
    assert art_db is not None and art_db.status == "rejected" and art_db.version == 3

    rev2_content = {
        "target_platform": "拼多多",
        "items": [{"sku": "PDD-101", "price": 39.9, "margin": 0.40, "supplier_verified": True}],
    }
    add_artifact_revision(
        db_session,
        art_db,
        title="拼多多日用百货选品方案 v2（含拿货凭证）",
        content=rev2_content,
    )

    # 旧申请快照仍为 revision 1 的内容与哈希
    old_check = client.get(f"/api/verifications/{sub1['id']}").json()
    assert old_check["artifact_revision"] == 1
    assert old_check["snapshot"]["title"] == "拼多多日用百货选品方案 v1"
    assert old_check["snapshot"]["content"] == rev1_content
    assert old_check["snapshot_sha256"] == sub1["snapshot_sha256"]

    # 旧证据已绑定 sub1，不能复用
    reuse_ev = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 4,
            "evidence_ids": [ev1["id"]],
        },
    )
    assert_error(reuse_ev, 409, "invalid_state")

    # 4. 上传新证据并再次提交 revision 2
    ev3 = upload_sample_evidence(client, filename="1688_order.webp", data=WEBP_BYTES)
    submit2_resp = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 4,
            "evidence_ids": [ev3["id"]],
            "note": "已补充 1688 真实订单凭证",
        },
    )
    assert submit2_resp.status_code == 201, submit2_resp.text
    sub2 = submit2_resp.json()
    assert sub2["id"] != sub1["id"]
    assert sub2["artifact_revision"] == 2
    assert sub2["snapshot"]["revision"] == 2
    assert sub2["snapshot"]["content"] == rev2_content
    assert sub2["status"] == "pending"

    # 5. 审核员通过第二次申请
    approve_resp = rev_client.post(
        f"/api/admin/verifications/{sub2['id']}/review",
        json={"decision": "approved", "reason": "拿货凭证与毛利测算一致，予以通过"},
    )
    assert approve_resp.status_code == 200, approve_resp.text
    approved_sub = approve_resp.json()
    assert approved_sub["status"] == "approved"
    assert approved_sub["rejection_reason"] is None
    assert len(approved_sub["reviews"]) == 1
    assert approved_sub["reviews"][0]["decision"] == "approved"

    db_session.expire_all()
    art_final = db_session.get(Artifact, artifact.id)
    assert art_final is not None
    assert art_final.status == "approved"
    assert art_final.version == 6

    # 已通过成果不允许再次提交认证
    ev4 = upload_sample_evidence(client, filename="another.png", data=PNG_BYTES)
    resubmit_approved = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 6,
            "evidence_ids": [ev4["id"]],
        },
    )
    assert_error(resubmit_approved, 409, "invalid_state")


# ---------------------------------------------------------------- #30 #34 #35 边界、越权与防篡改


def test_verification_submit_validation_and_version_conflict(
    client: TestClient,
    make_client,
    settings: Settings,
    db_session: Session,
    make_player,
    login_as,
) -> None:
    player = make_player()
    other = make_player()
    login_as(player)

    artifact = create_project_and_artifact(db_session, player)
    ev1 = upload_sample_evidence(client, filename="1.png", data=PNG_BYTES)

    # 乐观锁版本不一致 → 409 version_conflict
    conflict = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 99,
            "evidence_ids": [ev1["id"]],
        },
    )
    err = assert_error(conflict, 409, "version_conflict")
    assert err["details"] == {"current_version": 1}

    # 重复证据 ID → 422 validation_error
    dup_ev = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [ev1["id"], ev1["id"]],
        },
    )
    assert_error(dup_ev, 422, "validation_error")

    # 超过单次申请附件数量上限 → 422 validation_error
    settings.max_files_per_submission = 2
    ev2 = upload_sample_evidence(client, filename="2.png", data=PNG_BYTES)
    ev3 = upload_sample_evidence(client, filename="3.png", data=PNG_BYTES)
    too_many = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [ev1["id"], ev2["id"], ev3["id"]],
        },
    )
    assert_error(too_many, 422, "validation_error")

    # 引用他人证据或他人成果 → 404 not_found
    other_client = make_client()
    login_as(other, test_client=other_client)
    other_ev = upload_sample_evidence(other_client, filename="other.png", data=PNG_BYTES)

    cross_ev = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [other_ev["id"]],
        },
    )
    assert_error(cross_ev, 404, "not_found")

    cross_art = other_client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [other_ev["id"]],
        },
    )
    assert_error(cross_art, 404, "not_found")


def test_reviewer_authorization_self_review_and_append_only_guards(
    client: TestClient,
    make_client,
    db_session: Session,
    make_player,
    login_as,
) -> None:
    # 既是卖家又是审核员的账号，用于测试禁止自审（#34）
    reviewer_seller = make_player(display_name="兼职店主审核员")
    other_reviewer = make_player(display_name="独立审核员")
    normal_player = make_player(display_name="普通买家")

    login_as(reviewer_seller, reviewer=True)
    artifact = create_project_and_artifact(db_session, reviewer_seller)
    ev = upload_sample_evidence(client, filename="self.png", data=PNG_BYTES)
    sub = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": 1,
            "evidence_ids": [ev["id"]],
        },
    ).json()

    # 1. 普通玩家访问任何 /api/admin/* 接口均返回 403 forbidden（即使伪造请求头）
    normal_client = make_client()
    login_as(normal_player, reviewer=False, test_client=normal_client)
    normal_client.headers["X-Role"] = "reviewer"

    assert_error(normal_client.get("/api/admin/verifications"), 403, "forbidden")
    assert_error(normal_client.get(f"/api/admin/verifications/{sub['id']}"), 403, "forbidden")
    assert_error(
        normal_client.post(
            f"/api/admin/verifications/{sub['id']}/review",
            json={"decision": "approved"},
        ),
        403,
        "forbidden",
    )
    # 普通玩家也不能通过玩家端详情接口偷看他人申请
    assert_error(normal_client.get(f"/api/verifications/{sub['id']}"), 404, "not_found")

    # 2. 审核员不能审核本人提交的申请 → 403 forbidden
    self_review = client.post(
        f"/api/admin/verifications/{sub['id']}/review",
        json={"decision": "approved", "reason": "自己给自己过"},
    )
    assert_error(self_review, 403, "forbidden")

    # 3. 独立审核员通过审核
    rev2_client = make_client()
    login_as(other_reviewer, reviewer=True, test_client=rev2_client)
    ok_resp = rev2_client.post(
        f"/api/admin/verifications/{sub['id']}/review",
        json={"decision": "approved", "reason": "材料真实有效"},
    )
    assert ok_resp.status_code == 200

    # 4. 已完成审核的申请不能再次审核 → 409 invalid_state
    repeat_review = rev2_client.post(
        f"/api/admin/verifications/{sub['id']}/review",
        json={"decision": "rejected", "reason": "试图反悔修改结果"},
    )
    assert_error(repeat_review, 409, "invalid_state")

    # 5. VerificationReview 与 AuditEvent 只追加不可修改/删除（#35）
    review_row = db_session.scalars(
        select(VerificationReview).where(VerificationReview.submission_id == sub["id"])
    ).one()
    review_row.decision = "rejected"
    with pytest.raises(AppendOnlyViolation):
        db_session.flush()
    db_session.rollback()

    review_row = db_session.scalars(
        select(VerificationReview).where(VerificationReview.submission_id == sub["id"])
    ).one()
    db_session.delete(review_row)
    with pytest.raises(AppendOnlyViolation):
        db_session.flush()
    db_session.rollback()

    # 校验完整审计链路已落库
    actions = list(
        db_session.scalars(select(AuditEvent.action).order_by(AuditEvent.id.asc())).all()
    )
    assert actions == ["evidence.upload", "verification.submit", "verification.review"]


def test_admin_ui_and_openapi_routes(client: TestClient) -> None:
    for path in ("/admin", "/admin/"):
        resp = client.get(path)
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        assert resp.headers["cache-control"] == "no-store"
        assert "正式成果人工审核工作台" in resp.text

    openapi = client.get("/api/openapi.json")
    assert openapi.status_code == 200
    paths = openapi.json()["paths"]
    assert "/api/evidence" in paths
    assert "/api/evidence/{evidence_id}/content" in paths
    assert "/api/verifications" in paths
    assert "/api/verifications/{submission_id}" in paths
    assert "/api/admin/verifications" in paths
    assert "/api/admin/verifications/{submission_id}" in paths
    assert "/api/admin/verifications/{submission_id}/review" in paths


@pytest.mark.parametrize(
    "artifact_type,report,expected",
    [
        (
            "business_plan",
            "预算两千元，每周十小时，现有家居货源，面向租房青年做桌下收纳。先在小红书观察需求与竞争，再比较三款样品并验证毛利与履约成本。",
            201,
        ),
        ("business_plan", "还没聊清楚", 422),
        (
            "data_review",
            "近七天没有订单，来源为店铺后台。曝光不足仍是假设，下一步逐日记录曝光和点击，先测试一版主图，连续观察七天再比较。",
            201,
        ),
        ("asset_pack", "优化前后图片应该真实提交，文字不能代替视觉证据。" * 3, 422),
        (
            "product_selection",
            "明确目标人群、选择理由、来源、预算、利润以及下一步验证办法。" * 3,
            201,
        ),
    ],
)
def test_text_reports_without_duplicate_attachment(
    client, db_session, make_player, login_as, artifact_type, report, expected
):
    player = make_player()
    login_as(player)
    artifact = create_project_and_artifact(
        db_session,
        player,
        artifact_type=artifact_type,
        content={"planning_report": report, "platform": "小红书", "category": "家居收纳"},
    )
    response = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact.id,
            "artifact_version": artifact.version,
            "evidence_ids": [],
        },
    )
    assert response.status_code == expected, response.text
    if expected == 201:
        data = response.json()
        assert data["status"] == "pending"
        assert data["snapshot"]["content"]["planning_report"] == report
        replay = client.get("/api/verifications/" + data["id"])
        assert replay.status_code == 200
        assert replay.json()["snapshot"]["content"]["planning_report"] == report


def test_long_conversation_plan_uses_real_artifact_schema(
    client, db_session, make_player, login_as
):
    player = make_player()
    login_as(player)
    seed = create_project_and_artifact(db_session, player)
    report = (
        "预算两千元，每周十小时，有家居货源。面向租房青年经营小红书桌下收纳，记录需求、竞争、毛利与履约成本。\n"
        * 120
    )
    response = client.post(
        "/api/artifacts",
        json={
            "project_id": seed.project_id,
            "artifact_type": "business_plan",
            "schema_version": 1,
            "title": "小红书收纳生意规划",
            "origin": "formal",
            "source_level_id": "L1",
            "content": {
                "summary": report[:1000],
                "planning_report": report,
                "conversation": [
                    {"role": "user", "text": "预算两千元"},
                    {"role": "assistant", "text": report[:4000]},
                ],
                "platform": "xiaohongshu",
                "category": "家居收纳",
            },
        },
    )
    assert response.status_code == 201, response.text
    artifact = response.json()
    submitted = client.post(
        "/api/verifications",
        json={
            "artifact_id": artifact["id"],
            "artifact_version": artifact["version"],
            "evidence_ids": [],
        },
    )
    assert submitted.status_code == 201, submitted.text
    data = submitted.json()
    assert data["snapshot"]["content"]["planning_report"] == report
    review = client.post("/api/agent/reviews/" + data["id"], json={})
    assert review.status_code == 503  # no provider configured; never synthesize approval
    assert client.get("/api/verifications/" + data["id"]).json()["status"] == "pending"
    other = make_player()
    login_as(other)
    assert client.get("/api/verifications/" + data["id"]).status_code == 404


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://example.com/item/123", 201),
        ("javascript:alert(1)", 422),
        ("https://name:password@example.com/item", 422),
        ("", 422),
    ],
)
def test_listing_link_is_an_alternative_to_upload(
    client, db_session, make_player, login_as, url, expected
):
    player = make_player()
    login_as(player)
    artifact = create_project_and_artifact(
        db_session, player, artifact_type="listing_record", content={"listing_url": url}
    )
    response = client.post(
        "/api/verifications",
        json={"artifact_id": artifact.id, "artifact_version": artifact.version, "evidence_ids": []},
    )
    assert response.status_code == expected, response.text
    if expected == 201:
        assert response.json()["snapshot"]["content"]["listing_url"] == url
        assert response.json()["status"] == "pending"
