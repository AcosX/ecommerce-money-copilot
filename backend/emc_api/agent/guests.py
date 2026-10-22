"""游客只持有带教会话，不创建正式 SessionRecord。"""

import hashlib
import hmac

from fastapi import Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import CsrfFailed, NotFound, RateLimited, Unauthenticated
from ..models import AgentGuestSession, Player
from ..security import CurrentPlayer, origin_allowed
from ..timeutil import utcnow

GUEST_COOKIE = "emc_agent_guest"


class GuestExpired(Unauthenticated):
    code = "agent_guest_expired"
    message = "游客带教会话已失效，请重新发送消息"


def guest_enabled(request: Request) -> None:
    if not request.app.state.settings.agent_guest_enabled:
        raise NotFound()


def require_guest_origin(request: Request) -> None:
    guest_enabled(request)
    settings = request.app.state.settings
    origins = {settings.public_origin} | {
        value.strip() for value in settings.agent_guest_origins.split(",") if value.strip()
    }
    if not any(origin_allowed(request, origin) for origin in origins):
        raise CsrfFailed()


def guest_record(request: Request, db: Session) -> AgentGuestSession:
    guest_enabled(request)
    token = request.cookies.get(GUEST_COOKIE, "")
    if not 20 <= len(token) <= 128:
        raise GuestExpired()
    record = db.get(AgentGuestSession, hashlib.sha256(token.encode()).hexdigest())
    if record is None or record.expires_at <= utcnow():
        raise GuestExpired()
    return record


def require_guest(request: Request, db: Session = Depends(get_db)) -> CurrentPlayer:
    record = guest_record(request, db)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        require_guest_origin(request)
        supplied = request.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(supplied.encode(), record.csrf_token.encode()):
            raise CsrfFailed()
    player = db.get(Player, record.player_id)
    if player is None:
        raise GuestExpired()
    request.state.agent_guest = record.id_hash
    return CurrentPlayer(
        id=player.id,
        acos_sub=player.acos_sub,
        display_name=player.display_name,
        email=None,
        is_reviewer=False,
        csrf_token=record.csrf_token,
        session_id_hash=record.id_hash,
    )


def guest_budget(db: Session, request: Request, *, consume: bool = False) -> None:
    key = getattr(request.state, "agent_guest", None)
    if key is None:
        return
    statement = select(AgentGuestSession).where(AgentGuestSession.id_hash == key)
    if consume:
        statement = statement.with_for_update()
    record = db.scalar(statement.execution_options(populate_existing=True))
    if record is None or record.expires_at <= utcnow():
        raise GuestExpired()
    today = utcnow().date().isoformat()
    used = record.messages_today if record.quota_day == today else 0
    settings = request.app.state.settings
    total = (
        db.scalar(
            select(func.sum(AgentGuestSession.messages_today)).where(
                AgentGuestSession.quota_day == today
            )
        )
        or 0
    )
    if used >= settings.agent_guest_daily_limit or total >= settings.agent_guest_global_daily_limit:
        raise RateLimited("今日游客 AI 体验额度已用完，请稍后再试")
    if consume:
        record.quota_day, record.messages_today = today, used + 1
