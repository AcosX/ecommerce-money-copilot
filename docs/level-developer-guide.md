# 关卡开发者接口与模拟数据指南（#37）

本文档面向六关（L1–L6）玩法与前端适配层开发者，提供同源 API 调用方式、请求/响应示例、错误码对照表、成果 Schema 注册方法以及各关可直接复用的模拟数据（Mock Data）。

完整机器可读 OpenAPI 3.1 规范见 [`docs/openapi.json`](./openapi.json)，基础契约见 [`docs/backend-contract.md`](./backend-contract.md)。

---

## 1. 同源调用与前端基础组件（`#41`）

游戏前端与 FastAPI 后端通过同源路径（`/api/*`、`/auth/*`、`/admin/`）通信，浏览器自动携带 `HttpOnly` 会话 Cookie `emc_session`，前端无需也不得在 `localStorage`、`sessionStorage` 或 JS 可读 Cookie 中保存任何身份令牌。

页面已内置四个前端脚本（按顺序加载）：

1. `js/emc-route.js`（`window.EmcRoute`）：管理 `#view=<视图>&lv=<1-6>&gate=<操作名>`，支持登录往返后恢复原视图与关卡。
2. `js/emc-api.js`（`window.EmcApi`）：同源请求封装，自动附加 `X-CSRF-Token` 与 `Idempotency-Key`，并将后端错误响应解析为 `EmcApi.EmcApiError`。
3. `js/emc-session.js`（`window.EmcSession`）：管理 `/api/me` 会话状态，提供 `EmcSession.requireLogin(actionName)` 与 `emc:session-changed` 事件。
4. `js/emc-formal-ui.js`（`window.EmcFormalUI`）：状态徽章渲染与真实经营工作台（区分「教学通关（仅前端本地）」「草稿」「待审核」「正式认证通过」「已驳回」）。

### 调用示例

```javascript
// 1. 要求已登录（未登录会弹出像素风登录提示框，登录后自动回到当前关卡）
if (!(await EmcSession.requireLogin('生成正式选品单'))) return;

// 2. 创建经营项目（自动带 X-CSRF-Token 与 Idempotency-Key）
const project = await EmcApi.post('/api/projects', {
  name: '女装高腰半身裙破零项目',
  platform: 'xiaohongshu',
  category: 'womenswear',
  description: '主打小个子通勤显瘦实拍'
});

// 3. 将教学练习成果复制为正式草稿（origin = "tutorial_copy"）
const artifact = await EmcApi.post('/api/artifacts', {
  project_id: project.id,
  artifact_type: 'business_plan',
  schema_version: 1,
  title: 'L1 经营方案（练习转正式草稿）',
  origin: 'tutorial_copy',
  source_level_id: 'L1',
  content: {
    niche: '通勤半身裙',
    platform: 'xiaohongshu',
    differentiation: '155cm 小个子高腰 A 字版型真人实测',
    first_order_goal: { sku_count: 3, target_price_yuan: 79, window_days: 14 }
  }
});
```

---

## 2. 模式与状态严格分离（`#36`）

| 模式 / 状态 | 字段取值 | UI 展示文案 | 含义与约束 |
| --- | --- | --- | --- |
| 教学通关 | 前端本地状态 | `教学通关（仅前端本地）` | 仅代表完成本地模拟练习，**绝不代表正式认证通过** |
| 正式草稿 | `Artifact.status = "draft"` | `草稿`（若 `origin="tutorial_copy"` 额外标注 `来自教学模拟`） | 已保存到玩家账号下，可继续通过 `PATCH /api/artifacts/{id}` 编辑 |
| 待审核 | `Artifact.status = "submitted"` / `VerificationSubmission.status = "pending"` | `待审核` | 已冻结不可变成果快照并绑定证据附件，等待审核员人工核验，期间锁定编辑 |
| 正式认证通过 | `Artifact.status = "approved"` / `VerificationSubmission.status = "approved"` | `正式认证通过` | 审核员人工审核通过，计入真实经营认证结果 |
| 已驳回 | `Artifact.status = "rejected"` / `VerificationSubmission.status = "rejected"` | `已驳回`（附 `rejection_reason`） | 审核员驳回并给出原因；玩家修改成果（生成新 revision）后可再次提交新认证申请 |

---

## 3. 六关成果类型与 Schema 扩展方法

