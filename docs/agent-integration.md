# 小商 Agent 集成：复用生产运行时

整合日期：2026-10-22。

后端唯一运行时是 `backend/emc_api/services/agent_runtime.py` 和 `backend/emc_api/routers/agent.py`，沿用 #62 的星云数字人 SDK、FastAPI 编排、服务器会话、知识库、工具与审计记录。前端 `js/emc-agent-client.js` 负责以下桥接：

- `POST /api/agent/chat`：游客也能进行教学问答；登录用户的会话按真实服务端身份记录。请求不包含客户端指定的 System Prompt、玩家身份、关系权限或服务器密钥。
- `GET /api/agent/memory`：仅认证用户读取本人亲密度与近期对话，前端根据 `session_id` 筛选当前项目。
- `GET /api/agent/config` 与 `/api/agent/xingyun/*`：继续沿用现有数字人实现，保留 `js/emc-avatar-agent.js` 与头像样式。

**不要恢复** PR 初稿并行的 `backend/emc_api/agent/`、`routers/agent_guest.py`、
`/api/agent/projects/...`、0002–0004 Agent 迁移或 `agent_states` 等数据库表。
本次整合不要求生产数据库增加 Agent 表。

已登录玩家的亲密度由服务端持久化；本地练习的耐心、连续提问和锦囊仅保存在浏览器，不能影响正式认证。游客可以发起 Agent 问答，但没有正式登录权限或云端对话存档承诺。由于旧的审计历史未公开模型来源，旧消息不标成“已验证为 AI”；新消息按服务器 provider 区分真实模型和规则回退。

本地练习去重只存短散列标记而非提问原文；该散列不是密码学保护或安全凭证，旧明文指纹读入时会转换。资料上传、真实平台操作、审核和正式证书只通过现有业务接口，Agent 不得替用户虚报完成情况。

验证：`node --test js/tests/*.test.cjs`、后端 MariaDB `uv run pytest`、
`js/tests/emc-agent-browser.cjs` 和六关 `js/tests/emc-journey-browser.cjs`。
真实星云 SDK 鉴权、安卓微信/OIDC 往返及最后一单认证，仍需在对应真实场景验收。
