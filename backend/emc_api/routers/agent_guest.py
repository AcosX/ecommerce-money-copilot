from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agent.contracts import ActivityIn, CompanionState, HistoryPage, MessageIn, Reply
from ..agent.guests import (
    GUEST_COOKIE,
    GuestExpired,
    guest_record,
    require_guest,
    require_guest_origin,
)
from ..db import get_db, with_retry
from ..errors import RateLimited
from ..ids import PLAYER, PROJECT, new_id
from ..models import AgentGuestSession, BusinessProject, Player
from ..security import CurrentPlayer
from ..services.idempotency import idempotency_key
from ..timeutil import utcnow
from . import agent

router = APIRouter(prefix="/agent/guest", tags=["agent-guest"])
capabilities_router = APIRouter(tags=["agent"])


class GuestContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: Literal["xiaohongshu", "pinduoduo"] = "xiaohongshu"
    category: str = Field(default="", max_length=64)
    level: Literal["L1", "L2", "L3", "L4", "L5", "L6", "first_order"] = "L1"


@capabilities_router.get("/agent/capabilities")
def capabilities(request: Request) -> dict:
    settings = request.app.state.settings
    model_enabled = (
        settings.agent_provider == "compatible"
        and bool(settings.agent_model)
        and bool(settings.agent_api_key.get_secret_value())
    )
    return {
        "model_enabled": model_enabled,
        "guest_enabled": settings.agent_guest_enabled and model_enabled,
    }


@router.post("/session", dependencies=[Depends(require_guest_origin)])
def bootstrap(
    body: GuestContext, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    settings = request.app.state.settings
    raw_token = secrets.token_urlsafe(32)

    def handler(s: Session) -> dict:
        nonlocal raw_token
        try:
            record = guest_record(request, s)
            raw_token = request.cookies[GUEST_COOKIE]
        except GuestExpired:
            now = utcnow()
            host = request.client.host if request.client else "unknown"
            client_hash = hashlib.sha256(
                (settings.session_secret.get_secret_value() + host).encode()
            ).hexdigest()
            recent = (
                s.scalar(
                    select(func.count())
                    .select_from(AgentGuestSession)
                    .where(
                        AgentGuestSession.client_hash == client_hash,
                        AgentGuestSession.created_at >= now - timedelta(hours=1),
                    )
                )
                or 0
            )
            if recent >= settings.agent_guest_session_hourly_limit:
                raise RateLimited("创建游客会话过于频繁，请稍后再试") from None
            player = Player(
                id=new_id(PLAYER),
                acos_sub="guest:" + secrets.token_hex(16),
                display_name="游客店主",
                email=None,
            )
            s.add(player)
            s.flush()
            project = BusinessProject(
                id=new_id(PROJECT),
                owner_id=player.id,
                name="游客教学小店",
                platform=body.platform,
                category=body.category,
                status="active",
                version=1,
            )
            s.add(project)
            s.flush()
            record = AgentGuestSession(
                id_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
                player_id=player.id,
                project_id=project.id,
                csrf_token=secrets.token_urlsafe(32),
                level=body.level,
                client_hash=client_hash,
                created_at=now,
                expires_at=now + timedelta(days=1),
                quota_day=now.date().isoformat(),
                messages_today=0,
            )
            s.add(record)
            s.flush()
        project = s.get(BusinessProject, record.project_id)
        project.platform, project.category = body.platform, body.category
        record.level = body.level
        s.flush()
        return {
            "guest": True,
            "csrf_token": record.csrf_token,
            "project_id": record.project_id,
            "level": record.level,
        }

    result = with_retry(db, handler)
    response.set_cookie(
        GUEST_COOKIE,
        raw_token,
        max_age=86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api/agent/guest",
    )
    response.headers["Cache-Control"] = "no-store"
    return result


def project_id(request: Request, db: Session) -> str:
    return guest_record(request, db).project_id


@router.get("/state", response_model=CompanionState)
def state(
    request: Request, player: CurrentPlayer = Depends(require_guest), db: Session = Depends(get_db)
) -> CompanionState:
    return agent.get_state(project_id(request, db), request, player, db)


@router.get("/history", response_model=HistoryPage)
def history(
    request: Request,
    before: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    player: CurrentPlayer = Depends(require_guest),
    db: Session = Depends(get_db),
) -> dict:
    return agent.get_history(project_id(request, db), before, limit, player, db)


@router.post("/activity", response_model=CompanionState)
def activity(
    body: ActivityIn,
    request: Request,
    player: CurrentPlayer = Depends(require_guest),
    db: Session = Depends(get_db),
) -> CompanionState:
    return agent.activity(project_id(request, db), body, request, player, db)


@router.post("/messages", response_model=Reply)
def messages(
    body: MessageIn,
    request: Request,
    key: str | None = Depends(idempotency_key),
    player: CurrentPlayer = Depends(require_guest),
    db: Session = Depends(get_db),
) -> JSONResponse:
    return agent.send_message(project_id(request, db), body, request, key, player, db)