| 关卡 `level_id` | 关卡名称 | `artifact_type` | 当前校验级别 |
| --- | --- | --- | --- |
| `L1` | 生意规划 | `business_plan` | V1 强类型校验（`BusinessPlanContentV1`） |
| `L2` | 选品落地 | `product_selection` | V1 强类型校验（`ProductSelectionContentV1`） |
| `L3` | 素材优化 | `asset_pack` | 受限 JSON 对象（支持 `register_artifact_schema` 扩展） |
| `L4` | 自动化上架 | `listing_record` | 受限 JSON 对象（支持 `register_artifact_schema` 扩展） |
| `L5` | 内容生成发布 | `content_post` | 受限 JSON 对象（支持 `register_artifact_schema` 扩展） |
| `L6` | 数据复盘 | `data_review` | 受限 JSON 对象（支持 `register_artifact_schema` 扩展） |

所有成果的 `content` 序列化后大小须 `<= 128 KiB`，JSON 嵌套深度 `<= 8`，且均预留可选字典字段 `extensions: dict[str, Any]`。

### 为 L3–L6 注册强类型 Schema

在 `backend/emc_api/services/artifact_types.py` 中调用 `register_artifact_schema` 即可在不修改数据库表结构的情况下收紧校验：

```python
from pydantic import BaseModel, ConfigDict, Field
from emc_api.services.artifact_types import register_artifact_schema

class AssetPackContentV1(BaseModel):
    model_config = ConfigDict(extra="allow")
    main_images: list[str] = Field(min_length=1, max_length=10)
    self_check_passed: bool

register_artifact_schema("asset_pack", 1, AssetPackContentV1)
```

---

## 4. 核心接口请求与响应示例

### 4.1 查询当前会话 `GET /api/me`

未登录响应（`200 OK`）：
```json
{
  "authenticated": false
}
```

已登录响应（`200 OK`）：
```json
{
  "authenticated": true,
  "player": {
    "id": "ply_7x9k2m4p8q1w3e5r6t8y0u2i4o",
    "display_name": "店主阿商",
    "email": "merchant@example.com"
  },
  "roles": ["player"],
  "csrf_token": "r4nd0m_csrf_t0k3n_str1ng"
}
```

### 4.2 创建经营项目 `POST /api/projects`

请求：
```json
{
  "name": "小红书春季通勤女装店",
  "platform": "xiaohongshu",
  "category": "womenswear",
  "description": "专注 150-160cm 小个子梨形身材半身裙"
}
```

响应（`201 Created`）：
```json
{
  "id": "prj_3k8m2n5p7q9r4t6v8x0z2b4d6f",
  "owner_id": "ply_7x9k2m4p8q1w3e5r6t8y0u2i4o",
  "name": "小红书春季通勤女装店",
  "platform": "xiaohongshu",
  "category": "womenswear",
  "description": "专注 150-160cm 小个子梨形身材半身裙",
  "status": "active",
  "version": 1,
  "created_at": "2026-10-21T08:00:00Z",
  "updated_at": "2026-10-21T08:00:00Z"
}
```

### 4.3 创建与更新正式成果 `POST /api/artifacts` & `PATCH /api/artifacts/{id}`

创建请求（`POST /api/artifacts`）：
```json
{
  "project_id": "prj_3k8m2n5p7q9r4t6v8x0z2b4d6f",
  "artifact_type": "product_selection",
  "schema_version": 1,
  "title": "春季通勤半身裙首批选品单",
  "origin": "formal",
  "content": {
    "items": [
      {
        "name": "高腰垂感西装A字半身裙",
        "source_platform": "1688",
        "target_platform": "xiaohongshu",
        "supply_price_yuan": 35.0,
        "retail_price_yuan": 89.0,
        "scores": { "heat": 86, "competition": 70, "growth": 82, "margin": 85 }
      }
    ]
  }
}
```

更新请求（`PATCH /api/artifacts/{id}`，仅 `draft` 或 `rejected` 状态可修改，必须传当前 `version`）：
```json
{
  "version": 1,
  "title": "春季通勤半身裙首批选品单（修订版）",
  "content": {
    "items": [
      {
        "name": "高腰垂感西装A字半身裙（升级抗皱面料）",
        "source_platform": "1688",
        "target_platform": "xiaohongshu",
        "supply_price_yuan": 38.0,
        "retail_price_yuan": 95.0,
        "scores": { "heat": 88, "competition": 74, "growth": 84, "margin": 86 }
      }
    ]
  }
}
```

### 4.4 上传证据附件 `POST /api/evidence`

