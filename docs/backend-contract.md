# 电商搞钱参谋 后端 V1 约定（Phase 0）

本文是前后端与各模块并行开发的共同约定。实现细节可在 PR 中细化，但对外行为（路径、字段、错误码）变更需同步更新本文与 `docs/openapi.json`。

## 1. 职责与 V1 范围（#4）

- 关卡团队：关卡内容、玩法、教学交互；游客教学存档（localStorage）与教学进度接口（Phase 2）。
- 后端：身份会话、经营项目、正式成果、证据附件、人工审核、审计、部署。
- Acos Connect：注册、登录、邮箱验证、找回密码、游戏风格登录页。本项目不保存密码，不持有 Acos Connect 令牌于浏览器。
- V1 不实现：平台对接、自动核验、真实 AI 执行。预留扩展点：成果 `content.extensions`（对象）与认证申请 `method`（V1 固定 `manual_review`）。

## 2. 环境、域名与容量（#5）

| 环境 | 地址 | OAuth client | 说明 |
| --- | --- | --- | --- |
| 开发 | `https://8000-agqvfs7kbtbwvqh6bqtnr76x2a.instabox.tech`、`http://127.0.0.1:8000` | `ecommerce-money-copilot-dev` | Instabox 开发机，独立开发数据库 |
| 测试/演示 | `https://money.acosx.top` | `ecommerce-money-copilot` | VM3；只部署通过测试并打 tag 的版本，可一键回滚 |

- OAuth：OIDC 授权码 + PKCE（S256），`client_secret_post`，scope `openid profile email`，回调 `{origin}/auth/callback`。两个 client 均已在 Acos Connect 注册并启用游戏主题。
- 审核员：服务端配置 `EMC_REVIEWER_SUBS`（Acos Connect `sub`，逗号分隔）。前端无法自报角色。
- 证据附件：单文件 ≤ 10 MiB，单次申请 ≤ 5 个；允许 PNG / JPEG / WebP / PDF（按文件头校验，不信任扩展名与 Content-Type）；私有目录存储，不进 MariaDB，不经静态站点暴露。
- 如需与测试分离的比赛演示域名，可后续增加，不影响本约定。

## 3. 目录布局与启动（#6）

```text
index.html, assets/          现有前端（保持原位置）
js/                          前端适配层（emc-api.js、emc-session.js 等）
backend/
  pyproject.toml, uv.lock    依赖与锁定（uv）
  .env.example               配置示例（无真实凭据）
  docker-compose.dev.yml     开发用 MariaDB 10.11
  emc_api/
    main.py config.py errors.py db.py models.py security.py
    ids.py pagination.py middleware.py logging_config.py hashing.py timeutil.py   基础工具
    routers/  auth.py me.py health.py projects.py artifacts.py evidence.py verifications.py admin.py
    services/ artifact_types.py idempotency.py audit.py storage.py
    admin_ui/                最小审核后台静态资源
  alembic/                   迁移
  sql/grants.example.sql     最小权限数据库账号示例（占位密码）
  dev/mariadb-init/          开发容器初始化脚本（测试库授权）
  tests/
deploy/                      systemd、Apache、部署/备份/恢复脚本（无凭据）
docs/                        本约定、openapi.json、关卡对接说明
```

本地启动：

```bash
cd backend
uv sync --frozen
cp .env.example .env            # 填入开发配置
docker compose -f docker-compose.dev.yml up -d
uv run alembic upgrade head
uv run uvicorn emc_api.main:app --host 127.0.0.1 --port 8000
uv run pytest
```

同源部署：Apache 提供仓库根目录静态文件，并将 `/api/`、`/auth/`、`/admin/` 反向代理到 FastAPI（VM3 `127.0.0.1:8790`）。

## 4. 配置（环境变量）

