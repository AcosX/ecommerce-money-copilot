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