- `Content-Type: multipart/form-data`，文件字段名为 `file`。
- 允许格式：PNG / JPEG / WebP / PDF（服务端按文件头魔数严格校验，单文件 `<= 10 MiB`）。

响应（`201 Created`）：
```json
{
  "id": "evd_9p2q4r6s8t0u2v4w6x8y0z2a4b",
  "owner_id": "ply_7x9k2m4p8q1w3e5r6t8y0u2i4o",
  "submission_id": null,
  "original_filename": "order_screenshot.png",
  "content_type": "image/png",
  "size_bytes": 184320,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "download_url": "/api/evidence/evd_9p2q4r6s8t0u2v4w6x8y0z2a4b/content",
  "created_at": "2026-10-21T08:05:00Z"
}
```

### 4.5 提交人工认证申请 `POST /api/verifications`

请求：
```json
{
  "artifact_id": "art_5m7n9p1q3r5s7t9u1v3w5x7y9z",
  "artifact_version": 2,
  "evidence_ids": ["evd_9p2q4r6s8t0u2v4w6x8y0z2a4b"],
  "note": "已完成首单真实发货，附上小红书订单后台截图与快递轨迹凭证"
}
```

响应（`201 Created`）：
```json
{
  "id": "ver_1a3b5c7d9e1f3g5h7j9k1m3n5p",
  "artifact_id": "art_5m7n9p1q3r5s7t9u1v3w5x7y9z",
  "owner_id": "ply_7x9k2m4p8q1w3e5r6t8y0u2i4o",
  "artifact_revision": 2,
  "snapshot": {
    "artifact_id": "art_5m7n9p1q3r5s7t9u1v3w5x7y9z",
    "project_id": "prj_3k8m2n5p7q9r4t6v8x0z2b4d6f",
    "artifact_type": "product_selection",
    "schema_version": 1,
    "title": "春季通勤半身裙首批选品单（修订版）",
    "origin": "formal",
    "source_level_id": null,
    "revision": 2,
    "content_sha256": "…",
    "content": { "items": [ "..." ] }
  },
  "snapshot_sha256": "…",
  "method": "manual_review",
  "status": "pending",
  "note": "已完成首单真实发货，附上小红书订单后台截图与快递轨迹凭证",
  "rejection_reason": null,
  "evidence_files": [
    {
      "id": "evd_9p2q4r6s8t0u2v4w6x8y0z2a4b",
      "original_filename": "order_screenshot.png",
      "content_type": "image/png",
      "size_bytes": 184320,
      "sha256": "…",
      "download_url": "/api/evidence/evd_9p2q4r6s8t0u2v4w6x8y0z2a4b/content",
      "created_at": "2026-10-21T08:05:00Z"
    }
  ],
  "reviews": [],
  "created_at": "2026-10-21T08:06:00Z",
  "decided_at": null
}
```

---

## 5. 错误码完整对照表

所有错误响应格式统一为：
```json
{
  "error": {
    "code": "version_conflict",
    "message": "资源版本冲突，请刷新后重试",
    "request_id": "req_8f9a0b1c2d3e4f5g6h7j8k9l0m",
    "details": {}
  }
}
```

| `error.code` | HTTP 状态码 | 触发场景 | 前端处理建议 |
| --- | --- | --- | --- |
| `unauthenticated` | `401` | 未登录或服务端会话已过期 | `EmcSession` 会自动更新为未登录态，调用 `EmcSession.requireLogin(action)` 引导重新登录 |
| `csrf_failed` | `403` | 缺少 `X-CSRF-Token`、与当前会话不匹配，或 `Origin`/`Referer` 非同源 | 通过 `EmcApi` 调用可自动携带 CSRF 头；若仍失败可调用 `EmcSession.getMe({force: true})` 刷新 |
| `forbidden` | `403` | 非审核员访问 `/api/admin/*`，或审核员尝试审核本人提交的申请 | 提示无权限执行该操作 |
| `not_found` | `404` | 资源 ID 不存在，或不属于当前登录玩家（防枚举统一返回 404） | 提示资源不存在并刷新列表 |
| `method_not_allowed` | `405` | HTTP 方法不支持 | 检查请求方法 |
| `version_conflict` | `409` | `PATCH` 或 `POST /api/verifications` 传入的 `version` 与数据库当前版本不一致 | 重新 `GET` 最新资源后提示用户确认合并 |
| `invalid_state` | `409` | 编辑 `submitted`/`approved` 状态的成果、同一成果重复提交 `pending` 申请、或重复审核已决申请 | 刷新当前成果与申请状态 |
| `payload_too_large` | `413` | 普通 JSON 请求体 `> 256 KiB`，或证据文件 `> 10 MiB` | 提示精简内容或压缩图片/PDF |
| `unsupported_media_type` | `415` | 上传文件魔数不是 PNG / JPEG / WebP / PDF | 提示仅支持 PNG、JPEG、WebP 图片或 PDF 文档 |
| `validation_error` | `422` | 字段缺失、类型不符、成果 `content` 超 128 KiB 或嵌套超 8 层 | 读取 `error.details.errors` 高亮对应表单项 |
| `idempotency_key_reuse` | `422` | 24 小时内同一 `Idempotency-Key` 被用于不同请求体 | 新请求务必使用新的 `Idempotency-Key`（`EmcApi` 默认自动生成） |
| `rate_limited` | `429` | 触发频率限制 | 按提示稍后重试 |
| `internal_error` | `500` | 服务端未预期异常 | 展示通用错误提示并附上 `error.request_id` 便于排查 |