| 变量 | 说明 |
| --- | --- |
| `EMC_ENV` | `dev` / `test` / `prod` |
| `EMC_PUBLIC_ORIGIN` | 例如 `https://money.acosx.top`，用于回调、CSRF Origin 校验 |
| `EMC_DATABASE_URL` | `mysql+pymysql://user:pass@host:port/db?charset=utf8mb4` |
| `EMC_SESSION_SECRET` | ≥ 32 字节随机值，用于签名 OAuth 临时 Cookie |
| `EMC_OIDC_ISSUER` / `EMC_OIDC_CLIENT_ID` / `EMC_OIDC_CLIENT_SECRET` / `EMC_OIDC_REDIRECT_URI` | Acos Connect 客户端配置 |
| `EMC_REVIEWER_SUBS` | 审核员 `sub` 列表 |
| `EMC_UPLOAD_DIR` | 证据私有存储目录 |
| `EMC_MAX_UPLOAD_BYTES` | 默认 10485760 |
| `EMC_MAX_FILES_PER_SUBMISSION` | 默认 5 |
| `EMC_SESSION_IDLE_SECONDS` / `EMC_SESSION_ABSOLUTE_SECONDS` | 默认 604800 / 2592000 |
| `EMC_COOKIE_SECURE` | 生产为 `true` |
| `EMC_MAX_BODY_BYTES` | 普通请求体上限，默认 262144（256 KiB）；`POST /api/evidence` 另按 `EMC_MAX_UPLOAD_BYTES` + 64 KiB 限制 |
| `EMC_LOG_LEVEL` | 默认 `INFO`；日志为 JSON 行，含 `request_id` |

## 5. 身份与会话

- `GET /auth/login?return_to=<相对路径>`：生成 state、nonce、PKCE verifier，存入签名的短期 Cookie `emc_oauth`（HttpOnly、SameSite=Lax、10 分钟），302 到 Acos Connect `/authorize`。`return_to` 仅允许以 `/` 开头且不以 `//` 开头的同源路径（可含查询串与编码后的 `#` 片段），否则回退 `/`。
- `GET /auth/callback`：校验 state；用 code + verifier 换取令牌；校验 id_token（RS256、JWKS、`iss`、`aud`、`exp`、`nonce`）；按 Acos Connect `sub` 创建或更新玩家；创建服务端会话并设置 `emc_session`（HttpOnly、Secure、SameSite=Lax、Path=/）；303 到 `return_to`。失败显示游戏风格错误页并可重新登录。
- `POST /auth/logout`（需 CSRF）：吊销会话并清除 Cookie，返回 204。仅退出本游戏；Acos Connect 未提供 end_session，账号系统登录状态保留。
- 会话：服务端表保存会话 ID 的哈希；空闲 7 天、绝对 30 天过期；过期返回 401 `unauthenticated`，前端引导重新登录并回到原位置。
- CSRF：`/api/*` 与 `/auth/logout` 的非 GET 请求必须同时满足：请求头 `X-CSRF-Token` 等于会话的 csrf_token；`Origin`（或 `Referer`）与 `EMC_PUBLIC_ORIGIN` 一致。失败返回 403 `csrf_failed`。

`GET /api/me`：

```json
{"authenticated": false}
{"authenticated": true,
 "player": {"id": "ply_…", "display_name": "店主", "email": "a@example.com"},
 "roles": ["player"],
 "csrf_token": "…"}
```

审核员的 `roles` 为 `["player", "reviewer"]`。

## 6. 通用约定

- JSON（UTF-8）；时间为 ISO 8601 UTC；ID 为带前缀的随机字符串：`ply_` 玩家、`prj_` 项目、`art_` 成果、`ver_` 认证申请、`evd_` 证据、`rev_` 审核记录。
- 每个响应带 `X-Request-ID`（默认 `req_…`；若上游传入 8–64 位 `[A-Za-z0-9._:-]` 的值则沿用）。
- `GET /api/health`：正常 200 `{"status": "ok", "database": "ok"}`；数据库不可用（或 Galera 节点未就绪）503 `{"status": "unavailable", "database": "unavailable"}`。
- 错误格式：

```json
{"error": {"code": "version_conflict", "message": "说明", "request_id": "req_…", "details": {}}}
```

| code | HTTP | 场景 |
| --- | --- | --- |
| `unauthenticated` | 401 | 未登录或会话过期 |
| `csrf_failed` | 403 | CSRF 校验失败 |
| `forbidden` | 403 | 已登录但无权限（如非审核员访问审核接口、审核本人申请） |
| `bad_request` | 400 等 | 其他无法归类的 4xx 请求错误 |
| `not_found` | 404 | 不存在或不属于当前玩家（统一 404，防止枚举） |
| `method_not_allowed` | 405 | 路径存在但不支持该方法（带 `Allow` 头） |
| `validation_error` | 422 | 字段校验失败，`details.errors` 列出字段 |
| `idempotency_key_reuse` | 422 | 同一 Idempotency-Key 对应不同请求体 |
| `version_conflict` | 409 | 乐观锁版本不一致 |
| `invalid_state` | 409 | 状态不允许（如重复提交、重复审核、已提交成果被修改） |
| `payload_too_large` | 413 | 请求体或文件超限 |
| `unsupported_media_type` | 415 | 附件类型不允许 |
| `rate_limited` | 429 | 频率限制 |
| `internal_error` | 500 | 未预期错误（不泄露内部细节） |

- 请求体上限 256 KiB（上传除外）；成果 `content` 序列化后 ≤ 128 KiB，嵌套深度 ≤ 8。
- 分页：`?limit=`（1–100，默认 20）`&cursor=`；响应 `{"items": [...], "next_cursor": null}`。
- 幂等：创建类 POST（项目、成果、证据、认证申请、审核）支持 `Idempotency-Key`（1–128 个可见 ASCII 字符）。同一玩家、同一接口、同一 key：请求体相同则返回首次结果（响应头 `Idempotency-Replayed: true`），不同则 422 `idempotency_key_reuse`；保留 24 小时。失败的请求不记录，可用同一 key 重试。
- 非 GET 的 `/api/*` 先校验登录（401）再校验 CSRF（403），之后才校验请求体（422）；超限请求体在此之前直接返回 413。
- 并发：可修改资源带整数 `version`。PATCH 请求体必须带当前 `version`，不一致返回 409 `version_conflict`。

## 7. 关卡与成果类型

| level_id | 关卡 | 正式成果 `artifact_type` |
| --- | --- | --- |
| `L1` | 生意规划 | `business_plan` 经营方案 |
| `L2` | 选品落地 | `product_selection` 选品单 |
| `L3` | 素材优化 | `asset_pack` 素材包 |
| `L4` | 自动化上架 | `listing_record` 上架记录 |
| `L5` | 内容生成发布 | `content_post` 内容发布 |
| `L6` | 数据复盘 | `data_review` 复盘报告 |

- `schema_version` 为整数，从 1 开始。
- V1 对 `business_plan`、`product_selection` 做结构校验；其他类型已登记，`content` 作为受限 JSON 对象接收。关卡团队提供字段后，在 `backend/emc_api/services/artifact_types.py` 注册新的 `(artifact_type, schema_version)` 模型即可收紧校验，旧版本继续可读。

## 8. 模式与状态

- `mode`：`tutorial`（教学/模拟，仅前端本地）、`formal`（正式经营，服务端持久化）。
- 成果 `origin`：`formal`（直接创建）或 `tutorial_copy`（由玩家显式从教学练习复制，必须带 `source_level_id`，UI 标注“来自教学模拟”）。来源不改变认证要求，模拟结果不能直接成为认证通过。
- 成果状态：`draft`（可编辑）→ `submitted`（有待审核申请，锁定编辑）→ `approved` 或 `rejected`（驳回后可修改并再次提交，生成新申请）。
- 认证申请状态：`pending` → `approved` / `rejected`，终态不可修改；审核记录只追加。
- UI 用语：教学通关（仅前端本地）、草稿、待审核、正式认证通过、已驳回。

## 9. 接口

