"""幂等（契约 §6）：同一玩家 + 同一接口 + 同一 Idempotency-Key，24 小时内：

- 请求体相同 → 返回首次结果（响应头 `Idempotency-Replayed: true`）；
- 请求体不同 → 422 `idempotency_key_reuse`。

用法（业务写入与幂等记录在同一事务中提交，并自动处理 Galera 死锁重试）::

    @router.post("/projects", status_code=201)
    def create_project(body: ProjectIn, request: Request,
                       key: str | None = Depends(idempotency_key),
                       player: CurrentPlayer = Depends(require_player),
                       db: Session = Depends(get_db)):
        def handler(s: Session) -> tuple[int, dict]:
            project = BusinessProject(id=new_id(PROJECT), owner_id=player.id, ...)
            s.add(project)
            record_audit(s, "project.create", actor_player_id=player.id,
                         target_type="project", target_id=project.id)
            s.flush()
            return 201, project_to_json(project)

        return run_idempotent(db, player_id=player.id, endpoint=endpoint_id(request), key=key,
                              request_body=body.model_dump(mode="json"),
                              handler=handler).to_response()

`handler` 可能被重试多次，必须每次重新读取数据，不能依赖外部可变状态。
"""

from __future__ import annotations

import hmac
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from fastapi import Header, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import is_duplicate_key_error, with_retry
from ..errors import IdempotencyKeyReuse, ValidationFailed
from ..hashing import json_sha256
from ..models import IdempotencyRecord
from ..timeutil import utcnow

IDEMPOTENCY_HEADER = "Idempotency-Key"
REPLAYED_HEADER = "Idempotency-Replayed"
RETENTION = timedelta(hours=24)
# 1–128 个可见 ASCII 字符（不含空格）
_KEY_PATTERN = re.compile(r"^[\x21-\x7e]{1,128}$")


def idempotency_key(
    value: str | None = Header(None, alias=IDEMPOTENCY_HEADER),
) -> str | None:
    """FastAPI 依赖：读取并校验可选的 `Idempotency-Key` 请求头。"""
    if value is None:
        return None
    if not _KEY_PATTERN.match(value):
        raise ValidationFailed.field(
            ["header", IDEMPOTENCY_HEADER], "Idempotency-Key 须为 1–128 个可见 ASCII 字符"
        )
    return value


def endpoint_id(request: Request) -> str:
    """接口标识，使用完整路由模板而非实际路径，例如 `POST /api/projects/{id}`。

    `route.path_format` 不含 `include_router(prefix=...)` 的前缀，这里用路由正则
    匹配实际路径的后缀，把前缀补回来。
    """
    path: str = request.scope.get("path", request.url.path)
    route = request.scope.get("route")
    path_format = getattr(route, "path_format", None)
    path_regex = getattr(route, "path_regex", None)
    if path_format and path_regex is not None:
        for i, ch in enumerate(path):
            if ch == "/" and path_regex.match(path[i:]):
                return f"{request.method} {path[:i]}{path_format}"
    return f"{request.method} {path}"


def request_hash(request_body: Any) -> str:
    return json_sha256(jsonable_encoder(request_body))


@dataclass(frozen=True)
class IdempotentResult:
    status_code: int
    body: Any
    replayed: bool

    def to_response(self) -> JSONResponse:
        headers = {REPLAYED_HEADER: "true"} if self.replayed else None
        return JSONResponse(self.body, status_code=self.status_code, headers=headers)


class _ConcurrentClaim(Exception):
    """另一个相同幂等键的请求正在执行或刚刚提交；重试后会读到它的结果。"""


def run_idempotent(
    db: Session,
    *,
    player_id: str,
    endpoint: str,
    key: str | None,
    request_body: Any,
    handler: Callable[[Session], tuple[int, Any]],
    attempts: int = 4,
) -> IdempotentResult:
    """执行写操作并提交。`key` 为 None 时不做幂等，仅提交并处理死锁重试。

    `handler(session)` 返回 `(status_code, json_body)`；抛出的 ApiError 不会被记录，
    相同键的后续请求会重新执行。
    """
    rhash = request_hash(request_body)

    def attempt(s: Session) -> IdempotentResult:
        if key is None:
            status, body = handler(s)
            return IdempotentResult(status, jsonable_encoder(body), replayed=False)

        now = utcnow()
        pk = (
            IdempotencyRecord.player_id == player_id,
            IdempotencyRecord.endpoint == endpoint,
            IdempotencyRecord.idem_key == key,
        )
        existing = s.execute(
            select(IdempotencyRecord).where(*pk).with_for_update()
        ).scalar_one_or_none()
        if existing is not None:
            if existing.expires_at > now:
                if not hmac.compare_digest(existing.request_hash, rhash):
                    raise IdempotencyKeyReuse()
                return IdempotentResult(
                    existing.response_status, existing.response_body, replayed=True
                )
            s.delete(existing)
            s.flush()

        # 先占位再执行业务：并发的相同请求会在这里因主键冲突而重试，然后读到首次结果。
        record = IdempotencyRecord(
            player_id=player_id,
            endpoint=endpoint,
            idem_key=key,
            request_hash=rhash,
            response_status=0,
            response_body=None,
            created_at=now,
            expires_at=now + RETENTION,
        )
        s.add(record)
        try:
            s.flush()
        except IntegrityError as exc:
            if is_duplicate_key_error(exc):
                raise _ConcurrentClaim() from exc
            raise

        status, body = handler(s)
        body = jsonable_encoder(body)
        record.response_status = status
        record.response_body = body
        s.flush()
        return IdempotentResult(status, body, replayed=False)

    return with_retry(
        db,
        attempt,
        attempts=attempts,
        retry_if=lambda exc: isinstance(exc, _ConcurrentClaim),
    )


def purge_expired_idempotency_records(
    db: Session, *, now: datetime | None = None, batch_size: int = 1000
) -> int:
    """删除过期记录（单批，不提交），供定时任务调用。返回删除行数。"""
    stmt = (
        delete(IdempotencyRecord)
        .where(IdempotencyRecord.expires_at <= (now or utcnow()))
        .execution_options(synchronize_session=False)
    )
    result = db.execute(stmt.with_dialect_options(mysql_limit=batch_size))
    return result.rowcount
