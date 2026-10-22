# Docker + frp 部署

公网入口：http://emc.47-110-32-161.sslip.io:7124/

本机入口：http://127.0.0.1:5188/

部署目录：`C:\Dev\ACC\ecommerce-money-copilot\deploy`。
Compose 项目名 `acc-emc`，包含 web、api、db、frpc 四个服务。
Nginx 挂载前端并同源转发 `/api/`、`/auth/` 到 FastAPI。API 使用 `backend/Dockerfile` 构建，运行时读取 `backend/.env`，不将密钥写入镜像或前端。
`.git`、`.tripo`、工具和文档目录不对外发布。

在本目录执行：

```powershell
docker compose --env-file ../backend/.env up -d --build --wait
docker compose --env-file ../backend/.env stop
docker compose --env-file ../backend/.env start
docker compose --env-file ../backend/.env ps
```

链路：公网 TCP 7124 → 47.110.32.161 上的 frps → 本项目 frpc → Nginx 80。
临时域名使用 sslip.io 的 IP 解析服务，无需注册；当前入口使用 HTTP。
Docker 必须保持运行，本机需要在线。容器配置 `unless-stopped` 自动重启。
新增 API 镜像 `acc-emc-api`，数据卷 `acc-emc_agent-db`、`acc-emc_agent-uploads` 保存对话、情感状态与上传。重建后端需要重新构建 API，前端挂载文件刷新即可。

`/api/health` 检查数据库，`/api/agent/capabilities` 确认模型与游客能力；仅 `/healthz` 正常不能证明 AI 可用。
游客 AI 使用独立 HttpOnly Cookie，有效24小时；默认每会话每日20次、全站200次。正式成果仍需登录核验。当前 HTTP 演示使用非 Secure Cookie，HTTPS 部署时应调整允许来源并启用 Secure Cookie。
