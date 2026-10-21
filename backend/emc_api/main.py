"""FastAPI 应用工厂。

    uv run uvicorn emc_api.main:app --host 127.0.0.1 --port 8000

新增 `/api/*` 路由请用 `include_api_router(app, router)` 挂载：自动加 `/api` 前缀并启用 CSRF 校验。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings, get_settings
from .db import Database
from .errors import install_exception_handlers
from .logging_config import configure_logging
from .middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from .routers import admin, artifacts, auth, evidence, health, me, projects, verifications
from .security import require_csrf

# 仓库根目录（backend/ 的上一级），仅 EMC_ENV=dev 时用于提供前端静态文件。
REPO_ROOT = Path(__file__).resolve().parents[2]
# 开发模式下允许提供的静态文件（显式白名单，绝不暴露 backend/、docs/、.git 等）。
DEV_STATIC_FILES = ("index.html",)
# 与 deploy/apache 的放行路径保持一致
DEV_STATIC_DIRS = ("assets", "css", "js")

EVIDENCE_UPLOAD_PATH = "/api/evidence"
# multipart 边界与表单字段的额外开销
MULTIPART_OVERHEAD_BYTES = 64 * 1024


def _router_signatures(router: APIRouter, prefix: str = "/api") -> set[tuple[str, str]]:
    sigs: set[tuple[str, str]] = set()
    for route in getattr(router, "routes", ()):
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if path and methods:
            for m in methods:
                sigs.add((f"{prefix}{path}", m))
    return sigs


def include_api_router(app: FastAPI, router: APIRouter) -> None:
    """挂载业务路由：前缀 `/api`，所有非 GET/HEAD/OPTIONS 请求强制 CSRF 校验。"""
    new_sigs = _router_signatures(router, "/api")
    if new_sigs:
        app.router.routes[:] = [
            item
            for item in app.router.routes
            if not (
                getattr(item, "original_router", None) is not None
                and bool(
                    _router_signatures(
                        item.original_router,
                        getattr(getattr(item, "include_context", None), "prefix", "/api"),
                    )
                    & new_sigs
                )
            )
        ]
    app.include_router(router, prefix="/api", dependencies=[Depends(require_csrf)])


def _mount_dev_static(app: FastAPI, root: Path) -> None:
    for name in DEV_STATIC_DIRS:
        directory = root / name
        if directory.is_dir():
            app.mount(f"/{name}", StaticFiles(directory=directory), name=f"dev-static-{name}")

    index = root / "index.html"

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def dev_index() -> FileResponse:
        return FileResponse(index, media_type="text/html; charset=utf-8")


def create_app(
    settings: Settings | None = None,
    *,
    database: Database | None = None,
    static_root: Path | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    db = database or Database(settings.database_url.get_secret_value())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if database is None:  # 只释放自己创建的连接池
            db.dispose()

    is_prod = settings.env == "prod"
    app = FastAPI(
        title="电商搞钱参谋 API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if is_prod else "/api/openapi.json",
    )
    app.state.settings = settings
    app.state.db = db

    install_exception_handlers(app)

    # 后添加的中间件在外层：RequestContext 最外层，保证 413 等响应也带 X-Request-ID。
    app.add_middleware(
        BodySizeLimitMiddleware,
        max_body_bytes=settings.max_body_bytes,
        path_limits={
            EVIDENCE_UPLOAD_PATH: settings.max_upload_bytes + MULTIPART_OVERHEAD_BYTES,
        },
    )
    app.add_middleware(RequestContextMiddleware)

    include_api_router(app, health.router)
    include_api_router(app, me.router)
    include_api_router(app, projects.router)
    include_api_router(app, artifacts.router)
    include_api_router(app, evidence.router)
    include_api_router(app, verifications.router)
    include_api_router(app, admin.router)
    app.include_router(admin.ui_router)
    # /auth/* 由 OIDC 登录模块实现（见 routers/auth.py）。
    app.include_router(auth.router)

    if settings.env == "dev":
        _mount_dev_static(app, static_root or REPO_ROOT)

    return app


def __getattr__(name: str) -> FastAPI:
    # `uvicorn emc_api.main:app` 时才读取配置并创建应用；测试导入本模块不会触发。
    if name == "app":
        application = create_app()
        globals()["app"] = application
        return application
    raise AttributeError(name)
