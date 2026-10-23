# 小商网页端星云 Agent

2026-10-23，关联 #62 / #67。页面使用官方 `XingyunAvatarAgent` Web E2E SDK，原来的独立
XmovAvatar 驱动脚本已删除。SDK 保留在本仓库，固定内容散列，来源见 `js/vendor/README.md`。

## 用户路径

仍只有一个聊天输入框。先看任务要求，再让小商每次推进一个问题，整理报告后才进入提交。
首条消息尝试连接原生 Agent；连接建立前失败可以继续文字问答。原生消息发送后不再自动走第二次
模型调用，避免重复扣费和重复写入历史。原生返回自动播报，不再手动 `speak` 同一条回复。

麦克风由用户主动点“语音输入”开启，最多持续 30 秒；识别结果放回当前输入框，用户确认后才发送。
不会自动把 ASR 结果交给模型。静音、打断、形象切换和断开沿用同一小商设置。

## 业务与权限

1. 网页创建 15 分钟传输授权；登录时校验 CSRF，并绑定真实玩家和本次登录会话。
2. 每条提问先通过同源 API 确认。消息、当前关卡、项目和只读游客历史存入短期回执；项目必须属于本人。
3. `ask` 携带用户原文和随机消息票据。星云自定义 Brain 回调 `/api/agent/v1/chat/completions`，
   只能执行此授权下当前已确认的消息；不采用它传来的玩家、关卡、系统提示或历史。
4. 回调调用原有 `run_companion_chat`。真实项目、前序成果、知识库、工具及聊天审计仍由既有服务负责。
   完整回复和工具/UI 元数据通过同源回执返回页面，播报文本以 OpenAI 兼容 SSE 返回星云。
5. 登录失效、授权过期或断开后不能再执行回调；并发重复请求不再调用模型，完成后的相同票据返回已有结果。
   连接关闭仅能终止本授权创建的星云会话，不能带入任意 session_id。旧票据不能执行新消息。

`0003_xingyun_web` 为短时授权和当前消息状态增加一张表；过期行在创建授权时清理。
模型请求在工作线程执行，不阻塞网页轮询。若进程在处理时中断，不自动重放这个消息；重连后由用户重发。
游客仅有随机回执访问权，仍不能读个人资料、保存正式成果或改变审核结果。浏览器不收到模型 API Key、
星云 App Secret 或回调 Bearer；网关响应中的服务密钥会被移除，SDK 自身的短时连接 token 按协议保留。

## 星云配置与发布

真实应用已验证可用。服务端通过现有 App ID/Secret 签名 `/user/v1/ttsa_v2/session`；自定义 Brain
使用官方支持的 `provider: openai`，base_url 为 `EMC_PUBLIC_ORIGIN + /api/agent/v1`。
该地址必须可被星云服务端通过 HTTPS 访问；127.0.0.1 或仅浏览器能访问的地址不能接收云端回调。
保留 `session_speak_req_id: 1`、`framedata_proto_version: 2`、`walk_version: 3`，这些是 SDK 协议参数。
禁止客户端覆盖 Brain 地址、密钥或模型。既有 `EMC_AI_*` 仍控制实际的小商业务模型。

发布要执行 additive migration，并同步 Apache 模板中的 CSP / Permissions-Policy。
CSP 只补实际观察到的 `wss://e2emp.xingyun3d.com`，不使用星云通配符；麦克风限定同源，摄像头继续关闭。
本次只在 Instabox 隔离库验证，未修改线上配置、数据库或服务。

## 验证

- `node --test js/tests/*.test.cjs`：单次请求、文字恢复、自动播报标记、项目通知隔离。
- 后端 pytest：MariaDB 迁移、登录/项目隔离、CSRF、票据篡改、撤销/过期、重复回调、断开隔离和并发轮询。
- `js/tests/emc-xingyun-web-live.cjs`：通过 `EMC_TEST_SESSION_FILE` 指定隔离环境的私有登录信息；
  真实 SDK + 云端回调 + 小商模型 + 数据库，1440/390px 完成任务 → 对话 → 报告 → 提交 → L2 → 按需锦囊。
- 原生 ASR 实测使用 FunASR 官方公开中文 WAV 作为浏览器音源，识别到完整文本；关闭自动提问后未触发 LLM。
  `js/tests/emc-xingyun-voice-live.cjs` 通过 `EMC_ASR_TEST_WAV` 指定本地音源，在部署 CSP 和同源麦克风策略下验证识别回填、确认发送、真实模型、实际 Opus 语音字节及断开撤销。
  音频仅为隔离测试输入，未放入产品或仓库。来源：https://github.com/modelscope/FunASR

官方 Web 概览：https://www.xingyun3d.com/developers/67-541
Brain 配置：https://www.xingyun3d.com/developers/72-573

本次是原生 Web 交互与自定义 Brain 接入。平台托管 Agent 工具编排迁移、正式证书签发/撤销及结业
一致性核验没有被标成已完成。
