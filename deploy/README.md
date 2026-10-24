# 可选的本地 Docker 演示栈

`compose.yaml`、`nginx.conf` 和 `backend/Dockerfile` 来自本 PR 的本地开发演示方案，
**不是 VM3 生产部署路径**。只能使用隔离的开发数据库、端口及密钥。

生产站 `money.acosx.top` 继续使用版本化脚本 `emc-deploy <tag>`，
必要时运行 `deploy/scripts/install-host.sh` 更新 Apache。
健康检查是 `GET /api/health`、`GET /api/agent/config`；
聊天接口为 `POST /api/agent/chat`。已删除的并行 Agent 路由
`/api/agent/capabilities` 和 Agent Guest Cookie 并不存在，切勿照旧文档启用。

部署前备份数据库并检查迁移；部署后检查 Apache、服务、上传、模型资源和公共 API。
出现异常应回滚到最近已验收标签。

模型展示入口为 `/tools/models.html`，部署时须同步本次 Apache 精确放行清单，否则旧 vhost 会返回 403。页面链路、缓存与验收见 [模型展示发布说明](../docs/model-showcase.md)。

## 本地栈验收

API 的教学资源随 `backend/emc_api/data` 一起复制进镜像，不需要额外的
`backend/resources` 目录或旧的 skills 挂载。本地 API 的同源地址为
`http://127.0.0.1:5188`，与 web 入口一致。

安装 Docker Compose v2 后，在仓库根目录运行：

```sh
python deploy/tests/smoke_local_stack.py
```

该命令使用随机项目名、临时开发密钥和独立数据卷，只启动 `db`、`api`、`web`，
不会启动 frpc。请先确保本机 `127.0.0.1:5188` 空闲；验收结束（包括失败时）会清理
本次项目的容器和数据卷。`EMC_DEV_ENV_FILE` 可指定替代的 API env 文件，
默认仍读取 `backend/.env`；验收脚本不覆盖该文件。

验收包含镜像构建、数据库迁移、健康检查、静态入口，以及真实 Nginx 链路的
2 MiB / 10 MiB PNG 上传和逐字节下载校验。`/api/evidence` 的代理请求体上限为
11 MiB，为 10 MiB 文件预留 multipart 开销；10 MiB + 1 字节仍由应用返回 JSON 413，
其他 API 保留 Nginx 默认请求体限制。GitHub Actions 的 `local-stack` 执行相同验收。

## 浏览器回归

```sh
node js/tests/check-syntax.cjs
node js/tests/emc-mobile-layout-browser.cjs
node js/tests/emc-scene-recovery-browser.cjs
```

浏览器回归需要已安装的 Playwright 和一个在 `EMC_TEST_URL` 提供仓库根目录的
静态服务器（默认 `http://127.0.0.1:5173/`）。默认使用 Playwright 自带 Chromium；
可通过 `EMC_PLAYWRIGHT_MODULE` 指定模块路径，`EMC_CHROMIUM` 指定浏览器可执行文件，
或通过 `EMC_BROWSER_CHANNEL` 选择本机通道。场景恢复另支持 `EMC_BROWSER=webkit`
（需安装 WebKit）。移动截图输出到 `EMC_MOBILE_SHOTS` 或系统临时目录。

CI 对所有已跟踪 JS/CJS/MJS 文件执行语法检查，并实际运行移动布局的五种视口
及场景恢复回归；移动截图作为 artifact 保留。
