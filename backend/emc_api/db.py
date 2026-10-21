"""数据库连接、会话依赖、列类型与 Galera 写事务重试。

MariaDB 10.11 Galera 约束：所有表有主键、InnoDB、utf8mb4；不使用 LOCK TABLES；
并发控制依赖唯一约束与 `SELECT ... FOR UPDATE`。Galera 在提交时可能因认证冲突
返回 1213（deadlock），写事务应通过 `with_retry` 执行。
"""

from __future__ import annotations

import json
import logging
import random
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any, TypeVar

from fastapi import Request
from sqlalchemy import create_engine, text
from sqlalchemy.dialects import mysql
from sqlalchemy.engine import Dialect
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.types import TypeDecorator

logger = logging.getLogger("emc_api.db")

T = TypeVar("T")

# 1213: ER_LOCK_DEADLOCK（含 Galera 认证冲突）；1020: ER_CHECKREAD（记录在读取后被修改）
RETRYABLE_MYSQL_ERRORS = frozenset({1213, 1020})
DUPLICATE_KEY_ERROR = 1062
# MariaDB 的 CHECK 约束失败（pymysql 抛 OperationalError 而非 IntegrityError）
CHECK_CONSTRAINT_ERROR = 4025


class UTCDateTime(TypeDecorator[datetime]):
    """DATETIME(6)，库内存 UTC（无时区），Python 侧一律为 UTC aware datetime。"""

    impl = mysql.DATETIME
    cache_ok = True

    def __init__(self) -> None:
        super().__init__(fsp=6)

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime 不允许；请使用 emc_api.timeutil.utcnow()")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC)


class JSONText(TypeDecorator[Any]):
    """JSON 存为 LONGTEXT（与 MariaDB 的 JSON 别名兼容），配合 CHECK json_valid()。

    注意：原地修改 dict/list 不会被 ORM 感知，修改后请整体重新赋值。
    """

    impl = mysql.LONGTEXT
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    def process_result_value(self, value: str | None, dialect: Dialect) -> Any:
        if value is None:
            return None
        return json.loads(value)


class Database:
    """一个 Engine + sessionmaker；挂在 `app.state.db`。"""

    def __init__(self, url: str, *, pool_size: int = 5, max_overflow: int = 10) -> None:
        self.engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_recycle=1800,
            pool_size=pool_size,
            max_overflow=max_overflow,
            connect_args={"connect_timeout": 5, "init_command": "SET time_zone = '+00:00'"},
        )
        # expire_on_commit=False：提交后仍可读取对象属性来构造响应。
        self.sessionmaker = sessionmaker(self.engine, expire_on_commit=False)

    def ping(self) -> bool:
        """数据库连通性；若为 Galera 节点（wsrep_on=ON），还要求 wsrep_ready=ON。"""
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
                wsrep_on = conn.execute(text("SHOW VARIABLES LIKE 'wsrep_on'")).first()
                if wsrep_on is not None and str(wsrep_on[1]).upper() == "ON":
                    ready = conn.execute(text("SHOW GLOBAL STATUS LIKE 'wsrep_ready'")).first()
                    if ready is None or str(ready[1]).upper() != "ON":
                        logger.warning("db_ping_wsrep_not_ready")
                        return False
            return True
        except Exception as exc:  # noqa: BLE001 - 健康检查只关心可用与否
            logger.warning("db_ping_failed", extra={"error_type": type(exc).__name__})
            return False

    def dispose(self) -> None:
        self.engine.dispose()


def get_db(request: Request) -> Iterator[Session]:
    """FastAPI 依赖：每个请求一个 Session；未提交的修改在请求结束时回滚。"""
    session: Session = request.app.state.db.sessionmaker()
    try:
        yield session
    finally:
        session.close()


def mysql_error_code(exc: BaseException) -> int | None:
    orig = getattr(exc, "orig", exc)
    args = getattr(orig, "args", ())
    if args and isinstance(args[0], int):
        return args[0]
    return None


def is_retryable_error(exc: BaseException) -> bool:
    return isinstance(exc, DBAPIError) and mysql_error_code(exc) in RETRYABLE_MYSQL_ERRORS


def is_duplicate_key_error(exc: BaseException) -> bool:
    return isinstance(exc, DBAPIError) and mysql_error_code(exc) == DUPLICATE_KEY_ERROR


def is_check_constraint_error(exc: BaseException) -> bool:
    return isinstance(exc, DBAPIError) and mysql_error_code(exc) == CHECK_CONSTRAINT_ERROR


def with_retry(
    db: Session,
    fn: Callable[[Session], T],
    *,
    attempts: int = 4,
    base_delay: float = 0.02,
    max_delay: float = 0.5,
    retry_if: Callable[[BaseException], bool] | None = None,
) -> T:
    """在一个事务中执行 `fn(db)` 并提交；遇到死锁/Galera 认证冲突时回滚并整体重试。

    - `fn` 必须可重复执行：每次都重新读取所需数据（建议 `SELECT ... FOR UPDATE`），
      不要依赖上一次尝试中加载的 ORM 对象。
    - 任何异常都会回滚；`ApiError` 等非重试异常原样抛出。
    - `retry_if` 可追加自定义的可重试条件（例如幂等记录的并发插入）。
    """
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    for attempt in range(1, attempts + 1):
        try:
            result = fn(db)
            db.commit()
            return result
        except Exception as exc:
            db.rollback()
            retryable = is_retryable_error(exc) or (retry_if is not None and retry_if(exc))
            if not retryable or attempt == attempts:
                raise
            delay = min(max_delay, base_delay * (2 ** (attempt - 1))) * (0.5 + random.random())
            logger.warning(
                "db_transaction_retry",
                extra={"attempt": attempt, "mysql_errno": mysql_error_code(exc)},
            )
            time.sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover
