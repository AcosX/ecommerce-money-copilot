"""共享测试夹具（后续模块的测试可直接使用）。

测试连接真实 MariaDB 10.11（docker-compose.dev.yml）。每次 pytest 运行会新建独立的
`emc_test_<随机>` 库并执行 `alembic upgrade head`，结束时删除；
每个用到数据库的测试结束后清空全部表。
数据库连接取 `EMC_TEST_DATABASE_URL`，否则取 backend/.env 中的 `EMC_DATABASE_URL`。

常用夹具：
- `settings`：本测试的 Settings（env=test，public_origin=http://testserver），可在测试内修改。
- `app_factory(*routers, settings_override=None, database_override=None, static_root=None)`。
- `app` / `client`：默认应用与 TestClient；测试模块可重写 `app` 夹具以挂载测试路由。
- `make_client()`：为同一 `app` 再创建一个独立的 TestClient（多玩家场景）。
- `db_session`：独立的 ORM Session。
- `make_player(acos_sub=None, display_name="店主", email=...)` → Player（已提交）。
- `login_as(player, reviewer=False, *, test_client=None, now=None)` → NewSession：
  写入真实 sessions 行，并给 client 设置 `emc_session` Cookie、`X-CSRF-Token` 与 `Origin`。
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alembic import command
from emc_api import ids
from emc_api.config import Settings
from emc_api.db import Database
from emc_api.main import create_app, include_api_router
from emc_api.models import Base, Player
from emc_api.security import CSRF_HEADER, SESSION_COOKIE, NewSession, create_session
from emc_api.timeutil import utcnow

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_ORIGIN = "http://testserver"
TEST_DB_CONNECT_ARGS = {"connect_timeout": 3, "read_timeout": 5, "write_timeout": 5}


# ---------------------------------------------------------------- 数据库工具


def _base_database_url() -> URL:
    raw = os.environ.get("EMC_TEST_DATABASE_URL")
    if not raw:
        raw = Settings(_env_file=BACKEND_DIR / ".env").database_url.get_secret_value()
    return make_url(raw)


def url_string(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def create_test_database(prefix: str = "emc_test_") -> URL:
    """新建空库（utf8mb4_unicode_ci），返回其连接 URL。"""
    base = _base_database_url()
    name = f"{prefix}{secrets.token_hex(6)}"
    engine = create_engine(base, isolation_level="AUTOCOMMIT", connect_args=TEST_DB_CONNECT_ARGS)
    try:
        with engine.connect() as conn:
            conn.execute(
                text(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            )
    except DBAPIError as exc:
        code = getattr(exc.orig, "args", (None,))[0]
        pytest.exit(
            f"测试数据库不可用（MySQL {code}）：{base.render_as_string(hide_password=True)}。"
            "请先启动 backend/docker-compose.dev.yml，核对 EMC_TEST_DATABASE_URL，"
            "并确认账号有 emc_test_* 的建库权限。",
            returncode=2,
        )
    finally:
        engine.dispose()
    return base.set(database=name)


def drop_test_database(url: URL) -> None:
    engine = create_engine(
        _base_database_url(), isolation_level="AUTOCOMMIT", connect_args=TEST_DB_CONNECT_ARGS
    )
    try:
        with engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS `{url.database}`"))
    finally:
        engine.dispose()


def alembic_config(url: URL) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["database_url"] = url_string(url)
    cfg.attributes["configure_logger"] = False
    return cfg


# ---------------------------------------------------------------- 夹具


@pytest.fixture(scope="session")
def database_url() -> Iterator[URL]:
    url = create_test_database()
    try:
        command.upgrade(alembic_config(url), "head")
        yield url
    finally:
        drop_test_database(url)


@pytest.fixture(scope="session")
def database(database_url: URL) -> Iterator[Database]:
    db = Database(url_string(database_url))
    yield db
    db.dispose()


@pytest.fixture(autouse=True)
def _clean_tables(request: pytest.FixtureRequest) -> Iterator[None]:
    yield
    if "database" not in request.fixturenames:
        return
    db: Database = request.getfixturevalue("database")
    with db.engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


@pytest.fixture
def settings(database_url: URL, tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        env="test",
        public_origin=TEST_ORIGIN,
        database_url=url_string(database_url),
        session_secret=secrets.token_urlsafe(48),
        cookie_secure=False,
        reviewer_subs="",
        upload_dir=str(tmp_path / "uploads"),
    )


@pytest.fixture
def app_factory(settings: Settings, database: Database) -> Callable[..., FastAPI]:
    def factory(
        *routers: APIRouter,
        settings_override: Settings | None = None,
        database_override: Database | None = None,
        static_root: Path | None = None,
    ) -> FastAPI:
        app = create_app(
            settings_override or settings,
            database=database_override or database,
            static_root=static_root,
        )
        for router in routers:
            include_api_router(app, router)
        return app

    return factory


@pytest.fixture
def app(app_factory: Callable[..., FastAPI]) -> FastAPI:
    return app_factory()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app, base_url=TEST_ORIGIN) as test_client:
        yield test_client


@pytest.fixture
def make_client(app: FastAPI) -> Iterator[Callable[[], TestClient]]:
    clients: list[TestClient] = []

    def factory() -> TestClient:
        test_client = TestClient(app, base_url=TEST_ORIGIN)
        test_client.__enter__()
        clients.append(test_client)
        return test_client

    yield factory
    for test_client in clients:
        test_client.__exit__(None, None, None)


@pytest.fixture
def db_session(database: Database) -> Iterator[Session]:
    session = database.sessionmaker()
    yield session
    session.close()


@pytest.fixture
def make_player(db_session: Session) -> Callable[..., Player]:
    def factory(
        *,
        acos_sub: str | None = None,
        display_name: str = "店主",
        email: str | None = "player@example.com",
    ) -> Player:
        now = utcnow()
        player = Player(
            id=ids.new_id(ids.PLAYER),
            acos_sub=acos_sub or f"sub-{secrets.token_hex(8)}",
            display_name=display_name,
            email=email,
            created_at=now,
            last_login_at=now,
        )
        db_session.add(player)
        db_session.commit()
        return player

    return factory


@pytest.fixture
def login_as(
    client: TestClient, settings: Settings, db_session: Session
) -> Callable[..., NewSession]:
    def login(
        player: Player,
        reviewer: bool = False,
        *,
        test_client: TestClient | None = None,
        now: datetime | None = None,
    ) -> NewSession:
        target = test_client or client
        if reviewer and player.acos_sub not in settings.reviewer_sub_set:
            settings.reviewer_subs = ",".join([*settings.reviewer_sub_set, player.acos_sub])
        new_session = create_session(db_session, player, settings, now=now)
        db_session.commit()
        target.cookies.set(SESSION_COOKIE, new_session.token)
        target.headers[CSRF_HEADER] = new_session.csrf_token
        target.headers["Origin"] = settings.public_origin
        return new_session

    return login
