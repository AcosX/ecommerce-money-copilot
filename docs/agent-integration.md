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

2026-10-23 对话调优：登录对话在数据库查询时按玩家和 `session_id` 过滤，最近六轮作为真实
user/assistant 消息送入模型；游客由浏览器携带最多 12 条 `guest_history`，只接受 user/assistant
角色，不作持久化或权限依据。登录用户不采用客户端伪造的历史。浏览器同步当前平台、类目和任务，
模型同时收到计算、审核、草稿和界面操作的真实结果；引用资料仅供参考，不再强制引用课程或通关清单。
无主题命中时返回空检索，明确平台时排除其他平台资料，避免预算数字匹配课程编号。

模型超时默认 20 秒（`EMC_AI_TIMEOUT_SECONDS`），请求上限 25 秒，低于前端 35 秒期限；
不再强制截为 2.5 秒。兼容带 `/v1` 的网关地址。临时失败后短暂熔断 10 秒；失败仍明确标记
`local_copilot_fallback`，不会把规则回复标成真实模型。若网关返回 429 且提示
`All available accounts exhausted`，需网关方恢复可用账号/额度或配置有效上游，提示词无法解决。

算账仅提取有售价、拿货/成本等标签的数据，保留亏损情况，计入明确的运费、包材、佣金，列出
缺失费用，不再把估算毛利标成净利或生成无依据的评分。参考与计算以可折叠卡片展示，使用页面主题色。
新增检查：`pytest tests/test_agent_dialogue.py tests/test_agent_runtime.py`、
`node js/tests/emc-agent-dialogue-browser.cjs`（需要 Playwright，可用 `EMC_PLAYWRIGHT_MODULE` /
`EMC_CHROMIUM` 指定模块与浏览器）。浏览器检查在本地临时端口提供页面，模拟 API，验证游客追问、
日夜主题对比度和手机溢出；它不代表真实网关可用性。

当前部署上游使用 `EMC_AI_BASE_URL=https://api.openai-next.com`，对话和预审模型均为
`deepseek-v4-1-flash-261017`。API 密钥只放在本地 `.env` 或生产主机
`/etc/ecommerce-money-copilot/app.env`，不进入 Git，也不下发浏览器。

纯算账请求直接以 Decimal 工具验算结果生成费用明细，provider 为 `verified_calculation`，
界面和恢复的历史均标注“工具验算”，不调用模型扩展数字。混合文案、规划和情景任务继续使用模型，
同时传入验算结果并约束其说明缺失参数；不把不完整成本下的差额称为净利润或保证保本。
