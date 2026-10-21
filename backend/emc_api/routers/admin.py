"""人工审核接口与最小审核后台页面路由（#33, #34, #35）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import Forbidden, InvalidState, NotFound, ValidationFailed
from ..ids import REVIEW, VERIFICATION, has_prefix, new_id
from ..models import (
    SUBMISSION_STATUSES,
    Artifact,
    VerificationReview,
    VerificationSubmission,
)
from ..pagination import PageParams, page_params, paginate
from ..security import CurrentPlayer, require_reviewer
from ..services.audit import record_audit
from ..services.idempotency import endpoint_id, idempotency_key, run_idempotent
from ..timeutil import utcnow
from .verifications import serialize_submission, serialize_submissions

router = APIRouter(prefix="/admin", tags=["admin"])
ui_router = APIRouter(tags=["admin-ui"])

ADMIN_UI_DIR = Path(__file__).resolve().parents[1] / "admin_ui"
ADMIN_INDEX_HTML = ADMIN_UI_DIR / "index.html"


class ReviewDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approved", "rejected"]
    reason: str | None = Field(default=None, max_length=2000)


@router.get("/verifications")
def admin_list_verifications(
    page: PageParams = Depends(page_params),
    status: str | None = Query("pending", min_length=1, max_length=32),
    artifact_id: str | None = Query(None, min_length=1, max_length=64),
    reviewer: CurrentPlayer = Depends(require_reviewer),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """审核员查询认证申请列表（默认 `status=pending`，传 `status=all` 返回全部状态）。"""
    _ = reviewer
    if status is not None and status != "all" and status not in SUBMISSION_STATUSES:
        raise ValidationFailed.field(
            ["query", "status"], "status 须为 pending、approved、rejected 或 all"
        )
    stmt = select(VerificationSubmission)
    if status is not None and status != "all":
        stmt = stmt.where(VerificationSubmission.status == status)
    if artifact_id is not None:
        stmt = stmt.where(VerificationSubmission.artifact_id == artifact_id)

    result = paginate(
        db,
        stmt,
        page=page,
        created_col=VerificationSubmission.created_at,
        id_col=VerificationSubmission.id,
    )
    items = serialize_submissions(db, result.items, include_owner=True)
    return {"items": items, "next_cursor": result.next_cursor}


@router.get("/verifications/{submission_id}")
def admin_get_verification(
    submission_id: str,
    reviewer: CurrentPlayer = Depends(require_reviewer),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """审核员读取认证申请详情（含冻结快照、证据列表与审核历史）。"""
    _ = reviewer
    if not has_prefix(submission_id, VERIFICATION):
        raise NotFound()
    sub = db.get(VerificationSubmission, submission_id)
    if sub is None:
        raise NotFound()
    return serialize_submission(db, sub, include_owner=True)


@router.post("/verifications/{submission_id}/review")
def admin_review_verification(
    submission_id: str,
    body: ReviewDecisionIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    reviewer: CurrentPlayer = Depends(require_reviewer),
    db: Session = Depends(get_db),
) -> JSONResponse:
    """审核员执行通过或驳回（只追加审核记录，禁止自审与重复审核）。"""
    clean_reason = body.reason.strip() if body.reason and body.reason.strip() else None
    if body.decision == "rejected" and not clean_reason:
        raise ValidationFailed.field(["body", "reason"], "驳回时必须填写原因")

    def handler(s: Session) -> tuple[int, dict[str, Any]]:
        if not has_prefix(submission_id, VERIFICATION):
            raise NotFound()
        sub = s.execute(
            select(VerificationSubmission)
            .where(VerificationSubmission.id == submission_id)
            .with_for_update()
        ).scalar_one_or_none()
        if sub is None:
            raise NotFound()

        if sub.owner_id == reviewer.id:
            raise Forbidden("不能审核本人提交的认证申请")
        if sub.status != "pending":
            raise InvalidState("该认证申请已完成审核，不能重复审核")

        artifact = s.execute(
            select(Artifact).where(Artifact.id == sub.artifact_id).with_for_update()
        ).scalar_one_or_none()
        if artifact is None:
            raise NotFound()

        now = utcnow()
        review = VerificationReview(
            id=new_id(REVIEW),
            submission_id=sub.id,
            reviewer_id=reviewer.id,
            decision=body.decision,
            reason=clean_reason,
            created_at=now,
        )
        s.add(review)

        sub.status = body.decision
        sub.decided_at = now

        artifact.status = body.decision
        artifact.version += 1
        artifact.updated_at = now

        record_audit(
            s,
            "verification.review",
            actor_player_id=reviewer.id,
            target_type="verification",
            target_id=sub.id,
            details={
                "submission_id": sub.id,
                "artifact_id": artifact.id,
                "decision": body.decision,
                "reason": clean_reason,
                "review_id": review.id,
            },
            now=now,
        )
        s.flush()
        return 200, serialize_submission(s, sub, include_owner=True)

    return run_idempotent(
        db,
        player_id=reviewer.id,
        endpoint=endpoint_id(request),
        key=key,
        request_body=body.model_dump(mode="json"),
        handler=handler,
    ).to_response()


@ui_router.get("/admin", include_in_schema=False)
@ui_router.get("/admin/", include_in_schema=False)
def serve_admin_ui() -> FileResponse:
    """最小审核后台页面（静态页面公开返回，数据接口严格校验审核员身份）。"""
    return FileResponse(
        ADMIN_INDEX_HTML,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )
