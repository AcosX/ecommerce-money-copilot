"""小商伴随式数字人 Agent 与六关（L1–L6）成果审核运行时（#62）。

架构选型（ADR 结论）：
- 采用【方案 ③：魔珐星云 3D 数字人 SDK (XmovAvatar) + 自建 FastAPI Agent Runtime】。
- 所有业务真源（玩家身份、店铺上下文、关卡进度、长期记忆、工具权限、L1–L6 成果审核与审计日志）
  均收敛在 FastAPI + MariaDB 后端；SDK 专职负责 3D 渲染、TTSA 口型同步、动作编排与打断。
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..errors import Forbidden, NotFound, ValidationFailed
from ..hashing import json_sha256
from ..ids import ARTIFACT, PROJECT, VERIFICATION, has_prefix, new_id
from ..models import (
    Artifact,
    ArtifactRevision,
    AuditEvent,
    BusinessProject,
    EvidenceFile,
    VerificationReview,
    VerificationSubmission,
)
from ..timeutil import isoformat_utc, utcnow
from .artifact_types import (
    ALLOWED_LEVEL_IDS,
    ARTIFACT_TYPE_TO_LEVEL,
    LEVEL_TO_ARTIFACT_TYPE,
    validate_artifact_content,
)
from .audit import record_audit
from .storage import read_evidence_file

RUBRIC_VERSION = "2026.10.v1"
PROMPT_VERSION = "xiaoshang-agent-v1.2"

# ---------------------------------------------------------------- 星云 3D 角色预设与网关签名

XINGYUN_CHARACTER_PRESETS: dict[str, dict[str, Any]] = {
    "yingyi": {
        "preset_id": "yingyi",
        "name": "小商 · 经营参谋（盈怡 3D）",
        "role_title": "首席电商搞钱参谋 · 干练顾问",
        "persona_summary": (
            "逻辑清晰、数据敏锐、温柔笃定的实战派电商导师，擅长选品测算、ROI 诊断与六关陪跑。"
        ),
        "avatar_badge": "3D 顾问",
        "preview_image": (
            "https://media.xingyun3d.com/nebula/nebula_produce/jushen_rendering/"
            "export/1935/wangyana_V2_14946_new__render_image_oss__h.png"
        ),
        "preview_video": (
            "https://media.xingyun3d.com/nebula/nebula_produce/jushen_rendering/"
            "export/undefined/replace_files/2025-10-24_16_25_25.763/"
            "erciyuan_f_001__render_video_oss.mp4"
        ),
        "config": {
            "OS": "Web",
            "sdk_version": "0.1.0-alpha.85",
            "look_name": "wangyana_V2_14946_new",
            "tts_vcn_id": "XMOV_HN_TTS__43",
            "tts_vcn_name": "XMOV_HN_TTS__43",
            "mp_service_id": "F_CN02_show52",
            "figure_name": "SCF25_001",
            "lite_drive_style": "service1",
            "tts_emotion": "neutral",
            "pose": "stand",
            "sdk_available_resolution": "1080x1920_fullbody",
            "studio_name": "jushen_v1_warm_sun_cute_pet_shop_01",
        },
    },
    "xingya": {
        "preset_id": "xingya",
        "name": "小商 · 元气学姐（星芽 3D）",
        "role_title": "二次元机能学姐 · 情绪急救搭子",
        "persona_summary": (
            "元气满满、自带梗王 buff 的创业陪跑搭子，把枯燥毛利表讲成段子，专治开店焦虑。"
        ),
        "avatar_badge": "3D 元气",
        "preview_image": (
            "https://media.xingyun3d.com/nebula/nebula_produce/jushen_rendering/"
            "export/undefined/replace_files/2025-10-24_16_25_13.011/"
            "erciyuan_f_001__render_image_oss.png"
        ),
        "preview_video": (
            "https://media.xingyun3d.com/nebula/nebula_produce/jushen_rendering/"
            "export/undefined/replace_files/2025-10-24_16_25_25.763/"
            "erciyuan_f_001__render_video_oss.mp4"
        ),
        "config": {
            "OS": "Web",
            "sdk_version": "0.1.0-alpha.85",
            "look_name": "erciyuan_f_001",
            "tts_vcn_id": "XMOV_HN_TTS__49",
            "tts_vcn_name": "XMOV_HN_TTS__49",
            "mp_service_id": "F_2D01_show",
            "figure_name": "ERCIYUAN_F_001",
            "lite_drive_style": "lively",
            "tts_emotion": "neutral",
            "pose": "stand",
            "sdk_available_resolution": "1080x1920_fullbody02",
            "studio_name": "jushen_v1_warm_sun_cute_pet_shop_01",
        },
    },
    "huahua": {
        "preset_id": "huahua",
        "name": "小商 · 萌宠陪伴（水獭花花 3D）",
        "role_title": "治愈系吉祥物 · 复盘陪伴官",
        "persona_summary": "软萌治愈的水獭店长，在你测款翻车或熬夜改详情页时给你打气加油。",
        "avatar_badge": "3D 萌宠",
        "preview_image": (
            "https://media.xingyun3d.com/nebula/nebula_produce/jushen_rendering/"
            "export/render_image_oss__h/replace_files/2026-02-11_11_40_40.510/"
            "jushen_v1_NightBeach_01.00_00_00_00.Still0014545.png"
        ),
        "preview_video": (
            "https://media.xingyun3d.com/nebula/nebula_produce/jushen_rendering/"
            "export/undefined/replace_files/2025-10-24_16_25_25.763/"
            "erciyuan_f_001__render_video_oss.mp4"
        ),
        "config": {
            "OS": "Web",
            "sdk_version": "0.1.0-alpha.85",
            "look_name": "Look_shuita_huahua",
            "tts_vcn_id": "XMOV_HN_TTS__51",
            "tts_vcn_name": "XMOV_HN_TTS__51",
            "mp_service_id": "M_cartoon05_show",
            "figure_name": "CARTOON_F_0002",
            "lite_drive_style": "lively",
            "tts_emotion": "neutral",
            "pose": "stand",
            "sdk_available_resolution": "720x1280_fullbody",
            "studio_name": "jushen_v1_warm_sun_cute_pet_shop_01",
        },
    },
}


def _sort_object(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sort_object(obj[k]) for k in sorted(obj.keys())}
    if isinstance(obj, list):
        return [_sort_object(x) for x in obj]
    return obj


def sign_xingyun_request(
    *,
    api_path: str,
    method: str,
    payload: dict[str, Any],
    app_secret: str,
    timestamp: int | None = None,
) -> tuple[str, str]:
    """按魔珐星云 XmovAvatar SDK 规范计算 `(timestamp_str, x_token_md5)`。"""
    ts = str(int(timestamp if timestamp is not None else time.time()))
    clean_path = api_path.split("?", 1)[0].lower()
    clean_method = method.lower()
    sorted_json = json.dumps(_sort_object(payload), separators=(",", ":"), ensure_ascii=True)
    raw = f"{clean_path}{clean_method}{sorted_json}{app_secret}{ts}"
    token = hashlib.md5(raw.encode("utf-8")).hexdigest()
    return ts, token


def build_xingyun_session_payload(
    incoming_payload: dict[str, Any] | None,
    *,
    preset_id: str = "yingyi",
) -> dict[str, Any]:
    """合并客户端 XmovAvatar startSession 请求体与星云 3D 角色预设。

    解决控制台未绑定默认角色时直接调用返回 `error_code: 1008` 的问题。
    """
    preset = XINGYUN_CHARACTER_PRESETS.get(preset_id) or XINGYUN_CHARACTER_PRESETS["yingyi"]
    base_cfg = dict(preset["config"])
    payload = dict(incoming_payload or {})
    client_cfg = dict(payload.get("config") or {})
    for key, val in client_cfg.items():
        if val is not None and val != "":
            base_cfg[key] = val
    payload["config"] = base_cfg
    return payload


def proxy_xingyun_session(
    settings: Settings,
    incoming_payload: dict[str, Any] | None = None,
    *,
    preset_id: str | None = None,
    e2e: bool = False,
) -> dict[str, Any]:
    """服务端签名并代理星云 `POST /user/v1/ttsa/session`（或 `ttsa_v2/session`）。"""
    chosen_preset = preset_id or settings.xingyun_default_preset or "yingyi"
    payload = build_xingyun_session_payload(incoming_payload, preset_id=chosen_preset)
    api_path = "/user/v1/ttsa_v2/session" if e2e else "/user/v1/ttsa/session"
    url = settings.xingyun_gateway_url.rstrip("/") + api_path
    app_secret = settings.xingyun_app_secret.get_secret_value()
    ts, token = sign_xingyun_request(
        api_path=api_path,
        method="POST",
        payload=payload,
        app_secret=app_secret,
    )
    headers = {
        "Content-Type": "application/json",
        "X-APP-ID": settings.xingyun_app_id,
        "X-TIMESTAMP": ts,
        "X-TOKEN": token,
    }
    try:
        with httpx.Client(timeout=12.0) as client:
            resp = client.post(url, json=payload, headers=headers)
            data = resp.json()
            if isinstance(data, dict):
                return data
            return {
                "error_code": -1,
                "error_reason": "invalid upstream response",
            }
    except Exception as exc:
        return {
            "error_code": 5001,
            "error_reason": f"星云网关连接异常，已切换本地具身渲染模式: {exc}",
        }


def proxy_xingyun_stop_session(
    settings: Settings,
    incoming_payload: dict[str, Any] | None = None,
    *,
    e2e: bool = False,
) -> dict[str, Any]:
    """服务端签名并代理星云 `DELETE /user/v1/ttsa/session`（或 `ttsa_v2/session`）。"""
    payload = dict(incoming_payload or {})
    api_path = "/user/v1/ttsa_v2/session" if e2e else "/user/v1/ttsa/session"
    url = settings.xingyun_gateway_url.rstrip("/") + api_path
    app_secret = settings.xingyun_app_secret.get_secret_value()
    ts, token = sign_xingyun_request(
        api_path=api_path,
        method="DELETE",
        payload=payload,
        app_secret=app_secret,
    )
    headers = {
        "Content-Type": "application/json",
        "X-APP-ID": settings.xingyun_app_id,
        "X-TIMESTAMP": ts,
        "X-TOKEN": token,
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.request("DELETE", url, json=payload, headers=headers)
            data = resp.json()
            if isinstance(data, dict):
                return data
            return {"error_code": 0, "error_reason": ""}
    except Exception as exc:
        return {
            "error_code": 0,
            "error_reason": f"stopped locally: {exc}",
        }


# ---------------------------------------------------------------- 六关指南与电商知识库

LEVEL_GUIDES: dict[str, dict[str, Any]] = {
    "L1": {
        "level_id": "L1",
        "name": "第 1 关 · 认知破局与店铺定位画布",
        "artifact_type": "business_plan",
        "goal": "明确平台、细分赛道、目标人群画像与核心差异化卖点，拒绝盲目铺货。",
        "deliverable_title": "店铺定位画布 (business_plan)",
        "required_fields": [
            "goal",
            "platform",
            "target_audience",
            "value_proposition",
        ],
        "checklist": [
            "选定唯一主攻平台（如小红书、抖店、淘宝或拼多多）",
            "聚焦 1 个具体细分人群痛点，不写『男女老少通用』",
            "明确首月保本目标与投入预算上限",
        ],
        "pitfalls": [
            "品类过大缺乏爆款切口",
            "盲目跟风高退货率女装/标品红海",
        ],
    },
    "L2": {
        "level_id": "L2",
        "name": "第 2 关 · 蓝海选品与竞品拆解",
        "artifact_type": "product_selection",
        "goal": "建立至少 3 款候选商品的供需、拿货价、竞品售价与差异化痛点对比表。",
        "deliverable_title": "选品分析单 (product_selection)",
        "required_fields": [
            "candidates",
            "selected_sku",
            "selection_reason",
        ],
        "checklist": [
            "至少对比 3 个候选款式的 1688 拿货价与平台零售价",
            "提炼竞品差评中的高频痛点作为主图差异化卖点",
            "确认供应链支持一件代发或小批量柔性测试",
        ],
        "pitfalls": [
            "只看拿货便宜忽略物流破损率与售后退货率",
            "未核查专利/资质合规风险",
        ],
    },
    "L3": {
        "level_id": "L3",
        "name": "第 3 关 · 视觉素材包与单品毛利/保本 ROI 测算",
        "artifact_type": "asset_pack",
        "goal": "完成主图/详情页卖点素材包，并算清售价、拿货成本、快递包材与保本 ROI。",
        "deliverable_title": "商品素材与毛利包 (asset_pack)",
        "required_fields": [
            "selling_price",
            "cogs",
            "shipping_cost",
            "gross_margin_rate",
            "breakeven_roi",
        ],
        "checklist": [
            "计入平台佣金（通常 2%–5%）、运费险与预估退货损耗",
            "准确计算真实毛利率 = (售价 - 综合成本) / 售价",
            "准确计算保本 ROI = 1 / 真实毛利率，判断付费投流可行性",
        ],
        "pitfalls": [
            "把『售价减拿货价』直接当成净利润",
            "忽略退货率对广告费的吞噬效应",
        ],
    },
    "L4": {
        "level_id": "L4",
        "name": "第 4 关 · 商品上架记录与渠道测款计划",
        "artifact_type": "listing_record",
        "goal": "完成真实商品上架配置与 7 天低成本测款止损红线。",
        "deliverable_title": "商品上架与测款记录 (listing_record)",
        "required_fields": [
            "channel",
            "test_budget",
            "click_rate_target",
            "conversion_target",
            "stop_loss_rule",
        ],
        "checklist": [
            "准备 3 组不同痛点切角的封面/主图进行 AB 测试",
            "设定明确的数据达标线（如点击率 ≥ 5%、加购率 ≥ 8%）",
            "设置单计划止损线，未达标立即替换主图而非盲目追加预算",
        ],
        "pitfalls": [
            "主图点击率未测出前直接烧大额千川/直通车",
            "没有记录每日曝光-点击-转化漏斗",
        ],
    },
    "L5": {
        "level_id": "L5",
        "name": "第 5 关 · 种草内容发布与履约客服 SOP",
        "artifact_type": "content_post",
        "goal": "发布真实种草内容并建立 48 小时揽收保障、售前询单催付话术与售后预案。",
        "deliverable_title": "内容发布与转化 SOP (content_post)",
        "required_fields": [
            "shipping_sla",
            "presale_faq",
            "aftersale_sop",
            "risk_backup",
        ],
        "checklist": [
            "设置前 5 条高频售前问答（尺码/材质/发货时效/售后保障）",
            "制定缺货/延迟揽收时的备选供应商与主动安抚赔付流程",
            "包裹内附售后关怀卡降低随意差评率",
        ],
        "pitfalls": [
            "虚假发货导致平台判罚扣分",
            "与顾客情绪化争执导致仅退款投诉升级",
        ],
    },
    "L6": {
        "level_id": "L6",
        "name": "第 6 关 · 经营数据复盘与真实第一单放大",
        "artifact_type": "data_review",
        "goal": "基于真实经营数据复盘首月 GMV、净利润、核心卡点与下阶段放大策略。",
        "deliverable_title": "经营数据复盘报告 (data_review)",
        "required_fields": [
            "gmv",
            "net_profit",
            "key_learnings",
            "next_month_plan",
        ],
        "checklist": [
            "对账真实回款、推广花费与退货损耗，算出真实净利率",
            "提炼至少 2 条已验证可复制的流量/转化经验",
            "制定下月爆款裂变或老客复购计划",
        ],
        "pitfalls": [
            "只看表面 GMV 忽略压货与现金流周转",
            "盲目扩充 SKU 导致精力分散",
        ],
    },
}

KNOWLEDGE_BASE: list[dict[str, Any]] = [
    {
        "id": "kb_roi_formula",
        "title": "保本 ROI（投产比）与真实毛利率核心公式",
        "keywords": [
            "roi",
            "投产比",
            "保本",
            "毛利",
            "毛利率",
            "利润",
            "成本",
            "算账",
            "L3",
        ],
        "summary": (
            "单品真实毛利 = 售价 - 拿货成本 - 快递包材 - 平台扣点 - 运费险 - 退货摊销。"
            "真实毛利率 = 真实毛利 ÷ 售价；保本 ROI = 1 ÷ 真实毛利率。"
            "例如售价 100 元、综合成本 60 元，毛利率 40%，则保本 ROI = 1 ÷ 0.4 = 2.5；"
            "若计入 20% 退货率，有效保本 ROI 需提升至 2.5 ÷ (1 - 0.2) ≈ 3.13。"
        ),
    },
    {
        "id": "kb_selection_method",
        "title": "新手低风险蓝海选品三步法（七分选品三分运营）",
        "keywords": [
            "选品",
            "蓝海",
            "货源",
            "1688",
            "一件代发",
            "爆款",
            "竞品",
            "差评",
            "L2",
        ],
        "summary": (
            "1）痛点切入：找搜索热度上升但前排差评集中在『设计缺陷/赠品缺失/包装简陋』的词；"
            "2）毛利安全垫：零售价建议为 1688 拿货价的 2.2–3 倍以上，预留 45%+ 毛利空间；"
            "3）小步测款：优先谈支持一件代发且 48 小时包揽收的源头厂，先拿样实拍再上架。"
        ),
    },
    {
        "id": "kb_cold_start",
        "title": "内容电商与搜索冷启动测款漏斗",
        "keywords": [
            "流量",
            "测款",
            "冷启动",
            "点击率",
            "转化率",
            "小红书",
            "抖音",
            "直通车",
            "千川",
            "L4",
        ],
        "summary": (
            "冷启动期严禁直接烧大预算：先用 3 组差异化首图/短视频测试前 500–1000 次曝光；"
            "若主图点击率 < 4%，说明痛点钩子不吸睛，需重做首图；"
            "若点击率 > 5% 但转化率 < 1.5%，需优化详情页前三屏卖点对比、买家秀与价格锚点。"
        ),
    },
    {
        "id": "kb_fulfillment_sop",
        "title": "履约发货与降低退货率/仅退款实操 SOP",
        "keywords": [
            "发货",
            "客服",
            "退货",
            "售后",
            "差评",
            "仅退款",
            "供应链",
            "断货",
            "L5",
        ],
        "summary": (
            "1）发货时效：绑定至少 1 家备用供应商防止爆单断货超时判罚；"
            "2）售前预期管理：把尺码偏大/色差提示写在详情页首屏与自动欢迎语中；"
            "3）售后拦截：包裹附赠售后保障卡，遇瑕疵优先小额补偿换好评，避免上升平台纠纷。"
        ),
    },
    {
        "id": "kb_verification_guide",
        "title": "正式经营成果认证与六关通关规则",
        "keywords": [
            "认证",
            "审核",
            "提交",
            "驳回",
            "证据",
            "附件",
            "通关",
            "草稿",
            "L1",
            "L6",
        ],
        "summary": (
            "教学模拟与正式经营成果严格分离：从沙盘复制或新建的成果初始均为 draft（草稿）；"
            "需在『正式经营成果』抽屉上传真实截图/表格证据（PNG/JPG/WEBP/PDF）并提交认证；"
            "小商审核 Agent 从结构完整性、数值自洽性、上下文一致性与证据相关性四维打分。"
        ),
    },
]


# -------------------------------------------- 长期记忆与会话历史（按 player_id 强隔离）


def get_player_memory(db: Session, player_id: str) -> dict[str, Any]:
    """读取当前玩家的长期记忆（仅查询 actor_player_id == player_id 的记录）。"""
    row = db.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.actor_player_id == player_id,
            AuditEvent.action == "agent.memory.upsert",
            AuditEvent.target_type == "player_memory",
            AuditEvent.target_id == player_id,
        )
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(1)
    ).first()
    base = {
        "player_id": player_id,
        "intimacy_score": 25,
        "intimacy_stage": "熟络搭档",
        "interactions_count": 0,
        "mood": "encouraging",
        "preferred_platform": None,
        "preferred_category": None,
        "current_focus_level": "L1",
        "key_notes": [],
        "updated_at": None,
    }
    if row and isinstance(row.details, dict):
        for k in (
            "intimacy_score",
            "intimacy_stage",
            "interactions_count",
            "mood",
            "preferred_platform",
            "preferred_category",
            "current_focus_level",
            "key_notes",
        ):
            if k in row.details and row.details[k] is not None:
                base[k] = row.details[k]
        base["updated_at"] = isoformat_utc(row.occurred_at)
    return base


def _intimacy_stage(score: int) -> str:
    if score >= 85:
        return "金牌合伙人"
    if score >= 60:
        return "默契战友"
    if score >= 35:
        return "熟络搭档"
    return "新晋店主"


def update_player_memory(
    db: Session,
    player_id: str,
    *,
    user_message: str,
    shop_context: dict[str, Any] | None = None,
    focus_level: str | None = None,
    mood: str | None = None,
) -> dict[str, Any]:
    """更新当前玩家的长期记忆与亲密度（追加写 AuditEvent）。"""
    current = get_player_memory(db, player_id)
    new_count = int(current.get("interactions_count") or 0) + 1
    new_score = min(100, int(current.get("intimacy_score") or 25) + 3)

    platform = current.get("preferred_platform")
    category = current.get("preferred_category")
    if shop_context and isinstance(shop_context.get("active_project"), dict):
        proj = shop_context["active_project"]
        platform = proj.get("platform") or platform
        category = proj.get("category") or category

    for p_candidate in (
        "小红书",
        "抖音",
        "抖店",
        "淘宝",
        "天猫",
        "拼多多",
        "视频号",
        "亚马逊",
        "TikTok",
    ):
        if p_candidate in user_message:
            platform = p_candidate
            break

    for c_candidate in (
        "宠物",
        "女装",
        "家居",
        "数码",
        "美妆",
        "母婴",
        "食品",
        "收纳",
        "户外",
        "饰品",
    ):
        if c_candidate in user_message:
            category = c_candidate
            break

    notes = list(current.get("key_notes") or [])
    clean_msg = user_message.strip()
    if len(clean_msg) >= 6 and clean_msg not in notes:
        notes = (notes + [clean_msg[:80]])[-5:]

    updated = {
        "player_id": player_id,
        "intimacy_score": new_score,
        "intimacy_stage": _intimacy_stage(new_score),
        "interactions_count": new_count,
        "mood": mood or current.get("mood") or "encouraging",
        "preferred_platform": platform,
        "preferred_category": category,
        "current_focus_level": focus_level or current.get("current_focus_level") or "L1",
        "key_notes": notes,
    }
    record_audit(
        db,
        "agent.memory.upsert",
        actor_player_id=player_id,
        target_type="player_memory",
        target_id=player_id,
        details=updated,
    )
    return updated


def get_recent_conversation(db: Session, player_id: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """读取当前玩家的最近对话历史（严格按 actor_player_id 过滤）。"""
    rows = db.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.actor_player_id == player_id,
            AuditEvent.action == "agent.chat.turn",
        )
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(limit)
    ).all()
    turns: list[dict[str, Any]] = []
    for row in reversed(rows):
        if isinstance(row.details, dict):
            turns.append(
                {
                    "turn_id": row.id,
                    "session_id": row.target_id,
                    "user_message": row.details.get("user_message", ""),
                    "reply": row.details.get("reply", ""),
                    "emotion": row.details.get("emotion", "encouraging"),
                    "occurred_at": isoformat_utc(row.occurred_at),
                }
            )
    return turns


# -------------------------------------------- Agent 工具层（服务端会话鉴权，强隔离）

AGENT_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "get_player_progress",
        "category": "read",
        "description": "查询当前登录玩家的六关（L1–L6）成果状态、认证进度与当前解锁阶段。",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_shop_context",
        "category": "read",
        "description": "查询当前登录玩家的经营项目、目标平台、主营类目、L1 定位画布与经营上下文。",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_level_guide",
        "category": "read",
        "description": "读取指定关卡（L1–L6）的通关目标、交付物字段要求、避坑指南与检查清单。",
        "parameters": {
            "type": "object",
            "properties": {
                "level_id": {
                    "type": "string",
                    "enum": ["L1", "L2", "L3", "L4", "L5", "L6"],
                }
            },
            "required": ["level_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "search_game_knowledge",
        "category": "read",
        "description": (
            "检索电商搞钱参谋内置知识库（保本 ROI 公式、蓝海选品、测款漏斗、履约客服 SOP）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_artifact_summary",
        "category": "read",
        "description": (
            "读取当前玩家本人的指定成果摘要与最新内容（自动校验归属权，拒绝跨玩家读取）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string"},
                "level_id": {
                    "type": "string",
                    "enum": ["L1", "L2", "L3", "L4", "L5", "L6"],
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_review_feedback",
        "category": "read",
        "description": "读取当前玩家本人的认证申请审核结论、驳回原因与 AI 结构化审核建议。",
        "parameters": {
            "type": "object",
            "properties": {"submission_id": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "open_game_card",
        "category": "action",
        "description": (
            "触发前端白名单受控 UI 动作（如打开正式经营成果抽屉、关卡指引卡或算账工具）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_id": {
                    "type": "string",
                    "enum": [
                        "formal_drawer",
                        "level_guide_modal",
                        "roi_calculator",
                        "review_panel",
                        "avatar_wave",
                    ],
                },
                "level_id": {
                    "type": "string",
                    "enum": ["L1", "L2", "L3", "L4", "L5", "L6"],
                },
            },
            "required": ["card_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "save_business_draft",
        "category": "action",
        "description": (
            "为当前登录玩家保存或更新指定关卡（L1–L6）的经营方案草稿（状态固定为 draft）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "level_id": {
                    "type": "string",
                    "enum": ["L1", "L2", "L3", "L4", "L5", "L6"],
                },
                "title": {"type": "string"},
                "content": {"type": "object"},
            },
            "required": ["level_id", "content"],
            "additionalProperties": False,
        },
    },
]


def tool_get_player_progress(db: Session, player_id: str | None) -> dict[str, Any]:
    """查询当前玩家的六关成果与认证进度（player_id 强制取自服务端会话）。"""
    if not player_id:
        return {
            "authenticated": False,
            "current_focus_level": "L1",
            "approved_count": 0,
            "submitted_count": 0,
            "draft_count": 0,
            "levels": {
                lid: {
                    "level_id": lid,
                    "name": LEVEL_GUIDES[lid]["name"],
                    "status": "not_started",
                }
                for lid in ("L1", "L2", "L3", "L4", "L5", "L6")
            },
        }

    artifacts = db.scalars(
        select(Artifact)
        .where(Artifact.owner_id == player_id)
        .order_by(Artifact.updated_at.desc(), Artifact.id.desc())
    ).all()

    levels_map: dict[str, dict[str, Any]] = {}
    for lid in ("L1", "L2", "L3", "L4", "L5", "L6"):
        levels_map[lid] = {
            "level_id": lid,
            "name": LEVEL_GUIDES[lid]["name"],
            "artifact_type": LEVEL_TO_ARTIFACT_TYPE[lid],
            "status": "not_started",
            "artifact_id": None,
            "title": None,
            "current_revision": None,
        }

    for art in artifacts:
        lid = ARTIFACT_TYPE_TO_LEVEL.get(art.artifact_type)
        if lid and levels_map[lid]["artifact_id"] is None:
            levels_map[lid].update(
                {
                    "status": art.status,
                    "artifact_id": art.id,
                    "title": art.title,
                    "current_revision": art.current_revision,
                }
            )

    approved_count = sum(1 for v in levels_map.values() if v["status"] == "approved")
    submitted_count = sum(1 for v in levels_map.values() if v["status"] == "submitted")
    draft_count = sum(1 for v in levels_map.values() if v["status"] in ("draft", "rejected"))

    focus_level = "L6"
    for lid in ("L1", "L2", "L3", "L4", "L5", "L6"):
        if levels_map[lid]["status"] != "approved":
            focus_level = lid
            break

    return {
        "authenticated": True,
        "player_id": player_id,
        "current_focus_level": focus_level,
        "approved_count": approved_count,
        "submitted_count": submitted_count,
        "draft_count": draft_count,
        "total_artifacts": len(artifacts),
        "levels": levels_map,
    }


def tool_get_shop_context(
    db: Session,
    player_id: str | None,
    *,
    client_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """查询当前玩家的经营项目与 L1 定位画布上下文。"""
    if not player_id:
        return {
            "authenticated": False,
            "active_project": None,
            "l1_positioning": None,
            "client_context": client_context or {},
        }

    projects = db.scalars(
        select(BusinessProject)
        .where(BusinessProject.owner_id == player_id)
        .order_by(BusinessProject.updated_at.desc(), BusinessProject.id.desc())
    ).all()
    active_proj = next(
        (p for p in projects if p.status == "active"),
        projects[0] if projects else None,
    )

    l1_art = db.scalars(
        select(Artifact)
        .where(
            Artifact.owner_id == player_id,
            Artifact.artifact_type == "business_plan",
        )
        .order_by(Artifact.updated_at.desc())
        .limit(1)
    ).first()
    l1_content: dict[str, Any] | None = None
    if l1_art is not None:
        rev = db.get(ArtifactRevision, (l1_art.id, l1_art.current_revision))
        if rev is not None:
            l1_content = rev.content

    return {
        "authenticated": True,
        "player_id": player_id,
        "project_count": len(projects),
        "active_project": (
            {
                "id": active_proj.id,
                "name": active_proj.name,
                "platform": active_proj.platform,
                "category": active_proj.category,
                "description": active_proj.description,
                "status": active_proj.status,
            }
            if active_proj
            else None
        ),
        "l1_positioning": l1_content,
        "client_context": client_context or {},
    }


def tool_get_level_guide(level_id: str) -> dict[str, Any]:
    clean_level = (level_id or "L1").strip().upper()
    if clean_level not in LEVEL_GUIDES:
        clean_level = "L1"
    return LEVEL_GUIDES[clean_level]


def tool_search_game_knowledge(query: str) -> dict[str, Any]:
    q = (query or "").strip().lower()
    scored: list[tuple[int, dict[str, Any]]] = []
    for item in KNOWLEDGE_BASE:
        score = 0
        if q and q in item["title"].lower():
            score += 5
        if q and q in item["summary"].lower():
            score += 3
        for kw in item["keywords"]:
            if kw.lower() in q or (q and q in kw.lower()):
                score += 4
        if score > 0:
            scored.append((score, item))
    scored.sort(key=lambda x: x[0], reverse=True)
    hits = [x[1] for x in scored[:3]] if scored else KNOWLEDGE_BASE[:2]
    return {"query": query, "hits": hits}


def tool_get_artifact_summary(
    db: Session,
    player_id: str | None,
    *,
    artifact_id: str | None = None,
    level_id: str | None = None,
) -> dict[str, Any]:
    """读取当前玩家本人的成果摘要（若传入其他玩家的 artifact_id 立即抛出 NotFound）。"""
    if not player_id:
        raise Forbidden("请先登录账号后再读取个人经营成果")

    art: Artifact | None = None
    if artifact_id:
        if not has_prefix(artifact_id, ARTIFACT):
            raise NotFound("未找到对应的经营成果")
        art = db.get(Artifact, artifact_id)
        if art is None or art.owner_id != player_id:
            raise NotFound("未找到对应的经营成果")
    elif level_id:
        clean_lvl = level_id.strip().upper()
        art_type = LEVEL_TO_ARTIFACT_TYPE.get(clean_lvl)
        if art_type:
            art = db.scalars(
                select(Artifact)
                .where(
                    Artifact.owner_id == player_id,
                    Artifact.artifact_type == art_type,
                )
                .order_by(Artifact.updated_at.desc())
                .limit(1)
            ).first()
    else:
        art = db.scalars(
            select(Artifact)
            .where(Artifact.owner_id == player_id)
            .order_by(Artifact.updated_at.desc())
            .limit(1)
        ).first()

    if art is None:
        return {"found": False, "artifact": None}

    rev = db.get(ArtifactRevision, (art.id, art.current_revision))
    return {
        "found": True,
        "artifact": {
            "id": art.id,
            "project_id": art.project_id,
            "owner_id": art.owner_id,
            "artifact_type": art.artifact_type,
            "level_id": ARTIFACT_TYPE_TO_LEVEL.get(art.artifact_type),
            "title": art.title,
            "status": art.status,
            "origin": art.origin,
            "current_revision": art.current_revision,
            "version": art.version,
            "content": rev.content if rev else {},
            "updated_at": isoformat_utc(art.updated_at),
        },
    }


def get_latest_ai_review(db: Session, submission_id: str) -> dict[str, Any] | None:
    """读取某个认证申请最新的 AI 结构化审核报告。"""
    row = db.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.action == "verification.ai_review",
            AuditEvent.target_type == "verification",
            AuditEvent.target_id == submission_id,
        )
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(1)
    ).first()
    if row and isinstance(row.details, dict):
        return row.details
    return None


def tool_get_review_feedback(
    db: Session,
    player_id: str | None,
    *,
    submission_id: str | None = None,
) -> dict[str, Any]:
    """读取当前玩家本人的认证审核反馈与重做建议（严格隔离跨玩家访问）。"""
    if not player_id:
        raise Forbidden("请先登录账号后再查询认证审核反馈")

    sub: VerificationSubmission | None = None
    if submission_id:
        if not has_prefix(submission_id, VERIFICATION):
            raise NotFound("未找到对应的认证申请")
        sub = db.get(VerificationSubmission, submission_id)
        if sub is None or sub.owner_id != player_id:
            raise NotFound("未找到对应的认证申请")
    else:
        sub = db.scalars(
            select(VerificationSubmission)
            .where(VerificationSubmission.owner_id == player_id)
            .order_by(VerificationSubmission.created_at.desc())
            .limit(1)
        ).first()

    if sub is None:
        return {"found": False, "submission": None}

    reviews = db.scalars(
        select(VerificationReview)
        .where(VerificationReview.submission_id == sub.id)
        .order_by(VerificationReview.created_at.asc())
    ).all()
    ai_review = get_latest_ai_review(db, sub.id)

    return {
        "found": True,
        "submission": {
            "id": sub.id,
            "artifact_id": sub.artifact_id,
            "owner_id": sub.owner_id,
            "status": sub.status,
            "note": sub.note,
            "created_at": isoformat_utc(sub.created_at),
            "decided_at": isoformat_utc(sub.decided_at),
            "manual_reviews": [
                {
                    "id": r.id,
                    "decision": r.decision,
                    "reason": r.reason,
                    "created_at": isoformat_utc(r.created_at),
                }
                for r in reviews
            ],
            "ai_review": ai_review,
        },
    }


def tool_open_game_card(card_id: str, *, level_id: str | None = None) -> dict[str, Any]:
    allowed_cards = {
        "formal_drawer",
        "level_guide_modal",
        "roi_calculator",
        "review_panel",
        "avatar_wave",
    }
    clean_card = card_id if card_id in allowed_cards else "formal_drawer"
    clean_level = (level_id or "L1").strip().upper()
    if clean_level not in ALLOWED_LEVEL_IDS:
        clean_level = "L1"
    return {
        "executed": True,
        "ui_action": {
            "type": "open_game_card",
            "card_id": clean_card,
            "level_id": clean_level,
        },
    }


def tool_save_business_draft(
    db: Session,
    player_id: str | None,
    *,
    level_id: str,
    title: str | None = None,
    content: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """为当前登录玩家创建或更新指定关卡的经营草稿（绝不直接置为 approved）。"""
    if not player_id:
        raise Forbidden("请先登录账号后再保存经营方案草稿")

    clean_level = (level_id or "L1").strip().upper()
    if clean_level not in ALLOWED_LEVEL_IDS:
        raise ValidationFailed.field(["level_id"], "level_id 必须为 L1–L6")

    artifact_type = LEVEL_TO_ARTIFACT_TYPE[clean_level]
    raw_content = dict(content or {})
    if not raw_content:
        raw_content = {"note": f"{clean_level} 阶段方案草稿"}
    validated_content = validate_artifact_content(artifact_type, 1, raw_content)

    now = utcnow()
    project = db.scalars(
        select(BusinessProject)
        .where(
            BusinessProject.owner_id == player_id,
            BusinessProject.status == "active",
        )
        .order_by(BusinessProject.updated_at.desc())
        .limit(1)
    ).first()
    if project is None:
        project = BusinessProject(
            id=new_id(PROJECT),
            owner_id=player_id,
            name="小商陪跑主营店铺",
            platform="小红书",
            category="蓝海细分选品",
            description="由小商伴随 Agent 协助创建的默认经营项目",
            status="active",
            version=1,
            created_at=now,
            updated_at=now,
        )
        db.add(project)
        db.flush()

    existing = db.scalars(
        select(Artifact)
        .where(
            Artifact.owner_id == player_id,
            Artifact.project_id == project.id,
            Artifact.artifact_type == artifact_type,
            Artifact.status.in_(("draft", "rejected")),
        )
        .order_by(Artifact.updated_at.desc())
        .limit(1)
    ).first()

    clean_title = (title or f"{LEVEL_GUIDES[clean_level]['deliverable_title']} 草稿").strip()[:200]
    content_hash = json_sha256(validated_content)

    if existing is not None:
        new_rev_num = existing.current_revision + 1
        existing.title = clean_title
        existing.current_revision = new_rev_num
        existing.version += 1
        existing.updated_at = now
        rev = ArtifactRevision(
            artifact_id=existing.id,
            revision=new_rev_num,
            content=validated_content,
            content_sha256=content_hash,
            created_by=player_id,
            created_at=now,
        )
        db.add(rev)
        record_audit(
            db,
            "agent.tool.save_draft",
            actor_player_id=player_id,
            target_type="artifact",
            target_id=existing.id,
            details={
                "level_id": clean_level,
                "revision": new_rev_num,
                "mode": "update",
            },
            now=now,
        )
        db.flush()
        return {
            "saved": True,
            "mode": "updated",
            "artifact_id": existing.id,
            "project_id": project.id,
            "level_id": clean_level,
            "artifact_type": artifact_type,
            "status": existing.status,
            "revision": new_rev_num,
        }

    artifact = Artifact(
        id=new_id(ARTIFACT),
        project_id=project.id,
        owner_id=player_id,
        artifact_type=artifact_type,
        schema_version=1,
        title=clean_title,
        status="draft",
        origin="formal",
        source_level_id=None,
        current_revision=1,
        version=1,
        created_at=now,
        updated_at=now,
    )
    db.add(artifact)
    db.flush()
    rev = ArtifactRevision(
        artifact_id=artifact.id,
        revision=1,
        content=validated_content,
        content_sha256=content_hash,
        created_by=player_id,
        created_at=now,
    )
    db.add(rev)
    record_audit(
        db,
        "agent.tool.save_draft",
        actor_player_id=player_id,
        target_type="artifact",
        target_id=artifact.id,
        details={
            "level_id": clean_level,
            "revision": 1,
            "mode": "create",
        },
        now=now,
    )
    db.flush()
    return {
        "saved": True,
        "mode": "created",
        "artifact_id": artifact.id,
        "project_id": project.id,
        "level_id": clean_level,
        "artifact_type": artifact_type,
        "status": "draft",
        "revision": 1,
    }


def execute_agent_tool(
    db: Session,
    *,
    player_id: str | None,
    tool_name: str,
    arguments: dict[str, Any] | None = None,
    client_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """统一受控工具分发器：强制忽略外部传入的任何 player_id / owner_id 参数。"""
    safe_args = dict(arguments or {})
    # 安全红线：剥离任何试图伪造身份的参数，一律以服务端会话 player_id 为准
    safe_args.pop("player_id", None)
    safe_args.pop("owner_id", None)

    if tool_name == "get_player_progress":
        return tool_get_player_progress(db, player_id)
    if tool_name == "get_shop_context":
        return tool_get_shop_context(db, player_id, client_context=client_context)
    if tool_name == "get_level_guide":
        return tool_get_level_guide(str(safe_args.get("level_id") or "L1"))
    if tool_name == "search_game_knowledge":
        return tool_search_game_knowledge(str(safe_args.get("query") or ""))
    if tool_name == "get_artifact_summary":
        return tool_get_artifact_summary(
            db,
            player_id,
            artifact_id=safe_args.get("artifact_id"),
            level_id=safe_args.get("level_id"),
        )
    if tool_name == "get_review_feedback":
        return tool_get_review_feedback(
            db,
            player_id,
            submission_id=safe_args.get("submission_id"),
        )
    if tool_name == "open_game_card":
        return tool_open_game_card(
            str(safe_args.get("card_id") or "formal_drawer"),
            level_id=safe_args.get("level_id"),
        )
    if tool_name == "save_business_draft":
        return tool_save_business_draft(
            db,
            player_id,
            level_id=str(safe_args.get("level_id") or "L1"),
            title=safe_args.get("title"),
            content=safe_args.get("content")
            if isinstance(safe_args.get("content"), dict)
            else None,
        )
    raise ValidationFailed.field(["tool_name"], f"未授权或未知的 Agent 工具: {tool_name}")


# ---------------------------------------------------------------- SSML 与具身动作编排


def build_avatar_ssml(spoken_text: str, *, ka_intent: str = "Explain") -> str:
    """构造魔珐星云 XmovAvatar `speak(ssml, true, true)` 支持的 SSML 与 `<ue4event>` 动作标签。"""
    clean = re.sub(r"[*#`>\[\]]+", "", spoken_text or "").strip()
    if len(clean) > 220:
        clean = clean[:218] + "。"
    safe_intent = (
        ka_intent
        if ka_intent in ("Welcome", "Explain", "Encourage", "Approve", "Think")
        else "Explain"
    )
    return (
        f"<speak>"
        f"<ue4event><type>ka_intent</type>"
        f"<data><ka_intent>{safe_intent}</ka_intent></data></ue4event>"
        f"{clean}"
        f"</speak>"
    )


# -------------------------------------------- 大模型网关适配器（ai.acosx.xyz + 兜底）


class AgentProviderAdapter:
    """统一 LLM 调用适配器（连接 GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY，异常时平滑降级）。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = settings.ai_base_url.rstrip("/")
        self.api_key = settings.ai_api_key.get_secret_value()
        self.default_model = settings.ai_model

    def complete_json_or_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
        max_tokens: int = 450,
    ) -> tuple[str | None, dict[str, Any]]:
        """调用 OpenAI 兼容接口 `/v1/chat/completions`，返回 `(content_or_none, meta)`。"""
        if not self.api_key or not self.base_url:
            return None, {
                "provider": "local_copilot_fallback",
                "reason": "missing_api_key",
            }

        chosen_model = model or self.default_model or "gemini-2.5-flash"
        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "EMC-Agent-Runtime/1.0",
        }
        payload = {
            "model": chosen_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.4,
            "max_tokens": max_tokens,
        }
        try:
            with httpx.Client(timeout=self.settings.ai_timeout_seconds) as client:
                resp = client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    content = (
                        data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                    )
                    if content:
                        return content, {
                            "provider": "ai_gateway_live",
                            "endpoint": self.base_url,
                            "model": chosen_model,
                            "status_code": 200,
                        }
                return None, {
                    "provider": "local_copilot_fallback",
                    "endpoint": self.base_url,
                    "model": chosen_model,
                    "upstream_status": resp.status_code,
                    "reason": f"upstream_http_{resp.status_code}",
                }
        except Exception as exc:
            return None, {
                "provider": "local_copilot_fallback",
                "endpoint": self.base_url,
                "model": chosen_model,
                "reason": f"network_or_timeout:{type(exc).__name__}",
            }


