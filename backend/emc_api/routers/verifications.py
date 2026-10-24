"""正式成果认证申请：提交冻结快照、绑定证据、玩家查询进度与驳回原因（#29, #30, #32, #35）。"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db, is_duplicate_key_error
from ..errors import InvalidState, NotFound, ValidationFailed, VersionConflict
from ..hashing import json_sha256
from ..ids import ARTIFACT, EVIDENCE, VERIFICATION, has_prefix, new_id
from ..models import (
    SUBMISSION_STATUSES,
    Artifact,
    ArtifactRevision,
    EvidenceFile,
    Player,
    ReviewJob,
    VerificationReview,
    VerificationSubmission,
)
from ..pagination import PageParams, page_params, paginate
from ..security import CurrentPlayer, get_app_settings, require_player
from ..services.audit import record_audit
from ..services.idempotency import endpoint_id, idempotency_key, run_idempotent
from ..services.review_queue import enqueue
from ..timeutil import isoformat_utc, utcnow
from .evidence import evidence_to_json

router = APIRouter(tags=["verifications"])


class VerificationSubmitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(min_length=1, max_length=64)
    artifact_version: int = Field(ge=1)
    evidence_ids: list[str] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=2000)


def review_to_json(rev: VerificationReview) -> dict[str, Any]:
    return {
        "id": rev.id,
        "submission_id": rev.submission_id,
        "reviewer_id": rev.reviewer_id,
        "source": rev.source,
        "report": rev.report,
        "decision": rev.decision,
        "reason": rev.reason,
        "created_at": isoformat_utc(rev.created_at),
    }


def submission_to_json(
    sub: VerificationSubmission,
    *,
    evidence: Sequence[EvidenceFile],
    reviews: Sequence[VerificationReview],
    owner: Player | None = None,
) -> dict[str, Any]:
    rejection_reason: str | None = None
    if sub.status == "rejected":
        for rev in reversed(reviews):
            if rev.decision == "rejected" and rev.reason:
                rejection_reason = rev.reason
                break

    ev_list = [evidence_to_json(e) for e in evidence]
    rev_list = [review_to_json(r) for r in reviews]
    data: dict[str, Any] = {
        "id": sub.id,
        "artifact_id": sub.artifact_id,
        "owner_id": sub.owner_id,
        "artifact_revision": sub.artifact_revision,
        "snapshot": sub.snapshot,
        "snapshot_sha256": sub.snapshot_sha256,
        "note": sub.note,
        "method": sub.method,
        "status": sub.status,
        "rejection_reason": rejection_reason,
        "evidence_count": len(ev_list),
        "created_at": isoformat_utc(sub.created_at),
        "decided_at": isoformat_utc(sub.decided_at),
        "evidence": ev_list,
        "reviews": rev_list,
    }
    if owner is not None:
        data["owner"] = {
            "id": owner.id,
            "display_name": owner.display_name,
            "email": owner.email,
        }
        data["owner_display_name"] = owner.display_name
    return data


def serialize_submissions(
    db: Session,
    submissions: Sequence[VerificationSubmission],
    *,
    include_owner: bool = False,
) -> list[dict[str, Any]]:
    if not submissions:
        return []
    sub_ids = [s.id for s in submissions]

    ev_rows = db.scalars(
        select(EvidenceFile)
        .where(EvidenceFile.submission_id.in_(sub_ids))
        .order_by(EvidenceFile.created_at.asc(), EvidenceFile.id.asc())
    ).all()
    ev_by_sub: dict[str, list[EvidenceFile]] = defaultdict(list)
    for ev in ev_rows:
        if ev.submission_id is not None:
            ev_by_sub[ev.submission_id].append(ev)

    rev_rows = db.scalars(
        select(VerificationReview)
        .where(VerificationReview.submission_id.in_(sub_ids))
        .order_by(VerificationReview.created_at.asc(), VerificationReview.id.asc())
    ).all()
    rev_by_sub: dict[str, list[VerificationReview]] = defaultdict(list)
    for rev in rev_rows:
        rev_by_sub[rev.submission_id].append(rev)

    owners_by_id: dict[str, Player] = {}
    if include_owner:
        owner_ids = {s.owner_id for s in submissions}
        for p in db.scalars(select(Player).where(Player.id.in_(owner_ids))).all():
            owners_by_id[p.id] = p

    jobs = {
        j.submission_id: j
        for j in db.scalars(select(ReviewJob).where(ReviewJob.submission_id.in_(sub_ids))).all()
    }
    result = []
    for sub in submissions:
        item = submission_to_json(
            sub,
            evidence=ev_by_sub.get(sub.id, ()),
            reviews=rev_by_sub.get(sub.id, ()),
            owner=owners_by_id.get(sub.owner_id),
        )
        job = jobs.get(sub.id)
        item["agent_review"] = (
            {
                "state": job.status,
                "attempts": job.attempts,
                "rubric_version": job.rubric_version,
                "report": job.report,
            }
            if job
            else None
        )
        result.append(item)
    return result


def serialize_submission(
    db: Session,
    sub: VerificationSubmission,
    *,
    include_owner: bool = False,
) -> dict[str, Any]:
    return serialize_submissions(db, [sub], include_owner=include_owner)[0]


@router.post("/verifications", status_code=201)
def submit_verification(
    body: VerificationSubmitIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """提交成果认证申请：冻结当前 revision 快照并绑定证据附件。"""
    if len(body.evidence_ids) > settings.max_files_per_submission:
        raise ValidationFailed.field(
            ["body", "evidence_ids"],
            f"单次认证申请最多绑定 {settings.max_files_per_submission} 个证据文件",
        )
    if len(set(body.evidence_ids)) != len(body.evidence_ids):
        raise ValidationFailed.field(["body", "evidence_ids"], "证据文件 ID 不能重复")

    def handler(s: Session) -> tuple[int, dict[str, Any]]:
        if not has_prefix(body.artifact_id, ARTIFACT):
            raise NotFound()
        for ev_id in body.evidence_ids:
            if not has_prefix(ev_id, EVIDENCE):
                raise NotFound()

        artifact = s.execute(
            select(Artifact).where(Artifact.id == body.artifact_id).with_for_update()
        ).scalar_one_or_none()
        if artifact is None or artifact.owner_id != player.id:
            raise NotFound()

        if artifact.status == "submitted":
            raise InvalidState("该成果已有待审核的认证申请")
        if artifact.status == "approved":
            raise InvalidState("该成果已通过正式认证")
        if artifact.status not in ("draft", "rejected"):
            raise InvalidState("当前状态不允许提交认证")

        if artifact.version != body.artifact_version:
            raise VersionConflict(details={"current_version": artifact.version})

        current_rev = s.execute(
            select(ArtifactRevision).where(
                ArtifactRevision.artifact_id == artifact.id,
                ArtifactRevision.revision == artifact.current_revision,
            )
        ).scalar_one_or_none()
        if current_rev is None:
            raise InvalidState("成果当前版本内容不存在")

        if not body.evidence_ids:
            content = current_rev.content or {}
            report = (
                content.get("report_text")
                or content.get("planning_report")
                or content.get("summary")
                or ""
            )
            text_allowed = (
                artifact.artifact_type in {"business_plan", "product_selection", "data_review"}
                and isinstance(report, str)
                and len(report.strip()) >= 40
            )
            listing_url = content.get("listing_url")
            link_allowed = False
            if artifact.artifact_type == "listing_record" and isinstance(listing_url, str):
                try:
                    url = urlsplit(listing_url)
                    link_allowed = (
                        url.scheme in {"http", "https"}
                        and bool(url.hostname)
                        and not url.username
                        and not url.password
                    )
                except ValueError:
                    pass
            if not (text_allowed or link_allowed):
                raise ValidationFailed.field(
                    ["body", "evidence_ids"],
                    "规划、选品与复盘可直接提交至少 40 字的成果；"
                    "上架请提供在售截图或商品链接，素材与内容发布需要对应图片",
                )

        ev_rows = (
            s.execute(
                select(EvidenceFile)
                .where(EvidenceFile.id.in_(sorted(body.evidence_ids)))
                .order_by(EvidenceFile.id.asc())
                .with_for_update()
            )
            .scalars()
            .all()
        )
        ev_by_id = {ev.id: ev for ev in ev_rows}
        ordered_evidence: list[EvidenceFile] = []
        for ev_id in body.evidence_ids:
            ev = ev_by_id.get(ev_id)
            if ev is None or ev.owner_id != player.id:
                raise NotFound()
            if ev.submission_id is not None:
                raise InvalidState("证据文件已绑定其他认证申请")
            ordered_evidence.append(ev)

        snapshot = {
            "artifact_id": artifact.id,
            "project_id": artifact.project_id,
            "artifact_type": artifact.artifact_type,
            "schema_version": artifact.schema_version,
            "title": artifact.title,
            "origin": artifact.origin,
            "source_level_id": artifact.source_level_id,
            "revision": current_rev.revision,
            "content": current_rev.content,
            "content_sha256": current_rev.content_sha256,
        }
        snapshot_sha256 = json_sha256(snapshot)
        clean_note = body.note.strip() if body.note and body.note.strip() else None
        now = utcnow()

        submission = VerificationSubmission(
            id=new_id(VERIFICATION),
            artifact_id=artifact.id,
            owner_id=player.id,
            artifact_revision=current_rev.revision,
            snapshot=snapshot,
            snapshot_sha256=snapshot_sha256,
            note=clean_note,
            method="self_submit",
            status="approved",
            created_at=now,
            decided_at=now,
        )
        s.add(submission)
        try:
            s.flush()
        except IntegrityError as exc:
            if is_duplicate_key_error(exc):
                raise InvalidState("该成果已有待审核的认证申请") from exc
            raise

        enqueue(s, settings, submission)

        for ev in ordered_evidence:
            ev.submission_id = submission.id

        artifact.status = "approved"
        artifact.version += 1
        artifact.updated_at = now

        record_audit(
            s,
            "verification.submit",
            actor_player_id=player.id,
            target_type="verification",
            target_id=submission.id,
            details={
                "artifact_id": artifact.id,
                "artifact_revision": current_rev.revision,
                "evidence_ids": list(body.evidence_ids),
                "snapshot_sha256": snapshot_sha256,
            },
            now=now,
        )
        s.flush()
        return 201, submission_to_json(submission, evidence=ordered_evidence, reviews=[])

    return run_idempotent(
        db,
        player_id=player.id,
        endpoint=endpoint_id(request),
        key=key,
        request_body=body.model_dump(mode="json"),
        handler=handler,
    ).to_response()


@router.get("/verifications")
def list_verifications(
    page: PageParams = Depends(page_params),
    artifact_id: str | None = Query(None, min_length=1, max_length=64),
    status: str | None = Query(None, min_length=1, max_length=32),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """列出当前玩家自己的认证申请（支持按 artifact_id、status 过滤）。"""
    if status is not None and status not in SUBMISSION_STATUSES:
        raise ValidationFailed.field(
            ["query", "status"], "status 须为 pending、approved 或 rejected"
        )
    stmt = select(VerificationSubmission).where(VerificationSubmission.owner_id == player.id)
    if artifact_id is not None:
        stmt = stmt.where(VerificationSubmission.artifact_id == artifact_id)
    if status is not None:
        stmt = stmt.where(VerificationSubmission.status == status)

    result = paginate(
        db,
        stmt,
        page=page,
        created_col=VerificationSubmission.created_at,
        id_col=VerificationSubmission.id,
    )
    items = serialize_submissions(db, result.items, include_owner=False)
    return {"items": items, "next_cursor": result.next_cursor}


@router.get("/verifications/{submission_id}")
def get_verification(
    submission_id: str,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """读取认证申请详情、驳回原因与审核历史（仅申请人本人或审核员可读）。"""
    if not has_prefix(submission_id, VERIFICATION):
        raise NotFound()
    sub = db.get(VerificationSubmission, submission_id)
    if sub is None:
        raise NotFound()
    if sub.owner_id != player.id and not player.is_reviewer:
        raise NotFound()
    return serialize_submission(db, sub, include_owner=player.is_reviewer)
