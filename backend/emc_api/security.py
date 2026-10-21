"""服务端会话、Cookie、CSRF 与角色依赖（契约 §5）。

路由用法::

    from emc_api.security import CurrentPlayer, require_player, require_reviewer

    @router.get("/projects")
    def list_projects(
        player: CurrentPlayer = Depends(require_player), db: Session = Depends(get_db)
    ):
        ...

`/api/*` 下通过 `emc_api.main.include_api_router` 挂载的路由会自动加上 `require_csrf`
（非 GET/HEAD/OPTIONS 请求必须带正确的 X-CSRF-Token 且 Origin/Referer 同源）。
"""

from __future__ import annotations

import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import Depends, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from .config import Settings, normalize_origin
from .db import get_db
from .errors import CsrfFailed, Forbidden, Unauthenticated
from .hashing import sha256_hex
from .models import Player, SessionRecord
from .timeutil import utcnow

logger = logging.getLogger("emc_api.security")

SESSION_COOKIE = "emc_session"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
# last_seen_at 最多每分钟更新一次
TOUCH_INTERVAL = timedelta(seconds=60)
_MAX_TOKEN_LENGTH = 128


def get_app_settings(request: Request) -> Settings:
    """当前应用的配置（测试中由 create_app(settings) 注入）。"""
    return request.app.state.settings


def hash_session_token(token: str) -> str:
    return sha256_hex(token)


@dataclass(frozen=True)
class CurrentPlayer:
    """当前登录玩家（与 ORM 会话解耦的只读快照）。"""

    id: str
    acos_sub: str
    display_name: str
    email: str | None
    is_reviewer: bool
    csrf_token: str
    session_id_hash: str

    @property
    def roles(self) -> list[str]:
        return ["player", "reviewer"] if self.is_reviewer else ["player"]


@dataclass(frozen=True)
class NewSession:
    token: str  # 原始会话 ID，只写入 Cookie，不入库、不记日志
    id_hash: str
    csrf_token: str
    expires_at: datetime


def create_session(
    db: Session, player: Player, settings: Settings, *, now: datetime | None = None
) -> NewSession:
    """为玩家创建服务端会话并 flush（不提交，由调用方的事务提交）。

    之后用 `set_session_cookie(response, new_session, settings)` 写 Cookie。
    """
    now = now or utcnow()
    token = secrets.token_urlsafe(32)
    record = SessionRecord(
        id_hash=hash_session_token(token),
        player_id=player.id,
        csrf_token=secrets.token_urlsafe(32),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(seconds=settings.session_absolute_seconds),
    )
    db.add(record)
    db.flush()
    return NewSession(
        token=token,
        id_hash=record.id_hash,
        csrf_token=record.csrf_token,
        expires_at=record.expires_at,
    )


def revoke_session(db: Session, id_hash: str, *, now: datetime | None = None) -> bool:
    """吊销单个会话（不提交）。返回是否确有未吊销的会话被吊销。"""
    result = db.execute(
        update(SessionRecord)
        .where(SessionRecord.id_hash == id_hash, SessionRecord.revoked_at.is_(None))
        .values(revoked_at=now or utcnow())
    )
    return result.rowcount > 0


def revoke_player_sessions(db: Session, player_id: str, *, now: datetime | None = None) -> int:
    """吊销玩家的全部会话（不提交）。"""
    result = db.execute(
        update(SessionRecord)
        .where(SessionRecord.player_id == player_id, SessionRecord.revoked_at.is_(None))
        .values(revoked_at=now or utcnow())
    )
    return result.rowcount


def set_session_cookie(response: Response, new_session: NewSession, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        new_session.token,
        max_age=settings.session_absolute_seconds,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax"
    )


def session_is_active(record: SessionRecord, settings: Settings, now: datetime) -> bool:
    if record.revoked_at is not None:
        return False
    absolute_deadline = min(
        record.expires_at,
        record.created_at + timedelta(seconds=settings.session_absolute_seconds),
    )
    idle_deadline = record.last_seen_at + timedelta(seconds=settings.session_idle_seconds)
    return now < absolute_deadline and now < idle_deadline


_UNRESOLVED = object()
_STATE_KEY = "_emc_current_player"


def resolve_current_player(
    request: Request, db: Session, settings: Settings
) -> CurrentPlayer | None:
    """同一请求内只查一次会话（结果缓存在 request.state）。"""
    cached = getattr(request.state, _STATE_KEY, _UNRESOLVED)
    if cached is not _UNRESOLVED:
        return cached  # type: ignore[return-value]
    current = _lookup_session(request, db, settings)
    setattr(request.state, _STATE_KEY, current)
    return current


def get_current_player(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> CurrentPlayer | None:
    """读取 `emc_session` Cookie；游客或会话无效（过期/吊销/不存在）时返回 None。"""
    return resolve_current_player(request, db, settings)


def _lookup_session(request: Request, db: Session, settings: Settings) -> CurrentPlayer | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > _MAX_TOKEN_LENGTH:
        return None
    id_hash = hash_session_token(token)
    now = utcnow()
    row = db.execute(
        select(SessionRecord, Player)
        .join(Player, Player.id == SessionRecord.player_id)
        .where(SessionRecord.id_hash == id_hash)
    ).first()
    if row is None:
        db.rollback()
        return None
    record, player = row
    if not session_is_active(record, settings, now):
        db.rollback()
        return None

    current = CurrentPlayer(
        id=player.id,
        acos_sub=player.acos_sub,
        display_name=player.display_name,
        email=player.email,
        is_reviewer=player.acos_sub in settings.reviewer_sub_set,
        csrf_token=record.csrf_token,
        session_id_hash=record.id_hash,
    )

    if now - record.last_seen_at >= TOUCH_INTERVAL:
        try:
            db.execute(
                update(SessionRecord)
                .where(
                    SessionRecord.id_hash == id_hash,
                    SessionRecord.last_seen_at <= now - TOUCH_INTERVAL,
                )
                .values(last_seen_at=now)
                .execution_options(synchronize_session=False)
            )
            db.commit()
        except DBAPIError:
            # 刷新活跃时间是尽力而为，冲突时跳过即可。
            db.rollback()
            logger.warning("session_touch_failed")
    else:
        db.rollback()

    request.state.player_id = current.id
    return current


def require_player(current: CurrentPlayer | None = Depends(get_current_player)) -> CurrentPlayer:
    if current is None:
        raise Unauthenticated()
    return current


def require_reviewer(current: CurrentPlayer = Depends(require_player)) -> CurrentPlayer:
    if not current.is_reviewer:
        raise Forbidden()
    return current


def origin_allowed(request: Request, public_origin: str) -> bool:
    origin = request.headers.get("origin")
    if origin is not None:
        return normalize_origin(origin) == public_origin
    referer = request.headers.get("referer")
    if referer:
        return normalize_origin(referer, allow_path=True) == public_origin
    return False


def require_csrf(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> CurrentPlayer | None:
    """非安全方法：必须已登录（否则 401），且 CSRF 令牌与 Origin/Referer 校验通过（否则 403）。

    安全方法（GET/HEAD/OPTIONS）直接放行，不查询会话。
    """
    if request.method in SAFE_METHODS:
        return None
    current = resolve_current_player(request, db, settings)
    if current is None:
        raise Unauthenticated()
    supplied = request.headers.get(CSRF_HEADER)
    if not supplied or not hmac.compare_digest(
        supplied.encode("utf-8"), current.csrf_token.encode("utf-8")
    ):
        raise CsrfFailed()
    if not origin_allowed(request, settings.public_origin):
        raise CsrfFailed()
    return current
