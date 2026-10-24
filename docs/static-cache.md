# 前端拆分与 ESA 最少缓存规则

2026-10-24 检查仓库 Apache 模板及线上 HEAD 响应。前端是无打包器的静态页面，已经拆成独立文件，不是所有代码塞在首页。

| 路径 | 内容 | 线上 Cache-Control | ESA 建议 |
| --- | --- | --- | --- |
| `/`、`/index.html` | 入口、import map、少量内联 UI | `no-cache` | 保留重新验证 |
| `/assets/` | 大多数 CSS、Three.js、图片/模型、技能包、模板 | `public, max-age=3600` | 保留一条前缀规则，遵循源站 |
| `/assets/models/manifest.json` | 未指纹化的模型索引 | `no-cache` | 遵循源站例外 |
| `/js/`、`/css/` | 独立业务脚本、模块图、数字人样式 | `no-cache` | 当前不新增强制缓存 |
| `/tools/` 公开展示清单 | 模型展示中心与演进页 | `no-cache` | 当前不新增强制缓存 |
| `/api/`、`/auth/` | 用户态数据、登录回调 | 动态响应 | 不加入静态匹配范围 |

## 推荐：仍只保留一条 `/assets/` 规则

匹配 **URI 路径以 `/assets/` 开头**，而非字符串包含 `/assets`。缓存资格可设为符合缓存条件，边缘 TTL、浏览器 TTL **遵循源站**，保留全部查询参数参与缓存键，不能忽略版本参数 `v`。不要选择忽略源站缓存策略并强制使用统一 TTL，否则会覆盖模型索引的 `no-cache`。

无需因为内容拆分而逐个增加 `/js/`、`/css/`、`/tools/` 条目；当前它们要求重新验证，加上规则也不会带来长时间边缘命中。`no-cache` 允许验证后复用，并不等于 `no-store`。文件已有 ETag / Last-Modified。

若以后完成文件名内容指纹和模块依赖同步改写，可把现有单条规则改成 `/assets/ OR /js/ OR /css/`，仍为一条规则。当前仅部分入口有 `?v=`，ES 模块的相对依赖未全部版本化，不能据此给全部 JS 强制长缓存。迁移所有路径到 `/assets/` 对当前规则数量没有收益，还会改动 import map、模块相对路径、后端静态路由和展示中心，暂不做。

本次新增报告壳、CSS、脚本和示例 JSON 均在 `/assets/reports/`，Excel 在 `/assets/templates/`，技能包在 `/assets/skills/`，直接复用现有规则。固定文件名的内容更新上线时，可清理对应 URL 的旧边缘缓存，或等待源站设定的 1 小时 TTL；发布不应给私有用户报告使用公共 JSON 路径。

本次只审计仓库和公开响应，未修改 ESA 控制台。无法从 HTTP 响应确认控制台是否另设 TTL 覆盖或忽略查询参数，需按上述选项核对现有这一条规则。

官方依据：[ESA 缓存策略](https://www.alibabacloud.com/help/en/edge-security-acceleration/esa/user-guide/get-started-with-cache)、[全局缓存配置](https://help.aliyun.com/en/edge-security-acceleration/esa/user-guide/global-cache-configuration-overview/)。