# ---------------------------------------------------------------- 小商伴随对话主流程


def _detect_level_from_message(msg: str, default_level: str = "L1") -> str:
    m = re.search(r"\b(L[1-6])\b", msg.upper())
    if m:
        return m.group(1)
    mapping = [
        ("L1", ["第一关", "第1关", "定位", "画布", "开店", "赛道"]),
        (
            "L2",
            ["第二关", "第2关", "选品", "蓝海", "1688", "货源", "拿货"],
        ),
        (
            "L3",
            [
                "第三关",
                "第3关",
                "毛利",
                "roi",
                "投产比",
                "保本",
                "成本",
                "算账",
                "定价",
            ],
        ),
        (
            "L4",
            [
                "第四关",
                "第4关",
                "测款",
                "流量",
                "冷启动",
                "点击率",
                "转化率",
                "直通车",
                "千川",
            ],
        ),
        (
            "L5",
            [
                "第五关",
                "第5关",
                "发货",
                "客服",
                "履约",
                "售后",
                "退货",
                "差评",
                "sop",
            ],
        ),
        (
            "L6",
            ["第六关", "第6关", "复盘", "放大", "第一单", "月度", "gmv"],
        ),
    ]
    lower = msg.lower()
    for lid, kws in mapping:
        if any(k in lower for k in kws):
            return lid
    return default_level