| Method | Path | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/auth/login` | 发起登录 | 公开 |
| GET | `/auth/callback` | OAuth 回调 | 公开 |
| POST | `/auth/logout` | 退出 | 登录 + CSRF |
| GET | `/api/health` | 健康检查（含数据库连通） | 公开 |
| GET | `/api/me` | 当前玩家；游客返回匿名态 | 公开 |
| GET / POST | `/api/projects` | 列出 / 创建本人经营项目 | 登录 |
| GET / PATCH | `/api/projects/{id}` | 读取 / 修改本人项目 | 登录 |
| GET / POST | `/api/artifacts` | 列出（`?project_id=`）/ 创建正式成果草稿 | 登录 |
| GET / PATCH | `/api/artifacts/{id}` | 读取 / 修改本人成果（仅 draft、rejected 可改） | 登录 |
| GET | `/api/artifacts/{id}/revisions` | 成果版本历史 | 登录 |
| POST | `/api/evidence` | 上传证据（multipart 字段 `file`） | 登录 |
| GET | `/api/evidence/{id}/content` | 下载证据（附件方式） | 本人或审核员 |
| GET / POST | `/api/verifications` | 列出本人申请 / 提交认证 | 登录 |
| GET | `/api/verifications/{id}` | 申请详情、驳回原因、审核历史 | 本人或审核员 |
| GET | `/api/admin/verifications` | 审核列表（`?status=pending`） | 审核员 |
| GET | `/api/admin/verifications/{id}` | 审核详情（快照 + 证据） | 审核员 |
| POST | `/api/admin/verifications/{id}/review` | 通过 / 驳回 | 审核员 |
| GET | `/admin/` | 最小审核后台页面 | 页面公开，数据接口需审核员 |
| GET | `/api/tutorial/progress` 等 | 预留给 Phase 2 | 登录 |

主要请求体：

- 项目创建：`{"name": "1–80 字", "platform": "可选", "category": "可选", "description": "≤ 2000 字，可选"}`；项目字段另有 `status`（`active` / `archived`）、`version`、`created_at`、`updated_at`。
- 成果创建：`{"project_id", "artifact_type", "schema_version", "title", "content", "origin": "formal|tutorial_copy", "source_level_id"}`。
- 成果修改：`{"version", "title"?, "content"?}`；内容变化生成新 revision，`version` 加 1。
- 认证提交：`{"artifact_id", "artifact_version", "evidence_ids": [], "note": "≤ 2000 字"}`。提交时把当前 revision 的内容复制为不可变快照（附 SHA-256），附件绑定到该申请。成果已有 pending 申请或版本不一致时返回 409。
- 审核：`{"decision": "approved|rejected", "reason": "驳回必填，1–2000 字"}`；申请非 pending 返回 409 `invalid_state`；审核员不能审核本人申请（403）。

## 10. 数据表（初始迁移）

- `players`：`id`、`acos_sub`（唯一）、`display_name`、`email`、`created_at`、`last_login_at`；不存密码。
- `sessions`：`id_hash`（主键）、`player_id`、`csrf_token`、`created_at`、`last_seen_at`、`expires_at`、`revoked_at`。
- `business_projects`：`id`、`owner_id`、`name`、`platform`、`category`、`description`、`status`、`version`、时间戳。
- `artifacts`：`id`、`project_id`、`owner_id`、`artifact_type`、`schema_version`、`title`、`status`、`origin`、`source_level_id`、`current_revision`、`version`、时间戳。
- `artifact_revisions`：`artifact_id` + `revision`（唯一）、`content`（JSON）、`content_sha256`、`created_by`、`created_at`。
- `evidence_files`：`id`、`owner_id`、`submission_id`（可空）、`storage_key`、`original_filename`、`content_type`、`size_bytes`、`sha256`、`created_at`。
- `verification_submissions`：`id`、`artifact_id`、`owner_id`、`artifact_revision`、`snapshot`（JSON）、`snapshot_sha256`、`note`、`method`、`status`、`created_at`、`decided_at`；同一成果最多一个 pending（数据库唯一约束保证）。
- `verification_reviews`：`id`、`submission_id`、`reviewer_id`、`decision`、`reason`、`created_at`；只追加。
- `audit_events`：自增 `id`、`occurred_at`、`actor_player_id`、`action`、`target_type`、`target_id`、`request_id`、`details`（JSON）；只追加。
- `idempotency_records`：`player_id` + `endpoint` + `key`（唯一）、`request_hash`、`response_status`、`response_body`、`created_at`、`expires_at`。
- 教学进度相关表由 Phase 2 负责人以独立迁移添加。
