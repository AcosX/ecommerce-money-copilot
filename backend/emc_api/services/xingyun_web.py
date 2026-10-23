"""Native Web E2E transport into the same authoritative Xiaoshang runtime.

Each confirmed question carries a prepared opaque turn ticket. The callback bearer
is minted on the server, expires after 15 minutes and is bound to the login session.
The vendor cannot select a player, project, prompt, tools or another turn's content.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..errors import InvalidState, NotFound, Unauthenticated, ValidationFailed
from ..models import BusinessProject, SessionRecord, XingyunWebSession
from ..security import CurrentPlayer, session_is_active
from ..timeutil import utcnow
from .agent_runtime import run_companion_chat

TTL_SECONDS = 900
TICKET = re.compile(r"\[EMC:([0-9a-f]{32})\]$")


def bearer(settings: Settings, grant_id: str) -> str:
    signature = hmac.new(
        settings.session_secret.get_secret_value().encode(),
        ("xingyun-web:" + grant_id).encode(),
        hashlib.sha256,
    ).hexdigest()
    return grant_id + "." + signature


def _active(db: Session, settings: Settings, grant: XingyunWebSession | None) -> XingyunWebSession:
    if grant is None or grant.expires_at <= utcnow():
        raise InvalidState("数字人会话已过期，请重新连接")
    if grant.owner_id:
        session = db.get(SessionRecord, grant.session_id_hash, populate_existing=True)
        if (
            session is None
            or session.player_id != grant.owner_id
            or not session_is_active(session, settings, utcnow())
        ):
            raise Unauthenticated("登录已失效，请重新连接数字人")
    return grant


def owned(
    db: Session,
    settings: Settings,
    grant_id: str,
    player: CurrentPlayer | None,
    *,
    lock: bool = False,
    active: bool = True,
) -> XingyunWebSession:
    statement = select(XingyunWebSession).where(XingyunWebSession.id == grant_id)
    if lock:
        statement = statement.with_for_update()
    grant = db.scalar(statement.execution_options(populate_existing=True))
    if grant is None or (
        grant.owner_id
        and (
            player is None
            or grant.owner_id != player.id
            or grant.session_id_hash != player.session_id_hash
        )
    ):
        raise NotFound()
    return _active(db, settings, grant) if active else grant


def issue(db: Session, settings: Settings, player: CurrentPlayer | None) -> dict[str, Any]:
    db.execute(delete(XingyunWebSession).where(XingyunWebSession.expires_at <= utcnow()))
    grant = XingyunWebSession(
        id=secrets.token_hex(32),
        owner_id=player.id if player else None,
        session_id_hash=player.session_id_hash if player else None,
        expires_at=utcnow() + timedelta(seconds=TTL_SECONDS),
    )
    db.add(grant)
    db.commit()
    return {"id": grant.id, "expires_in": TTL_SECONDS}


def prepare(
    db: Session,
    settings: Settings,
    grant_id: str,
    player: CurrentPlayer | None,
    body: dict[str, Any],
) -> dict[str, str]:
    grant = owned(db, settings, grant_id, player, lock=True)
    old = grant.turn or {}
    if old.get("state") in {"prepared", "processing"}:
        raise InvalidState("上一条消息仍在处理中")
    context = dict(body.get("client_context") or {})
    project_id = (context.get("active_project") or {}).get("id")
    if project_id:
        project = db.get(BusinessProject, project_id)
        if not player or not project or project.owner_id != player.id:
            raise NotFound("未找到经营项目")
    context.pop("save_as_draft", None)
    body = {**body, "client_context": context}
    turn_id = secrets.token_hex(16)
    grant.turn = {"upstream": old.get("upstream"), "id": turn_id, "state": "prepared", "body": body}
    db.commit()
    return {"id": turn_id, "ticket": "EMC:" + turn_id}


def complete(db: Session, settings: Settings, authorization: str, ticket: str) -> dict[str, Any]:
    token = authorization.removeprefix("Bearer ")
    grant_id = token.split(".", 1)[0]
    if not re.fullmatch(r"[0-9a-f]{64}", grant_id) or not hmac.compare_digest(
        token, bearer(settings, grant_id)
    ):
        raise Unauthenticated()
    grant = _active(
        db,
        settings,
        db.scalar(
            select(XingyunWebSession).where(XingyunWebSession.id == grant_id).with_for_update()
        ),
    )
    turn = dict(grant.turn or {})
    match = TICKET.search(ticket.strip())
    if not match or turn.get("id") != match.group(1):
        raise ValidationFailed("只能执行当前网页已确认的消息")
    if turn.get("state") == "done":
        return turn["result"]
    if turn.get("state") != "prepared":
        raise InvalidState("消息已在处理中，请在网页查看结果")
    body = turn["body"]
    grant.turn = {**turn, "state": "processing"}
    db.commit()
    try:
        result = run_companion_chat(
            db,
            settings,
            player_id=grant.owner_id,
            message=body["message"],
            level_id=body.get("level_id"),
            preset_id=body.get("preset_id"),
            session_id=body.get("session_id"),
            client_context=body.get("client_context"),
            guest_history=body.get("guest_history") if not grant.owner_id else None,
        )
    except Exception:
        db.rollback()
        failed = db.get(XingyunWebSession, grant_id, populate_existing=True)
        if failed is not None:
            failed.turn = {
                "upstream": (failed.turn or {}).get("upstream"),
                "id": turn["id"],
                "state": "failed",
            }
            db.commit()
        raise
    # End the read snapshot too (guest runtime is read-only). Observe any revocation
    # committed during generation, rather than the transaction's earlier snapshot.
    db.commit()
    grant = _active(
        db,
        settings,
        db.scalar(
            select(XingyunWebSession)
            .where(XingyunWebSession.id == grant_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ),
    )
    grant.turn = {
        "upstream": (grant.turn or {}).get("upstream"),
        "id": turn["id"],
        "state": "done",
        "result": result,
    }
    db.commit()
    return result


def result(
    db: Session, settings: Settings, grant_id: str, turn_id: str, player: CurrentPlayer | None
) -> dict[str, Any]:
    grant = owned(db, settings, grant_id, player)
    turn = grant.turn or {}
    if turn.get("id") != turn_id:
        raise NotFound()
    return {"state": turn["state"], "result": turn.get("result")}


def public_session_response(value: Any) -> Any:
    """Keep SDK transport tokens, strip echoed service credentials from gateway replies."""
    if isinstance(value, dict):
        return {
            key: public_session_response(item)
            for key, item in value.items()
            if key.lower() not in {"api_key", "app_secret", "appsecret", "authorization", "secret"}
        }
    if isinstance(value, list):
        return [public_session_response(item) for item in value]
    return value