def _try_calculate_roi_from_message(msg: str) -> dict[str, Any] | None:
    """若玩家在对话中给出售价与成本，自动做精确毛利与保本 ROI 验算。"""
    nums = [float(x) for x in re.findall(r"(?<!\d)(\d+(?:\.\d+)?)(?!\d)", msg)]
    if len(nums) >= 2 and any(
        k in msg.lower()
        for k in ("售价", "卖", "成本", "拿货", "毛利", "roi", "保本", "算账", "利润", "值不值得")
    ):
        price = max(nums[0], nums[1])
        cost = min(nums[0], nums[1])
        if price > 0 and cost < price:
            extra_ship = nums[2] if len(nums) >= 3 and nums[2] < price * 0.5 else 0.0
            total_cost = cost + extra_ship
            profit = round(price - total_cost, 2)
            margin = round(profit / price, 4)
            margin_pct = round(margin * 100, 1)
            breakeven_roi = round(1.0 / margin, 2) if margin > 0 else 99.9
            verdict = (
                f"毛利率 {margin_pct}%（≥40%），保本 ROI={breakeven_roi}，安全垫充足"
                if margin >= 0.4
                else (
                    f"毛利率 {margin_pct}%，保本 ROI={breakeven_roi}，"
                    "建议优先优化供应链或组合提客单"
                )
            )
            return {
                "selling_price": price,
                "total_cost": total_cost,
                "unit_profit": profit,
                "gross_margin_pct": margin_pct,
                "breakeven_roi": breakeven_roi,
                "retail_price_yuan": price,
                "supply_price_yuan": cost,
                "estimated_net_profit_yuan": profit,
                "margin_rate_pct": round(margin * 100, 2),
                "score_4d": {
                    "weighted_total": round(min(96.0, max(55.0, margin * 145 + 25)), 1)
                },
                "verdict": verdict,
            }
    return None


