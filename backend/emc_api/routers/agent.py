from __future__ import annotations

import hmac
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agent.contracts import ActivityIn, CompanionState, HistoryPage, MessageIn, Reply
from ..agent.emotion import EmotionPolicy, emotion_profile
from ..agent.guests import guest_budget
from ..agent.relationship import evolve
from ..agent.service import (
    business_context,
    owned_project,
    performance_view,
    require_active,
    state_view,
    tick_activity,
)
from ..db import get_db, with_retry
from ..errors import IdempotencyKeyReuse, RateLimited, ValidationFailed, VersionConflict
from ..models import AgentState, AgentTurn, IdempotencyRecord
from ..security import CurrentPlayer, require_player
from ..services.audit import record_audit
from ..services.idempotency import endpoint_id, idempotency_key, request_hash, run_idempotent
from ..timeutil import isoformat_utc, utcnow

router = APIRouter(prefix="/agent", tags=["agent"])


def emotion_policy(request: Request) -> EmotionPolicy:
    settings = request.app.state.settings
    return EmotionPolicy(
        settings.agent_emotion_grace_seconds,
        settings.agent_emotion_decay_interval_seconds,
        settings.agent_emotion_decay_points,
    )


@router.get("/projects/{project_id}/state", response_model=CompanionState)
def get_state(
    project_id: str,
    request: Request,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> CompanionState:
    project = owned_project(db, project_id, player.id)
    context = business_context(db, project)
    return state_view(
        db.get(AgentState, project_id),
        context["level"],
        performance_view(db, project_id, context),
        emotion_policy(request),
    )


@router.post("/projects/{project_id}/activity", response_model=CompanionState)
def activity(
    project_id: str,
    body: ActivityIn,
    request: Request,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> CompanionState:
    def handler(s: Session) -> CompanionState:
        project = owned_project(s, project_id, player.id, lock=True)
        require_active(project)
        context = business_context(s, project)
        tick_activity(s, project, context, reset_clock=body.reset_clock)
        return state_view(
            s.get(AgentState, project_id),
            context["level"],
            performance_view(s, project_id, context),
            emotion_policy(request),
        )

    return with_retry(db, handler)


@router.get("/projects/{project_id}/history", response_model=HistoryPage)
def get_history(
    project_id: str,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    owned_project(db, project_id, player.id)
    stmt = select(AgentTurn).where(AgentTurn.project_id == project_id)
    if before is not None:
        stmt = stmt.where(AgentTurn.sequence < before)
    rows = list(db.scalars(stmt.order_by(AgentTurn.sequence.desc()).limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": [
            {
                "id": r.id,
                "sequence": r.sequence,
                "message": r.message,
                "reply": r.response,
                "created_at": isoformat_utc(r.created_at),
            }
            for r in reversed(rows)
        ],
        "next_before": rows[-1].sequence if more else None,
    }


@router.post("/projects/{project_id}/messages", response_model=Reply)
def send_message(
    project_id: str,
    body: MessageIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> JSONResponse:
    if key is None:
        raise ValidationFailed.field(["header", "Idempotency-Key"], "伙伴消息必须提供幂等键")
    project = owned_project(db, project_id, player.id)
    require_active(project)
    endpoint = endpoint_id(request)
    payload = {"project_id": project_id, **body.model_dump(mode="json")}
    # 重试已成功的请求时直接走既有幂等框架，不再调用付费模型。
    cached = db.get(IdempotencyRecord, (player.id, endpoint, key))
    if cached is not None and cached.expires_at > utcnow():
        if not hmac.compare_digest(cached.request_hash, request_hash(payload)):
            raise IdempotencyKeyReuse()
        return JSONResponse(
            cached.response_body,
            status_code=cached.response_status,
            headers={"Idempotency-Replayed": "true"},
        )
    guest_budget(db, request)
    context = business_context(db, project)
    row = db.get(AgentState, project_id)
    state = state_view(row, context["level"])
    performance = performance_view(db, project_id, context)
    policy = emotion_policy(request)
    if body.version != state.version:
        raise VersionConflict(details={"state": state.model_dump()})
    now = utcnow()
    if row is not None and (now - row.updated_at).total_seconds() < 2:
        raise RateLimited(headers={"Retry-After": "2"})
    affinity, patience, memory = evolve(
        state.affinity,
        state.patience,
        row.memory if row else {},
        body.message,
        context["level"],
        now,
        performance,
        policy,
    )
    next_state = CompanionState(
        affinity=affinity,
        patience=patience,
        version=state.version + 1,
        level=context["level"],
        streak=memory.get("streak", 0),
        perks=memory.get("perks", []),
        emotion=emotion_profile(
            affinity,
            patience,
            performance,
            memory.get("last_change", {}).get("reason_codes", []),
            policy,
        ),
    )
    turns = list(
        db.scalars(
            select(AgentTurn)
            .where(AgentTurn.project_id == project_id)
            .order_by(AgentTurn.sequence.desc())
            .limit(6)
        )
    )
    history = []
    for turn in reversed(turns):
        history.extend(
            [
                {"role": "user", "content": turn.message},
                {"role": "assistant", "content": turn.response["text"]},
            ]
        )
    # 网络调用期间不占用项目行锁或数据库事务。
    db.rollback()
    reply = request.app.state.agent_runtime.reply(
        body.message,
        body.companion_name,
        context,
        next_state,
        history,
        body.page_context.model_dump(),
    )
    reply.turn_id = "agt_" + uuid.uuid4().hex[:28]

    def handler(s: Session) -> tuple[int, dict]:
        current_project = owned_project(s, project_id, player.id, lock=True)
        require_active(current_project)
        current = s.scalar(
            select(AgentState)
            .where(AgentState.project_id == project_id)
            .execution_options(populate_existing=True)
        )
        if (current.version if current else 1) != body.version:
            raise VersionConflict("对话已更新，请刷新伙伴状态后重试")
        if business_context(s, current_project) != context:
            raise VersionConflict("经营进度已变化，请重新发起对话")
        if current is None:
            current = AgentState(project_id=project_id)
            s.add(current)
        guest_budget(s, request, consume=True)
        current.affinity, current.patience = affinity, patience
        current.version, current.memory = next_state.version, memory
        current.updated_at = utcnow()
        result = reply.model_dump(mode="json")
        s.add(
            AgentTurn(
                id=reply.turn_id,
                project_id=project_id,
                sequence=next_state.version,
                message=body.message,
                response=result,
                created_at=current.updated_at,
            )
        )
        record_audit(
            s,
            "agent.reply",
            actor_player_id=player.id,
            target_type="project",
            target_id=project_id,
            details={"turn_id": reply.turn_id, "source": reply.source},
        )
        s.flush()
        return 200, result

    return run_idempotent(
        db, player_id=player.id, endpoint=endpoint, key=key, request_body=payload, handler=handler
    ).to_response()
