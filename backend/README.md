# 电商搞钱参谋 后端（FastAPI）

对外约定见 [`docs/backend-contract.md`](../docs/backend-contract.md)。以下命令都在 `backend/` 目录执行。

## 本地启动

```bash
cd backend
uv sync --frozen
cp .env.example .env        # 把 CHANGE_ME 换成本地随机值；EMC_DATABASE_URL 的密码与 EMC_DEV_DB_PASSWORD 一致
docker compose --env-file .env -f docker-compose.dev.yml up -d --wait
uv run alembic upgrade head
uv run uvicorn emc_api.main:app --host 127.0.0.1 --port 8000
```

- 开发库为 MariaDB 10.11，只监听 `127.0.0.1:${EMC_DEV_DB_PORT:-3307}`。
- `EMC_ENV=dev` 时，应用同时提供仓库根目录的 `index.html`、`assets/`、`css/`、`js/`（显式白名单），前端与 `/api/*` 同源；
  `test` / `prod` 不提供静态文件（生产由 Apache 提供）。
- 非生产环境的 OpenAPI 文档：`/api/docs`、`/api/openapi.json`。

## 测试

```bash
cd backend
docker compose --env-file .env -f docker-compose.dev.yml up -d --wait
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

- 测试连接真实 MariaDB：每次运行新建独立库 `emc_test_<随机>`，执行 `alembic upgrade head`，结束后删除；
  每个用到数据库的测试结束后清空全部表。
- 连接取 `EMC_TEST_DATABASE_URL`，否则取 `.env` 中的 `EMC_DATABASE_URL`。账号需要能创建 `emc_test_*` 库：
  开发容器首次初始化时由 `dev/mariadb-init/01-test-databases.sql` 授权（已有数据卷时需手动执行该 GRANT）。

## 迁移

```bash
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "说明"   # 修改 emc_api/models.py 后
uv run alembic check                               # 模型与迁移是否一致
uv run alembic downgrade base
```

Galera 约束：每张表有主键、InnoDB、utf8mb4_unicode_ci；JSON 列存 LONGTEXT 并加 `json_valid` 检查；
不使用 `LOCK TABLES`。生产最小权限账号示例见 `sql/grants.example.sql`（迁移账号与运行账号分离，
只追加表仅授予 SELECT/INSERT）。

## 新增业务路由

```python
# emc_api/routers/projects.py
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import CurrentPlayer, require_player
from ..services.idempotency import endpoint_id, idempotency_key, run_idempotent

router = APIRouter(prefix="/projects", tags=["projects"])

# emc_api/main.py 的 create_app() 中：
#     include_api_router(app, projects.router)   # 自动加 /api 前缀与 CSRF 校验
```

- 错误：`raise NotFound()`、`raise VersionConflict()` 等（`emc_api.errors`），统一输出契约 §6 格式。
- 写事务：`with_retry(db, fn)`（`emc_api.db`）处理 Galera 提交时的 1213 冲突；创建类 POST 用
  `run_idempotent(...)`，它内部已包含重试与提交。
- 审计：`record_audit(db, "artifact.create", ...)`（`emc_api.services.audit`），与业务写入同事务。
- 分页：`page_params` 依赖 + `paginate(...)`（`emc_api.pagination`）。
- 测试夹具：`tests/conftest.py` 顶部有说明（`app_factory`、`client`、`make_player`、`login_as` 等）。
