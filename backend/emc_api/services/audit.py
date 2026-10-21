"""审计事件（只追加）。与业务写入放在同一事务中，随业务一起提交或回滚。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from ..logging_config import get_request_id
from ..models import AuditEvent
from ..timeutil import utcnow


def record_audit(
    db: Session,
    action: str,
    *,
    actor_player_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
    now: datetime | None = None,
) -> AuditEvent:
    """添加一条审计事件（不 flush、不提交）。

    `action` 建议用 `<资源>.<动作>`，例如 `artifact.create`、`verification.review`。
    `details` 不要放敏感数据（令牌、Cookie、完整证据内容等）。
    """
    event = AuditEvent(
        occurred_at=now or utcnow(),
        actor_player_id=actor_player_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        request_id=request_id or get_request_id(),
        details=jsonable_encoder(details) if details is not None else None,
    )
    db.add(event)
    return event
