"""Alembic 环境。数据库地址优先取 `config.attributes["database_url"]`（测试用），
否则取 EMC_DATABASE_URL（或 backend/.env）。

迁移中 JSON 列一律为 LONGTEXT、时间列为 DATETIME(6)，与 emc_api.db 中的类型对应。
"""

from __future__ import annotations

from logging.config import fileConfig
from typing import Any

from sqlalchemy import create_engine, pool

from alembic import context
from emc_api.db import JSONText, UTCDateTime
from emc_api.models import Base

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    url = config.attributes.get("database_url")
    if url:
        return str(url)
    from emc_api.config import get_settings

    return get_settings().database_url.get_secret_value()


def render_item(type_: str, obj: Any, autogen_context: Any) -> str | bool:
    """autogenerate 时把自定义列类型渲染为 MySQL 方言类型，迁移文件不依赖应用代码。"""
    if type_ == "type":
        if isinstance(obj, UTCDateTime):
            autogen_context.imports.add("from sqlalchemy.dialects import mysql")
            return "mysql.DATETIME(fsp=6)"
        if isinstance(obj, JSONText):
            autogen_context.imports.add("from sqlalchemy.dialects import mysql")
            return "mysql.LONGTEXT()"
    return False


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(_database_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_item=render_item,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
