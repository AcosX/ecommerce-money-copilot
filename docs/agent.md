# 引导 Agent：接入与接口

现有原生前端 + FastAPI + MariaDB 的增量实现。无需迁移前端框架或数据库。

## 启动

在 `backend/` 运行 `uv sync --frozen`、`uv run alembic upgrade head`，再按 backend/README.md 启动。
数据库须先启动。默认 `EMC_AGENT_PROVIDER=local`，明确返回 `source=local-guide`，不调用模型。

启用模型，在服务端 `.env` 设置：

```dotenv
EMC_AGENT_PROVIDER=compatible
EMC_AGENT_BASE_URL=https://api.openai.com/v1
EMC_AGENT_API_KEY=由部署者填写
EMC_AGENT_MODEL=服务商支持的模型名称
EMC_AGENT_TIMEOUT_SECONDS=12
```

重启 API 生效。接口使用 Chat Completions 的 `messages`、`model`、`max_completion_tokens`；
所选服务商和模型须支持这些参数。密钥只保存在后端，不下发浏览器。
协议依据 [OpenAI Docs](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
生产运行账号新增两张表的授权见 `backend/sql/grants.example.sql`。

## HTTP 契约

三个接口均要求已有登录 Cookie，只能访问自己的项目；写接口沿用 Origin + CSRF。
OpenAPI 定义在 `docs/openapi.json`；开发环境可访问 `/api/docs`。

| 方法与路径 | 用途 |
|---|---|
| `GET /api/agent/projects/{project_id}/state` | 返回权威关系状态；初始 version=1，不写数据库 |
| `GET /api/agent/projects/{project_id}/history?limit=20&before=10` | 按 sequence 向前翻页，页内时间正序，返回 next_before |
| `POST /api/agent/projects/{project_id}/activity` | 活动心跳；返回预估情绪，不推进对话版本 |
| `POST /api/agent/projects/{project_id}/messages` | 完成一个回合，要求 Idempotency-Key |

请求示例：

```json
{
  "message": "预算2000元，想做小红书收纳，应该先验证什么？",
  "version": 1,
  "companion_name": "小商",
  "page_context": {"page": "shop", "selected_item": null}
}
```

成功响应示例（具体分值与内容以实际响应为准）：

```json
{
  "text": "先把目标人群和已有货源列清楚……",
  "source": "ai",
  "state": {"affinity": 21, "patience": 80, "version": 2,
    "level": "L1", "streak": 0, "perks": [], "source": "server"},
  "actions": [{"type": "show_task", "level": "L1"}],
  "sources": [{"id": "knowledge:builtin/guide", "title": "经营带教与核验规则"}],
  "skill_ids": ["category-business-advisor"],
  "turn_id": "agt_..."
}
```

`actions` 为声明式建议，目前支持 `show_task`、`open_kit`、`open_submission`。
前端可映射到自己的交互，不包含 DOM 选择器或脚本，不自动执行发布、上架等操作。
现有界面继续使用任务卡、锦囊与交成果按钮。
`sources` 表示本轮加载的参考资料，不是外部经营事实已核实的证明。
当前采用完整 JSON 回合，尚未实现 SSE 流式输出或模型自主多步工具调用。

错误沿用 `{error:{code,message,request_id,details}}`：

- 401 未登录；403 CSRF 失败；404 项目不存在或不属于当前玩家。
- 409 `version_conflict`：重新 GET state，使用新版本、新幂等键明确发起新回合。
- 409 `invalid_state`：项目已归档。
- 422 参数错误、缺少幂等键，或相同键对应不同请求。
- 429 同项目上次成功回合不足两秒，按 Retry-After 重试。
- 503 `agent_unavailable`：配置、资料或上游失败；本轮不保存、不计分，不冒充成功。

同一操作失败重试须保留原始请求体和幂等键。成功记录在 24 小时内可重放。
同版本并发回合仅一个能提交；模型生成在事务之外，因此并发请求可能产生多次上游调用，
但不会重复计分。浏览器适配器自动保留当前页面生命周期内的失败请求。

## 状态与关系规则

项目所有权由现有登录系统验证。关卡取六种成果的 approved 状态，按顺序寻找未通过的环节；
不会相信客户端传来的 task、history、skill_instructions、system_prompt、好感度或核验结果。
这些字段也不能出现在 POST 请求中。六关通过后进入 first_order，仍不自动认证首单。

状态和回合按项目持久化；项目本身属于玩家。模型不能直接写分数。
独立问题每次 +1 好感，目标明确且补充事实、范围、尝试中的至少两项时 +4、耐心 +4；每天最多五次（UTC 日界）。
同关卡归一化文本去重，最近保留 120 个指纹；连续三次详细问题解锁该关验证锦囊。
基础问题和明确表达困惑的求助不额外扣耐心；持续停滞、三次重复空转问题或明确拖延会扣耐心。
累计休息至少十五分钟后，在成功回合按每五分钟恢复一点（单次最多二十点）；活动时间不算休息。
真实关卡推进时好感 +5、耐心至少恢复到 80；同关卡新的成果内容/状态好感 +2、耐心 +8。
数值、历史和审计记录同事务提交；上游失败不改变状态。
GET state 返回上次持久化数值叠加当前停滞扣减与经营进展的预估结果；预估不推进对话版本。
数值在下一次成功回合结算，失败不计交流奖惩。

## Skill 与知识库扩展

默认复用 `assets/skills/` 的 Skill ZIP，校验 manifest 中的 SHA-256。
按真实关卡和平台选择 Skill，完整流程指令与相关参考片段进入上下文；不解压或运行脚本。
可以设置 `EMC_AGENT_CONTENT_DIR` 指向部署者管理的只读目录，支持：

```text
content/
  agent-catalog.json
  custom-advisor/SKILL.md
  custom-advisor/references/checklist.md
  knowledge/shipping.md
```

`agent-catalog.json` 可覆盖各关卡的 Skill ID，例如 `{"L1":["custom-advisor"]}`。
ID 仅允许小写字母、数字、连字符；也支持 `{p}` 替换成 xhs 或 pdd。
Skill 内容只允许部署者维护，不接受用户指定路径或上传指令文件。
附加知识放 `knowledge/*.md`，单文件最多 64 KB；内置核验规则始终保留。
当前为中文双字词与英文关键词分块检索，最多八个相关片段，上下文总长受限。
这是可替换的轻量检索层。平台知识库另外使用 BM25 倒排索引，不依赖向量数据库；尚未接入外网搜索或自动事实验证。

## Project Context Analysis

### Analysis Purpose

把有好感度、耐心、Skill 和知识参考的引导伙伴融入现有项目，明确前后端边界。

### Codebase Structure

`js/emc-shop-app.js` 编排游戏；`js/emc-copilot.js` 提供对话接口；
`js/emc-companion.js` 保留游客练习。`backend/emc_api/routers/` 负责 HTTP；
`agent/` 为新增的契约、关系规则、内容加载、生成和业务适配层。

### Dependencies

复用 FastAPI、SQLAlchemy、MariaDB、Pydantic、现有认证与幂等服务。
httpx 由开发依赖提升为运行依赖，用于可替换模型服务。

### Connections

前端使用 `EmcAgentClient` 经 `EmcApi` 发送消息；后端读取 BusinessProject 和 Artifact，
通过 AgentRuntime 生成后，写入 AgentState、AgentTurn 和 AuditEvent。

### Architecture Patterns

同步请求、结构化响应；生成接口用 Protocol 隔离模型供应商；关系计算是纯函数。
提交沿用 Galera 重试机制，以项目行锁和版本检查防止并发覆盖。

### Codebase Conventions

新增路由通过 include_api_router 注册；沿用错误信封、CSRF、Cookie、UTC、Alembic，
新表使用 InnoDB、utf8mb4 和 LONGTEXT + json_valid。

### Dependency Graph

```text
shop-app → copilot → agent-client → EmcApi → agent router
                                          ├─ service → existing business models
                                          ├─ relationship → pure rules
                                          └─ runtime → content / Generator
```

### Component Relationships

前端渲染与场景保持独立；适配器不访问 DOM。正式模式显示云端存档并恢复服务端历史；
游客与教学演示继续走本地练习，旧浏览器分数不会导入云端。

### Key Insights

已有完整的业务后端与传输扩展点，无需另建 Node 服务。
不让聊天决定正式成果通过，能保留现有真实结果驱动的产品约束。

## 本地模型联调（2026-10-22）

本机忽略提交的 `backend/.env` 已配置用户指定的 OpenAI Next 兼容服务，
使用 `claude-sonnet-5-5`。带 L1 Skill 的真实请求约 14.8 秒成功，返回 `source=ai`；
密钥不写入文档、示例或版本库。后端网络超时 30 秒，前端请求 35 秒、总等待 40 秒。
服务端 `.env` 修改后须重启 API。此记录不代表已经部署到现有线上静态站点。

参考文档：[服务商快速接入](https://credits.openai-next.com/guide/quickstart)。
飞书正文与 15 份附件均已读取。13 个 Skill ZIP 的 SHA-256 与现有资源完全一致，
沿用现有文件；两份知识库原包保存在 `backend/resources/agent/knowledge/`，
清单记录下载来源、文件 token、哈希和文档数。附件直连接口返回 403 时，
使用 CLI 文档建议的素材预览接口成功取得原始 ZIP，未绕过用户权限。

验证入口：后端 `uv run pytest`；前端单元测试
`node --test js/tests/emc-agent-client.test.cjs js/tests/emc-copilot.test.cjs js/tests/emc-companion.test.cjs`；
当前入口的浏览器回归为 `node js/tests/emc-agent-browser.cjs`，需可用 Playwright 和本地静态服务。

## 已接入的平台知识库

| 平台 | 原始 ZIP | 可检索文档 | 检索片段 | 图片正文未提取的课程 |
|---|---|---:|---:|---:|
| 小红书 | `xiaohongshu.zip` | 57 | 482 | 0（部分文字本身来自 OCR） |
| 拼多多 | `pinduoduo.zip` | 849 | 1307 | 355 |

默认由 `KnowledgeStore` 直接读取 ZIP 内的 Markdown/TXT；不解压到公开目录，
不运行包内 Python，不索引重复原始 JSONL、Excel 目录和 README，也不下载远程讲义图片。
图片课件仅参考已提供的课程简介，明确标注未读取正文；并不代表 849 门课都已获得完整文字讲义。
课程材料可能包含过期活动或 OCR 误识别，回答不得将其当作已核实的当前规则。

索引按平台隔离，校验 manifest 哈希，按文件修改签名缓存。中文双字词、英文词
通过 BM25 评分并加权课程标题，每次最多四个片段、同课程最多两个；为平台知识单独
预留 6000 字符，避免被 Skill 指令挤出上下文。未知平台不检索这两份平台资料。
API `sources` 返回课程标题、稳定片段 ID，以及资料内已有的原文 URL（没有则 null）。

可设置 `EMC_AGENT_KNOWLEDGE_DIR` 指向同结构目录：需要 `manifest.json` 以及
`xiaohongshu.zip` / `pinduoduo.zip`。ZIP 更新后须同步 manifest 哈希；无需迁移数据库。
新增检索测试：`uv run pytest tests/test_agent_knowledge.py`。

2026-10-22 实测：`claude-sonnet-5-5` 带 L5 Skill 与小红书知识参考，
约 14.4 秒返回实际课程内容并注明《商品笔记：爆款的三步通关法则》。
外部资料只放在只读参考消息中，系统权限由后端独立控制。
后端全量 195 项检查通过；随后新增的资料权限边界测试也通过。

## 情感参数与活动计时

正式 AI 模式中，好感度和耐心独立影响回复。好感度决定亲疏：疏离观察、礼貌同行、
熟悉伙伴、亲密搭档；耐心决定措辞：

| 耐心 | 情绪 | 语言表现 |
|---|---|---|
| 75–100 | 耐心 | 舒展地解释，陪用户拆步骤 |
| 55–74 | 催促 | 减少寒暄，直接催行动 |
| 35–54 | 不耐烦 | 反问、吐槽原地打转 |
| 15–34 | 刻薄 | 尖锐挖苦拖延，建议简短 |
| 0–14 | 火大 | 冷硬、重话催促，随后给明确动作 |

高好感低耐心表现为熟人间恨铁不成钢，低好感低耐心更加疏离冷淡。
吐槽针对当下行为，基础答疑、任务入口与业务权限保留。模型不直接修改分数。
`state.emotion` 返回 mood、relationship、warmth、irritability、tone、example、
level_active_seconds、stagnant_seconds、grace_seconds、next_decay_seconds、paused、reason_codes。

新增迁移 `0003`：耐心范围扩展为 0–100；`agent_engagements` 保存项目级活动计时。
运行账号授权见 SQL 示例；部署已有数据库前运行 `uv run alembic upgrade head`。

活动接口接收 `{"reset_clock": false}`（可省略字段）。浏览器每三十秒发一次，隐藏时停止；
初次加载与恢复前台时发 `{"reset_clock": true}`，从新心跳重新开始计时，避免把短暂后台
也计入停滞。服务端仅根据自己的请求时间累计，间隔超过九十秒的区间不计入。
客户端不能上传耗时、好感或耐心；计时为前台使用的保守估计，不用于成果核验。

默认无进展宽限二十分钟，之后每累计五分钟耐心 -5；新成果内容/审核状态会重置停滞计时，
等待成果审核不累计。成果进展以服务端成果内容哈希和状态为准，修改标题或重复相同内容
不算新进展。心跳只写活动表，情感奖惩在消息成功提交时结算一次，保持幂等。

可配置：`EMC_AGENT_EMOTION_GRACE_SECONDS=1200`、
`EMC_AGENT_EMOTION_DECAY_INTERVAL_SECONDS=300`、`EMC_AGENT_EMOTION_DECAY_POINTS=5`。
情感数值/事件不改变经营核验结果。游客本地教学继续使用原有练习规则。

验证：情感纯函数、活动时钟、后台/审核暂停、幂等结算、完整 0–100 区间、模型提示词、
桌面/手机情绪面板与正式模型高低情感对比；具体自动化在 `tests/test_agent_emotion.py`
和 `js/tests/emc-agent-browser.cjs`。
## 游客 AI

`GET /api/agent/capabilities` 返回模型与游客能力开关。`POST /api/agent/guest/session` 初始化隔离教学会话，后续 state、history、activity、messages 使用 `/api/agent/guest` 前缀，沿用版本号、幂等键、服务端情感参数与知识检索。

游客 Cookie 仅限该前缀，HttpOnly、SameSite Strict，24小时有效；写入校验 Origin 和独立 CSRF。游客不能访问正式项目或核验接口。成功回合计入每日限额，幂等重放不重复计入。

完整部署见 `deploy/README.md`。仅静态 Nginx 无法启用 AI，必须启动 API 和数据库。`js/tests/emc-agent-live.cjs` 验收实际浏览器到模型的路径，会调用付费模型，按需显式运行。

