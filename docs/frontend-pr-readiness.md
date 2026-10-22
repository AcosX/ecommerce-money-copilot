# 前端 PR 核对与描述草稿

核对日期：2026-10-22。范围：飞书《搞钱参谋用户旅程&玩法》及已认领 #16–#22、#38–#40、#46，另含 #61/#62 的 Agent 实现（本次一并提交，供对方自行决定融合方式）。

## 结论

适合按「六关前端体验与成果提交 + 可选 Agent 模块」提交 Draft PR；不应宣称完成全部教学云存档或移动端真实登录验收。正式 ready 前需处理下面的测试失败并确认本次范围。

## 关于本次新增的 Agent 模块

`backend/emc_api/agent/`、`routers/agent.py`、`routers/agent_guest.py`、alembic 0002–0004、`docs/agent.md` 与 `js/emc-agent-client.js` 构成一套独立的小商 Agent。

- **不依赖任何第三方 Agent SDK**，仅用 FastAPI + SQLAlchemy + pymysql 等既有栈实现，便于对方按自身架构取舍。
- 与主玩法耦合很浅：`js/emc-agent-client.js` 是可选增强，前端不接也不影响六关流程。
- **可整体回退**：删除 agent 路由与其前端调用即可不影响教学关卡与既有 API。
- 合并方式请对方自行决定：整体合入、拆分合入或直接删除均可。

## Issue 核对

| Issue | 当前证据 | 尚未完成/不能宣称完成 |
|---|---|---|
| #16 | EmcTutorialSave 有 schema_version、L1–L6 白名单和模拟/正式字段隔离 | 新试玩使用另一套 emc-journey-demo-v1 状态，尚未统一接入版本化教学存档 |
| #17 | 旧教学存档具备备份、损坏恢复、超额保护，单元测试通过 | 新试玩保存失败静默处理；notes 写入后没有在初始化中恢复 |
| #18–#20 | 契约预留教学进度接口 | 当前 backend 路由与现用前端均未接入教学云存档读取/更新/导入；合并、重复导入、冲突处理未完成 |
| #21 | 正式六关读取服务端成果，试玩不发正式成果请求；证书保持演示/预览标识 | 账号导入接入后仍需验证不能提升为正式认证 |
| #22 | 旧存档异常单元检查、登录与退出浏览器检查已有 | 新试玩刷新、跨设备、重复导入等完整验收未完成 |
| #38 | 正式/试玩模式、受限操作登录提示和服务器审核门控已有 | 旧账号回跳测试与居中弹窗交互不兼容，需修正并复测 |
| #39 | 六关统一任务定义、分组附件上传、提交与审核回执、重试幂等已实现 | 本次浏览器上传为真实 multipart 文件请求，但业务后端是 mock，不能当真实服务器端到端验收 |
| #40 | 入场、任务、锦囊、工作纸、正式上传、状态与演示证书已有 | 教学转账号云存档与正式首单核验未闭环；不得自动关闭此 issue |
| #46 | 有 320/390/1440px 浏览器测试 | 缺真实 iOS/安卓微信中的 OIDC 登录、注册、回调验证 |

## 飞书玩法对照

- 已有：小红书/拼多多、通用 Agent 选项、L1–L6 任务与锦囊、13 个 Skill ZIP、奖励映射、前后图与上架/发布证据、复盘工作纸。
- 已有：依次审核通过后解锁下一关，符合当前飞书旧玩法；本 PR 不改为 V2 的提交即解锁。
- 尚未闭环：真实首单提交与审核、正式证书/海报/徽章授予。当前入口明确提示未开放，不冒充已认证。
- 小商真实 AI 属于独立集成依赖，当前本地教学回复需如实说明。

## PR 范围

当前分支 feat/pixel-island-account；相对 origin/main 共 69 个提交。本次工作区未提交改动包含：模块化建筑 v3 及其 GLB 产物（assets/models/buildings/、assets/models/buildings-v3/、tools/build-modular-stores.py、tools/pack-game-buildings.cjs）、建筑分件预览（tools/island-buildings-preview.html、js/emc-building-parts.js）、可复用部署配置（deploy/compose.yaml、nginx.conf、README.md；frpc.toml 保留在本机不入库）、Agent 模块与知识库资源，以及本机 README 改动。

