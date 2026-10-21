"""分页（契约 §6）：`?limit=`（1–100，默认 20）`&cursor=`。

响应 `{"items": [...], "next_cursor": null}`。

按 (created_at DESC, id DESC) 做 keyset 分页::

    @router.get("/projects")
    def list_projects(page: PageParams = Depends(page_params), player=Depends(require_player),
                      db: Session = Depends(get_db)):
        stmt = select(BusinessProject).where(BusinessProject.owner_id == player.id)
        result = paginate(db, stmt, page=page,
                          created_col=BusinessProject.created_at, id_col=BusinessProject.id)
        return result.to_dict(project_to_json)
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, and_, or_
from sqlalchemy.orm import InstrumentedAttribute, Session

from .errors import ValidationFailed

T = TypeVar("T")
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


@dataclass(frozen=True)
class PageParams:
    limit: int = DEFAULT_LIMIT
    cursor: str | None = None


def page_params(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    cursor: str | None = Query(None, min_length=1, max_length=512),
) -> PageParams:
    return PageParams(limit=limit, cursor=cursor)


class PageOut(BaseModel, Generic[T]):
    """OpenAPI 用的分页响应模型：`response_model=PageOut[ProjectOut]`。"""

    items: list[T]
    next_cursor: str | None = None


@dataclass(frozen=True)
class Page(Generic[T]):
    items: Sequence[T]
    next_cursor: str | None

    def to_dict(self, serialize: Callable[[T], Any]) -> dict[str, Any]:
        return {"items": [serialize(i) for i in self.items], "next_cursor": self.next_cursor}


def _invalid_cursor() -> ValidationFailed:
    return ValidationFailed.field(["query", "cursor"], "无效的分页游标")


def encode_cursor(created_at: datetime, id_: str) -> str:
    payload = json.dumps(
        {"t": created_at.astimezone(UTC).isoformat(timespec="microseconds"), "i": id_},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        created_at = datetime.fromisoformat(data["t"])
        id_ = data["i"]
    except (binascii.Error, ValueError, KeyError, TypeError, UnicodeDecodeError):
        raise _invalid_cursor() from None
    if created_at.tzinfo is None or not isinstance(id_, str) or not id_ or len(id_) > 64:
        raise _invalid_cursor()
    return created_at, id_


def paginate(
    db: Session,
    stmt: Select[Any],
    *,
    page: PageParams,
    created_col: InstrumentedAttribute[datetime],
    id_col: InstrumentedAttribute[str],
) -> Page[Any]:
    """`stmt` 应只 select 一个 ORM 实体，且已加上归属等过滤条件。"""
    if page.cursor:
        created_at, id_ = decode_cursor(page.cursor)
        stmt = stmt.where(
            or_(created_col < created_at, and_(created_col == created_at, id_col < id_))
        )
    stmt = stmt.order_by(created_col.desc(), id_col.desc()).limit(page.limit + 1)
    rows = list(db.scalars(stmt).all())
    has_more = len(rows) > page.limit
    rows = rows[: page.limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(getattr(last, created_col.key), getattr(last, id_col.key))
    return Page(items=rows, next_cursor=next_cursor)