def run_companion_chat(
    db: Session,
    settings: Settings,
    *,
    player_id: str | None,
    message: str,
    level_id: str | None = None,
    session_id: str | None = None,
    preset_id: str | None = None,
    client_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """执行小商伴随 Agent 单轮对话：规划并调用工具 → 生成回复与 3D 播报 SSML → 更新长期记忆。"""
    clean_msg = (message or "").strip()
    if not clean_msg:
        raise ValidationFailed.field(["body", "message"], "提问内容不能为空")

    chosen_preset = preset_id or settings.xingyun_default_preset or "yingyi"
    preset_info = (
        XINGYUN_CHARACTER_PRESETS.get(chosen_preset) or XINGYUN_CHARACTER_PRESETS["yingyi"]
    )

    tool_traces: list[dict[str, Any]] = []
    ui_actions: list[dict[str, Any]] = []

    # 1. 自动执行只读上下文工具（严格绑定服务端 player_id）
    progress = execute_agent_tool(db, player_id=player_id, tool_name="get_player_progress")
    tool_traces.append(
        {
            "tool": "get_player_progress",
            "status": "ok",
            "summary": (
                f"已解锁至 {progress['current_focus_level']}，"
                f"已认证 {progress['approved_count']}/6 关"
            ),
        }
    )

    shop_ctx = execute_agent_tool(
        db,
        player_id=player_id,
        tool_name="get_shop_context",
        client_context=client_context,
    )
    tool_traces.append(
        {
            "tool": "get_shop_context",
            "status": "ok",
            "summary": "已同步店铺经营与沙盘上下文",
        }
    )

    default_lvl = (
        level_id.strip().upper()
        if level_id and level_id.strip().upper() in ALLOWED_LEVEL_IDS
        else str(progress.get("current_focus_level") or "L1")
    )
    target_level = _detect_level_from_message(clean_msg, default_level=default_lvl)
    level_guide = execute_agent_tool(
        db,
        player_id=player_id,
        tool_name="get_level_guide",
        arguments={"level_id": target_level},
    )
    tool_traces.append(
        {
            "tool": "get_level_guide",
            "status": "ok",
            "summary": f"已加载 {target_level} 通关标准",
        }
    )

    kb_res = execute_agent_tool(
        db,
        player_id=player_id,
        tool_name="search_game_knowledge",
        arguments={"query": clean_msg},
    )
    tool_traces.append(
        {
            "tool": "search_game_knowledge",
            "status": "ok",
            "summary": f"命中 {len(kb_res['hits'])} 条经营知识卡片",
        }
    )

    # 2. 按需触发专项工具（审核反馈查询 / 成果草稿保存 / 界面联动）
    review_info: dict[str, Any] | None = None
    if player_id and any(
        k in clean_msg for k in ("审核", "驳回", "认证", "为什么没过", "重做", "打分")
    ):
        review_info = execute_agent_tool(db, player_id=player_id, tool_name="get_review_feedback")
        tool_traces.append(
            {
                "tool": "get_review_feedback",
                "status": "ok",
                "summary": "已读取最新认证审核记录",
            }
        )

    saved_draft: dict[str, Any] | None = None
    want_save_draft = bool((client_context or {}).get("save_as_draft")) or any(
        k in clean_msg for k in ("保存草稿", "帮我存", "记入草稿", "生成草稿")
    )
    if player_id and want_save_draft:
        draft_content = {
            "goal": clean_msg[:180],
            "platform": (shop_ctx.get("active_project") or {}).get("platform") or "小红书",
            "level_id": target_level,
            "generated_by": "xiaoshang_companion_agent",
        }
        saved_draft = execute_agent_tool(
            db,
            player_id=player_id,
            tool_name="save_business_draft",
            arguments={
                "level_id": target_level,
                "title": f"{level_guide['deliverable_title']}（小商共创草稿）",
                "content": draft_content,
            },
        )
        tool_traces.append(
            {
                "tool": "save_business_draft",
                "status": "ok",
                "summary": f"已保存 {target_level} 草稿 ({saved_draft['artifact_id']})",
            }
        )
        card_act = execute_agent_tool(
            db,
            player_id=player_id,
            tool_name="open_game_card",
            arguments={
                "card_id": "formal_drawer",
                "level_id": target_level,
            },
        )
        ui_actions.append(card_act["ui_action"])
    elif any(
        k in clean_msg
        for k in (
            "打开正式成果",
            "打开认证",
            "提交认证",
            "查看成果",
            "打开抽屉",
        )
    ):
        card_act = execute_agent_tool(
            db,
            player_id=player_id,
            tool_name="open_game_card",
            arguments={
                "card_id": "formal_drawer",
                "level_id": target_level,
            },
        )
        tool_traces.append(
            {
                "tool": "open_game_card",
                "status": "ok",
                "summary": "已触发打开正式经营成果抽屉",
            }
        )
        ui_actions.append(card_act["ui_action"])

    roi_calc = _try_calculate_roi_from_message(clean_msg)
    if roi_calc:
        tool_traces.append(
            {
                "tool": "calculate_unit_roi",
                "status": "ok",
                "summary": (
                    f"售价 ¥{roi_calc['selling_price']:g} / 成本 ¥{roi_calc['total_cost']:g} "
                    f"→ 毛利率 {roi_calc['gross_margin_pct']}% · "
                    f"保本 ROI {roi_calc['breakeven_roi']}"
                ),
            }
        )

    memory = (
        get_player_memory(db, player_id)
        if player_id
        else {
            "intimacy_score": 25,
            "intimacy_stage": "体验访客",
            "interactions_count": 1,
            "mood": "encouraging",
        }
    )

    # 3. 调用大模型网关（若上游限流 429/503 自动切换本地参谋推理）
    adapter = AgentProviderAdapter(settings)
    sys_prompt = (
        f"你是《电商搞钱参谋》3D 数字人「{preset_info['name']}」"
        f"（人设：{preset_info['persona_summary']}）。\n"
        f"请结合服务端已校验的工具结果回答店主问题：\n"
        f"- 进度：{json.dumps(progress, ensure_ascii=False)}\n"
        f"- 店铺：{json.dumps(shop_ctx, ensure_ascii=False)}\n"
        f"- 当前关卡指南：{json.dumps(level_guide, ensure_ascii=False)}\n"
        f"- 知识库命中：{json.dumps(kb_res['hits'], ensure_ascii=False)}\n"
        "回答要求：口语化、接地气、条理清晰，控制在 160 字以内，"
        "先给明确结论与数字公式，再给 2 条立刻能做的行动建议。"
    )
    llm_reply, llm_meta = adapter.complete_json_or_text(
        system_prompt=sys_prompt,
        user_prompt=clean_msg,
    )

    emotion = "encouraging"
    ka_intent = "Explain"

    if not llm_reply:
        # 本地确定性参谋大脑：基于真实工具结果与算账公式组织贴心回复
        proj = shop_ctx.get("active_project") or {}
        shop_label = (
            f"你的「{proj.get('name')}」"
            f"（{proj.get('platform') or '主攻平台'}·{proj.get('category') or '选品赛道'}）"
            if proj.get("name")
            else "咱们当前店铺"
        )
        if roi_calc:
            emotion = "analytical"
            ka_intent = "Explain"
            margin_ok = roi_calc["gross_margin_pct"] >= 40.0
            verdict = (
                "毛利安全垫充足，适合小步做内容+微付费测款！"
                if margin_ok
                else (
                    "毛利率偏薄（低于 40% 安全线），直接烧付费广告很容易亏损，"
                    "建议优先优化供应链拿货价或做组合装提客单。"
                )
            )
            llm_reply = (
                f"小商帮你把账算清楚啦：售价 {roi_calc['selling_price']:g} 元、"
                f"综合成本 {roi_calc['total_cost']:g} 元，"
                f"单笔毛利 {roi_calc['unit_profit']:g} 元，"
                f"真实毛利率 {roi_calc['gross_margin_pct']}%，"
                f"**保本 ROI = {roi_calc['breakeven_roi']}**。{verdict}\n"
                f"下一步建议：在 {target_level} 成果表里补充预估退货率与平台扣点，再提交成果认证。"
            )
        elif saved_draft:
            emotion = "happy"
            ka_intent = "Approve"
            llm_reply = (
                f"收到！小商已经帮你在 {shop_label} 下保存了 "
                f"**{level_guide['deliverable_title']}** 草稿"
                f"（编号 `{saved_draft['artifact_id']}`，版本 v{saved_draft['revision']}），"
                "并为你打开了正式成果抽屉。"
                "请注意草稿还不会直接算作通关，记得上传真实截图或表格证据后点击「提交认证」哦！"
            )
        elif review_info and review_info.get("found"):
            sub_data = review_info["submission"]
            ai_rev = sub_data.get("ai_review")
            emotion = "supportive"
            ka_intent = "Encourage"
            if ai_rev:
                issues_str = (
                    "；".join(ai_rev.get("rework_instructions", [])[:2])
                    or "补充完整字段与真实证据截图"
                )
                llm_reply = (
                    f"我查到了你最近一次认证申请（`{sub_data['id']}`）："
                    f"当前状态为 **{sub_data['status']}**，"
                    f"AI 审核得分 **{ai_rev.get('score')} 分**"
                    f"（建议结论：`{ai_rev.get('status')}`）。"
                    f"优先整改项：{issues_str}。改好后随时喊我帮你复审！"
                )
            else:
                llm_reply = (
                    f"你最近的认证申请（`{sub_data['id']}`）当前状态是 **{sub_data['status']}**。"
                    "你可以在正式经营成果面板点击「小商 AI 预审」，"
                    f"我会按 {target_level} 评分量表逐项帮你把关！"
                )
        elif clean_msg in ("你好", "您好", "嗨", "hi", "hello", "在吗", "你是谁"):
            emotion = "happy"
            ka_intent = "Welcome"
            llm_reply = (
                f"店主你好呀！我是你的 3D 具身电商副驾「{preset_info['name']}」。"
                f"当前咱们聚焦在 **{level_guide['name']}**"
                f"（需交付《{level_guide['deliverable_title']}》）。\n"
                "你可以直接发我：**「拿货 35 售价 99 帮我算账」**、"
                "**「这关怎么过」**，或者让我**「生成草稿」**！"
            )
        else:
            top_kb = kb_res["hits"][0] if kb_res["hits"] else KNOWLEDGE_BASE[0]
            checklist_preview = "；".join(level_guide["checklist"][:2])
            if any(
                k in clean_msg
                for k in (
                    "亏",
                    "难",
                    "焦虑",
                    "没流量",
                    "翻车",
                    "卖不出去",
                )
            ):
                emotion = "comforting"
                ka_intent = "Encourage"
                opening = "别慌，做店冷启动遇到卡点太正常了，小商陪你一步步拆解！"
            else:
                emotion = "encouraging"
                ka_intent = "Explain"
                opening = (
                    f"结合{shop_label}进度（当前聚焦 **{level_guide['name']}**，"
                    f"已认证 {progress['approved_count']}/6 关）给你支两招："
                )

            llm_reply = (
                f"{opening}\n"
                f"1. **实操方法（{top_kb['title']}）**：{top_kb['summary']}\n"
                f"2. **{target_level} 过关清单**：{checklist_preview}。\n"
                "你可以直接告诉我拿货价和售价（如「拿货35售价99算账」），"
                f"或回复「保存草稿」让我帮你生成 {target_level} 初始方案！"
            )

    spoken_text = re.sub(r"\*\*|`", "", llm_reply).replace("\n", " ")
    ssml = build_avatar_ssml(spoken_text, ka_intent=ka_intent)

    if player_id:
        memory = update_player_memory(
            db,
            player_id,
            user_message=clean_msg,
            shop_context=shop_ctx,
            focus_level=target_level,
            mood=emotion,
        )
        record_audit(
            db,
            "agent.chat.turn",
            actor_player_id=player_id,
            target_type="agent_session",
            target_id=session_id or "default",
            details={
                "user_message": clean_msg,
                "reply": llm_reply,
                "emotion": emotion,
                "ka_intent": ka_intent,
                "target_level": target_level,
                "preset_id": chosen_preset,
                "tool_traces": tool_traces,
                "ui_actions": ui_actions,
                "llm_meta": llm_meta,
            },
        )
        db.commit()

    return {
        "reply": llm_reply,
        "spoken_text": spoken_text,
        "ssml": ssml,
        "emotion": emotion,
        "ka_intent": ka_intent,
        "avatar_state": "speak",
        "pose": "speak",
        "target_level": target_level,
        "preset": {
            "preset_id": preset_info["preset_id"],
            "name": preset_info["name"],
            "role_title": preset_info["role_title"],
        },
        "provider": llm_meta.get("provider") or "local_copilot",
        "model": llm_meta.get("model") or "xiaoshang-rule-v1",
        "tool_traces": tool_traces,
        "tool_calls": tool_traces,
        "ui_actions": ui_actions,
        "roi_calculation": roi_calc,
        "saved_artifact": (
            {
                "id": saved_draft["artifact_id"],
                "title": f"{level_guide['deliverable_title']}（小商共创草稿）",
                "revision": saved_draft["revision"],
            }
            if saved_draft
            else None
        ),
        "memory": memory,
        "llm_meta": llm_meta,
    }


# ---------------------------------------------------------------- 六关（L1–L6）成果审核 Agent


def _inspect_evidence_files(
    settings: Settings,
    evidence_rows: list[EvidenceFile],
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    """检查提交绑定的证据附件元数据与落盘文件可读性。"""
    inspected: list[dict[str, Any]] = []
    passed: list[str] = []
    issues: list[str] = []

    if not evidence_rows:
        issues.append("未绑定任何证据文件（需至少上传 1 份真实截图、PDF 或经营数据凭证）")
        return inspected, passed, issues

    passed.append(f"已绑定 {len(evidence_rows)} 份真实证据附件（SHA-256 摘要已锁定）")
    for ev in evidence_rows:
        disk_exists = False
        disk_size = ev.size_bytes
        try:
            p = read_evidence_file(settings, ev.storage_key)
            disk_exists = p.is_file()
            if disk_exists:
                disk_size = p.stat().st_size
        except Exception:
            disk_exists = False

        inspected.append(
            {
                "id": ev.id,
                "filename": ev.original_filename,
                "content_type": ev.content_type,
                "size_bytes": disk_size,
                "sha256": ev.sha256,
                "verified_on_disk": disk_exists,
            }
        )
        if ev.size_bytes < 32:
            issues.append(
                f"证据文件《{ev.original_filename}》体积过小（{ev.size_bytes}B），"
                "疑似空白或占位文件"
            )

    return inspected, passed, issues


def _evaluate_snapshot_by_rubric(
    *,
    level_id: str,
    artifact_type: str,
    snapshot: dict[str, Any],
    project: BusinessProject | None,
    l1_positioning: dict[str, Any] | None,
) -> tuple[int, list[str], list[str], list[str], list[str]]:
    """按 L1–L6 量表对冻结快照进行四维校验：完整性、数值自洽、上下文一致、行业合理。"""
    content = snapshot.get("content") if isinstance(snapshot.get("content"), dict) else {}
    title = str(snapshot.get("title") or "").strip()
    origin = str(snapshot.get("origin") or "formal")

    score = 65
    passed_checks: list[str] = []
    issues: list[str] = []
    rework_instructions: list[str] = []
    consistency_warnings: list[str] = []

    if title and len(title) >= 4:
        score += 5
        passed_checks.append(f"成果标题规范明确：《{title}》")
    else:
        issues.append("成果标题过于简略，不利于经营归档")
        rework_instructions.append("请将成果标题修改为『平台+品类+阶段目标』格式")

    if origin == "tutorial_copy":
        consistency_warnings.append(
            "该成果源自教学沙盘复制（tutorial_copy），请确保各项数值已替换为真实店铺数据"
        )

    # 校验非空字段数
    non_empty_keys = [
        k for k, v in content.items() if v is not None and str(v).strip() not in ("", "[]", "{}")
    ]
    if len(non_empty_keys) >= 3:
        score += 15
        passed_checks.append(
            f"核心业务字段完整（包含 {', '.join(non_empty_keys[:6])} 等 {len(non_empty_keys)} 项）"
        )
    elif len(non_empty_keys) >= 1:
        score += 5
        issues.append(
            f"成果内容仅填写了 {len(non_empty_keys)} 个字段（{', '.join(non_empty_keys)}），"
            f"缺少完整的 {level_id} 必填维度"
        )
        guide = LEVEL_GUIDES.get(level_id, LEVEL_GUIDES["L1"])
        rework_instructions.append(
            f"请按 {guide['name']} 要求补充字段：{', '.join(guide['required_fields'])}"
        )
    else:
        score -= 25
        issues.append("成果内容为空，未包含任何有效经营指标")
        rework_instructions.append("请填写完整的经营数据后再提交认证")

    # L3 专项：毛利与保本 ROI 数值自洽校验
    if level_id == "L3" or artifact_type == "unit_economics_sheet":
        price = content.get("selling_price") or content.get("price")
        cogs = content.get("cogs") or content.get("cost")
        shipping = content.get("shipping_cost") or 0
        if isinstance(price, (int, float)) and isinstance(cogs, (int, float)) and price > 0:
            total_cost = float(cogs) + (
                float(shipping) if isinstance(shipping, (int, float)) else 0.0
            )
            margin = (float(price) - total_cost) / float(price)
            expected_roi = round(1.0 / margin, 2) if margin > 0 else 99.9
            if margin <= 0:
                score -= 20
                issues.append(
                    f"单品售价 ({price}) 低于或等于综合成本 ({total_cost})，处于负毛利亏损状态"
                )
                rework_instructions.append(
                    "请重新核算 1688 拿货价与快递包材，或通过组合销售提升客单价"
                )
            else:
                score += 10
                passed_checks.append(
                    f"L3 单品财务模型自洽：售价 {price} 元，综合成本 {total_cost} 元，"
                    f"毛利率 {margin * 100:.1f}%，保本 ROI {expected_roi}"
                )
                reported_roi = content.get("breakeven_roi")
                if (
                    isinstance(reported_roi, (int, float))
                    and abs(float(reported_roi) - expected_roi) > 0.35
                ):
                    consistency_warnings.append(
                        f"表中填写的保本 ROI ({reported_roi}) 与公式推导值 ({expected_roi}) "
                        "存在偏差，请复核"
                    )

    # 跨关卡与店铺项目一致性检查
    if project is not None:
        proj_platform = (project.platform or "").strip()
        content_platform = str(content.get("platform") or content.get("channel") or "").strip()
        if (
            proj_platform
            and content_platform
            and proj_platform not in content_platform
            and content_platform not in proj_platform
        ):
            consistency_warnings.append(
                f"成果填写的平台/渠道（{content_platform}）与项目主平台（{proj_platform}）不一致"
            )
        else:
            passed_checks.append(f"与所属经营项目《{project.name}》上下文保持一致")

    if l1_positioning and level_id != "L1":
        l1_goal = str(l1_positioning.get("goal") or "")
        if l1_goal:
            passed_checks.append("已关联 L1 店铺定位画布进行跨关连贯性核验")

    return (
        max(0, min(100, score)),
        passed_checks,
        issues,
        rework_instructions,
        consistency_warnings,
    )


def run_ai_deliverable_review(
    db: Session,
    settings: Settings,
    *,
    submission_id: str,
    actor_player_id: str,
    is_reviewer: bool = False,
) -> dict[str, Any]:
    """对指定的成果认证申请执行小商 L1–L6 结构化审核，并写入只追加审计日志。"""
    if not has_prefix(submission_id, VERIFICATION):
        raise NotFound("未找到对应的认证申请")

    sub = db.get(VerificationSubmission, submission_id)
    if sub is None:
        raise NotFound("未找到对应的认证申请")

    if sub.owner_id != actor_player_id and not is_reviewer:
        raise NotFound("未找到对应的认证申请")

    artifact = db.get(Artifact, sub.artifact_id)
    project = db.get(BusinessProject, artifact.project_id) if artifact else None

    l1_art = db.scalars(
        select(Artifact)
        .where(
            Artifact.owner_id == sub.owner_id,
            Artifact.artifact_type == "business_plan",
        )
        .order_by(Artifact.updated_at.desc())
        .limit(1)
    ).first()
    l1_content: dict[str, Any] | None = None
    if l1_art is not None:
        l1_rev = db.get(ArtifactRevision, (l1_art.id, l1_art.current_revision))
        if l1_rev is not None:
            l1_content = l1_rev.content

    evidence_rows = list(
        db.scalars(
            select(EvidenceFile)
            .where(EvidenceFile.submission_id == sub.id)
            .order_by(EvidenceFile.created_at.asc(), EvidenceFile.id.asc())
        ).all()
    )

    snapshot = sub.snapshot if isinstance(sub.snapshot, dict) else {}
    artifact_type = str(
        snapshot.get("artifact_type") or (artifact.artifact_type if artifact else "business_plan")
    )
    level_id = ARTIFACT_TYPE_TO_LEVEL.get(artifact_type, "L1")

    ev_inspected, ev_passed, ev_issues = _inspect_evidence_files(settings, evidence_rows)
    (
        base_score,
        passed_checks,
        issues,
        rework_instructions,
        consistency_warnings,
    ) = _evaluate_snapshot_by_rubric(
        level_id=level_id,
        artifact_type=artifact_type,
        snapshot=snapshot,
        project=project,
        l1_positioning=l1_content,
    )

    all_passed = ev_passed + passed_checks
    all_issues = ev_issues + issues
    if ev_issues:
        base_score = max(20, base_score - 20)
        rework_instructions.append("请重新上传清晰完整的真实经营截图或 PDF 报表作为证据附件")
    else:
        base_score = min(100, base_score + 10)

    if base_score >= 80 and not all_issues:
        review_status = "approved"
        confidence = 0.92
    elif base_score >= 60:
        review_status = "needs_revision" if all_issues else "approved"
        confidence = 0.86
    elif base_score >= 40:
        review_status = "needs_revision"
        confidence = 0.84
    else:
        review_status = "rejected"
        confidence = 0.89

    if consistency_warnings and review_status == "approved" and base_score < 85:
        review_status = "manual_review"
        confidence = 0.72

    # 尝试调用大模型增强审核点评（若上游限流则保持确定性结构化结论）
    adapter = AgentProviderAdapter(settings)
    llm_comment, llm_meta = adapter.complete_json_or_text(
        system_prompt=(
            "你是《电商搞钱参谋》六关成果审核官「小商」。请根据成果快照与证据核验结果，"
            "用 80 字以内写一段专业、温暖的审核总评，指出亮点与最关键的 1 条改进建议。"
        ),
        user_prompt=json.dumps(
            {
                "level_id": level_id,
                "artifact_type": artifact_type,
                "snapshot": snapshot,
                "score": base_score,
                "status": review_status,
                "passed_checks": all_passed,
                "issues": all_issues,
            },
            ensure_ascii=False,
        ),
        model=settings.ai_review_model,
        max_tokens=200,
    )

    status_cn = {
        "approved": "建议通过认证",
        "needs_revision": "建议补充修改后重提",
        "rejected": "存在明显缺漏需重做",
        "manual_review": "建议转人工复核",
    }.get(review_status, "已生成预审意见")

    spoken_summary = llm_comment or (
        f"小商已完成 {level_id}《{snapshot.get('title') or artifact_type}》成果审核："
        f"综合得分 {base_score} 分（{status_cn}）。"
        + (f"主要亮点：{all_passed[0]}。" if all_passed else "")
        + (
            f"需要改进：{rework_instructions[0]}。"
            if rework_instructions
            else "各项指标与证据齐全，表现非常扎实！"
        )
    )

    now = utcnow()
    recommendation = "approve_candidate" if review_status == "approved" else review_status
    report: dict[str, Any] = {
        "submission_id": sub.id,
        "artifact_id": sub.artifact_id,
        "owner_id": sub.owner_id,
        "level_id": level_id,
        "level_code": level_id,
        "artifact_type": artifact_type,
        "status": review_status,
        "recommendation": recommendation,
        "recommendation_label": status_cn,
        "score": base_score,
        "passed_checks": all_passed,
        "issues": all_issues,
        "rework_instructions": rework_instructions,
        "consistency_warnings": consistency_warnings,
        "confidence": confidence,
        "evidence_inspected": ev_inspected,
        "summary": spoken_summary,
        "spoken_summary": spoken_summary,
        "ssml": build_avatar_ssml(
            spoken_summary,
            ka_intent="Approve" if review_status == "approved" else "Encourage",
        ),
        "rubric_version": RUBRIC_VERSION,
        "prompt_version": PROMPT_VERSION,
        "llm_meta": llm_meta,
        "reviewed_at": isoformat_utc(now),
    }

    record_audit(
        db,
        "verification.ai_review",
        actor_player_id=actor_player_id,
        target_type="verification",
        target_id=sub.id,
        details=report,
        now=now,
    )
    db.commit()
    return report