`assets/models/buildings/` 下的 12 个 GLB 已被工作区 manifest 引用，一并提交以避免仓库出现断裂引用；制作源与中间产物仍保留在本地不入库。

## 验证记录

- node --test js/tests/*.test.cjs：**52/52 通过**。其中模型性能用例已随 manifest schema 重构同步修正：`tools/pack-game-buildings.cjs` 只压缩贴图负载、保留几何，故建筑断言改为「lite 面数与源一致且体积小于 web」，浮岛由 `tools/optimize-models.cjs` 减面生成，保留「显著减面 + 体积减半」的严格检查；两种 schema（旧的 generation/delivery 与新的扁平 bytes/triangles）均可解析。
- 建筑 GLB 与 manifest 中的 texture_max_dimension 已补齐为 web 2048 / lite 1024，与打包脚本实际输出一致。
- git diff --check：干净。
- 后端 pytest：test_agent_knowledge.py 等 11 项通过；9 项依赖数据库的用例在当前环境 **无法执行**——`emc` 账号仅有 `emc.*` 权限，无法创建 `emc_test_*` 库，属环境限制而非代码缺陷，需在具备建库权限的 CI 或数据库上复测，不得据此宣称通过。
- 单独复现 test_login_returns_to_current_panel[settings]：失败；打开居中设置弹窗后直接点击弹窗背后的 #emcLoginBtn，被 drawer-header 拦截。需要让测试使用可达入口，并继续验证回跳行为，不应强制 click 掩盖问题。
- emc-journey-browser.cjs：1440px 与 390px 的 L1–L6 共 12 组全部通过；另通过真实文件下载内容比对、上传失败重试复用、平台工具筛选、锁定奖励、新建项目、跨关草稿隔离、会话刷新不中断上传及驳回补交检查。测试页面使用本机 5188 静态服务，业务 API 由测试拦截为 mock。
- 已人工查看桌面与 390px 的 L3 上传页截图；截图仅作为布局证据，不代表真实手机测试。
- 浏览器业务接口为 mock，不代表真实 OIDC / MariaDB / 微信验收。

## PR 描述草稿

标题：feat(frontend): 完善六关经营旅程、模块化建筑与可选小商 Agent

玩家现在可通过任务来信领取锦囊和 Skill，在六关工作纸中整理实操思路，并按关卡要求上传成果附件。正式进度根据服务端审核结果解锁，试玩与正式认证保持隔离，支持提交失败重试、驳回补交与进度回执。

同时接入浮岛店铺、小商模型与动作、装修、音效及移动布局；角色和素材制作工具随源码保留。建筑改为模块化硬表面资产，打包流程只压缩贴图负载、保留源几何，模型体积断言随该策略同步更新。

### 可选：Agent 模块

本次附带一套独立的小商 Agent（`backend/emc_api/agent/`、`routers/agent*.py`、alembic 0002–0004、`docs/agent.md`、`js/emc-agent-client.js`）。

**请按贵方架构自行决定如何融合**：

- 不依赖任何第三方 Agent SDK，仅使用 FastAPI + SQLAlchemy + pymysql 等既有技术栈实现。
- 与主玩法耦合很浅，删除 agent 路由及其前端调用不影响六关流程与既有 API。
- 可整体合入、拆分合入，或直接删除。

### 不在本次完成声明内

证书目前为演示或预览；真实 AI、教学云存档合并与正式首单授予不在本次完成声明中。

关联：#16、#17、#21、#22、#38、#39、#40、#46（均采用 Related/Refs，不自动关闭；#18–#20 作为未完成依赖说明；#61/#62 以可选模块形式提供）。

验证：52 项前端单元测试通过；浏览器回归结果见 docs/frontend-pr-readiness.md。后端 Agent 的数据库依赖用例需在具备建库权限的环境复测，账号回跳回归仍有失败，故 PR 保持 Draft，真实手机与微信 OIDC 待验收。
