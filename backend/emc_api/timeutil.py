"""时间工具：服务端统一使用带时区的 UTC datetime。"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)


def isoformat_utc(value: datetime | None) -> str | None:
    """输出 ISO 8601 UTC，例如 `2026-10-21T08:00:00.123Z`（契约 §6）。"""
    if value is None:
        return None
    if value.tzinfo is None:
        raise ValueError("naive datetime 不允许；请使用 UTC aware datetime")
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