---

## 6. 六关标准模拟数据（Mock Payloads）

以下 JSON 负载均可通过 `POST /api/artifacts` 的服务端校验，可直接用于关卡联调与自动化测试：

```json
{
  "L1_business_plan": {
    "artifact_type": "business_plan",
    "schema_version": 1,
    "title": "L1 生意规划：小个子通勤半身裙破零方案",
    "origin": "formal",
    "content": {
      "niche": "小个子高腰A字半身裙",
      "platform": "xiaohongshu",
      "differentiation": "155cm 真人实拍对比 + 不显胯版型筛选",
      "first_order_goal": {
        "sku_count": 3,
        "target_price_yuan": 79,
        "window_days": 14
      }
    }
  },
  "L2_product_selection": {
    "artifact_type": "product_selection",
    "schema_version": 1,
    "title": "L2 选品落地：四维评估选品单",
    "origin": "formal",
    "content": {
      "items": [
        {
          "name": "高腰防走光百褶半身裙",
          "source_platform": "1688",
          "target_platform": "xiaohongshu",
          "supply_price_yuan": 29.5,
          "retail_price_yuan": 79.0,
          "scores": {
            "heat": 88,
            "competition": 72,
            "growth": 85,
            "margin": 84
          }
        }
      ]
    }
  },
  "L3_asset_pack": {
    "artifact_type": "asset_pack",
    "schema_version": 1,
    "title": "L3 素材优化：首图与详情页素材包",
    "origin": "formal",
    "content": {
      "sku_name": "高腰防走光百褶半身裙",
      "cover_Copywriting": "155cm 小个子实测！高腰显腿长 5cm",
      "image_count": 6,
      "self_check": {
        "no_prohibited_words": true,
        "aspect_ratio": "3:4",
        "clear_selling_point": true
      }
    }
  },
  "L4_listing_record": {
    "artifact_type": "listing_record",
    "schema_version": 1,
    "title": "L4 自动化上架：商品上架核查记录",
    "origin": "formal",
    "content": {
      "platform": "xiaohongshu",
      "platform_item_id": "xhs_item_20261021_001",
      "sku_count": 3,
      "price_yuan": 79.0,
      "stock_total": 150,
      "status": "on_sale"
    }
  },
  "L5_content_post": {
    "artifact_type": "content_post",
    "schema_version": 1,
    "title": "L5 内容生成发布：种草笔记发布记录",
    "origin": "formal",
    "content": {
      "platform": "xiaohongshu",
      "post_title": "155 小个子春季通勤穿搭｜这条高腰A字裙我能穿一整个春天",
      "tags": ["小个子穿搭", "半身裙推荐", "春季通勤穿搭"],
      "manual_checked": true,
      "scheduled_at": "2026-10-22T12:00:00Z"
    }
  },
  "L6_data_review": {
    "artifact_type": "data_review",
    "schema_version": 1,
    "title": "L6 数据复盘：首单破零与归因复盘报告",
    "origin": "formal",
    "content": {
      "impressions": 4280,
      "clicks": 386,
      "ctr_percent": 9.02,
      "orders_count": 2,
      "gmv_yuan": 158.0,
      "first_order_achieved": true,
      "next_iteration_plan": "放大封面图对比卖点，追投高点击率笔记评论区置顶链接"
    }
  }
}
```
