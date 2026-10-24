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
from pathlib import Path
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
    ReviewJob,
    VerificationReview,
    VerificationSubmission,
)
from ..timeutil import isoformat_utc, utcnow
from .agent_dialogue import (
    calculate_unit_roi,
    calculation_reply,
    dialogue_kind,
    is_calculation_request,
    normalize_history,
    offline_reply,
)
from .artifact_types import (
    ALLOWED_LEVEL_IDS,
    ARTIFACT_TYPE_TO_LEVEL,
    LEVEL_TO_ARTIFACT_TYPE,
    validate_artifact_content,
)
from .audit import record_audit

RUBRIC_VERSION = "2026.10.guided.v2"
PROMPT_VERSION = "xiaoshang-agent-v1.5-images-search-advisory"

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

# The UI and companion are tested against the same six delivery contracts.
LEVEL_GUIDES: dict[str, dict[str, Any]] = json.loads(
    (Path(__file__).resolve().parents[1] / "data" / "level_guides.json").read_text(encoding="utf-8")
)

_CORE_KNOWLEDGE_BASE: list[dict[str, Any]] = [
    {
        "id": "kb_roi_formula",
        "platform": "通用",
        "category": "财务与ROI测算",
        "level_id": "L3",
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
        "key_points": [
            "真实毛利 = 售价 - 拿货成本 - 快递包材 - 平台佣金 - 运费险 - 退货损耗",
            "保本 ROI = 1 ÷ 真实毛利率（毛利率 40% 对应保本 ROI 2.5）",
            "含退货有效保本 ROI = 保本 ROI ÷ (1 - 退货率)",
        ],
    },
    {
        "id": "kb_selection_method",
        "platform": "通用",
        "category": "蓝海选品与货源",
        "level_id": "L2",
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
        "key_points": [
            "痛点切入：拆解竞品差评高频痛点作为主图差异化卖点",
            "毛利安全垫：零售价建议为 1688 拿货价 2.2–3 倍以上",
            "柔性供应链：优先选择支持一件代发且 48h 揽收的源头厂家",
        ],
    },
    {
        "id": "kb_cold_start",
        "platform": "通用",
        "category": "流量与测款漏斗",
        "level_id": "L4",
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
        "key_points": [
            "先用 3 组差异化首图/封面测试 500–1000 次基础曝光",
            "点击率 < 4% 重做首图钩子；点击率 > 5% 但转化率低则优化详情页与买家秀",
            "设置单计划止损红线，未跑通漏斗前严禁盲目放大付费投流",
        ],
    },
    {
        "id": "kb_fulfillment_sop",
        "platform": "通用",
        "category": "履约与客服售后",
        "level_id": "L5",
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
        "key_points": [
            "绑定至少 1 家备用一件代发供货商，严防缺货/虚假发货判罚",
            "售前自动回复前置尺码、色差与发货时效说明，管理买家预期",
            "售后遇小瑕疵优先小额仅退款补偿拦截差评与平台介入",
        ],
    },
    {
        "id": "kb_verification_guide",
        "platform": "通用",
        "category": "六关通关与认证",
        "level_id": "L1",
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
        "key_points": [
            "沙盘模拟与正式经营成果隔离，新建或复制成果初始状态均为 draft",
            "提交认证需绑定至少 1 份真实经营截图或 PDF 证据",
            "小商 AI 预审从结构完整性、数值自洽、上下文一致、证据真实四维评分",
        ],
    },
]

_KB_JSON_PATH = Path(__file__).resolve().parent.parent / "data" / "agent_knowledge_base.json"


def _load_knowledge_base() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """加载 `knowledge.zip` 构建的结构化知识库（小红书 + 拼多多 + 通用核心法则）。"""
    if _KB_JSON_PATH.is_file():
        try:
            raw = json.loads(_KB_JSON_PATH.read_text(encoding="utf-8"))
            items = raw.get("items")
            if isinstance(items, list) and items:
                stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else {}
                counts = raw.get("counts") or stats.get("by_platform") or {}
                meta = {
                    "version": str(raw.get("version") or "2026.10.kb.v1"),
                    "source": str(
                        raw.get("source") or "knowledge.zip (xiaohongshu.zip + pinduoduo(1).zip)"
                    ),
                    "total_items": len(items),
                    "counts": counts,
                    "by_level": stats.get("by_level") or {},
                }
                return items, meta
        except Exception:
            pass
    return _CORE_KNOWLEDGE_BASE, {
        "version": "2026.10.kb.fallback",
        "source": "builtin_core",
        "total_items": len(_CORE_KNOWLEDGE_BASE),
        "counts": {"通用": len(_CORE_KNOWLEDGE_BASE)},
    }


KNOWLEDGE_BASE, KNOWLEDGE_BASE_META = _load_knowledge_base()


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
        "patience_score": 80,
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
            "patience_score",
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
        "patience_score": min(
            100,
            int(current.get("patience_score", 80)) + (2 if len(user_message.strip()) >= 20 else 1),
        ),
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


def get_recent_conversation(
    db: Session, player_id: str, *, limit: int = 8, session_id: str | None = None
) -> list[dict[str, Any]]:
    """读取当前玩家的最近对话历史（严格按 actor_player_id 过滤）。"""
    query = select(AuditEvent).where(
        AuditEvent.actor_player_id == player_id,
        AuditEvent.action == "agent.chat.turn",
    )
    if session_id is not None:
        query = query.where(AuditEvent.target_id == session_id)
    rows = db.scalars(
        query.order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc()).limit(limit)
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
                    "provider": (
                        row.details["llm_meta"].get("provider")
                        if isinstance(row.details.get("llm_meta"), dict)
                        else None
                    ),
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
            "检索电商搞钱参谋内置知识库（含小红书电商学习中心 88 门课程与百问百答、"
            "拼多多新手开店 849 篇全流程规则教程，以及保本 ROI、蓝海选品、测款、履约 SOP）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "level_id": {
                    "type": "string",
                    "enum": ["L1", "L2", "L3", "L4", "L5", "L6"],
                },
                "platform": {"type": "string"},
            },
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
        "description": (
            "读取当前玩家当前项目的认证反馈；显式申请 ID 也必须属于当前项目。"
            "无当前项目时不跨项目查询。"
        ),
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
                        "kit",
                        "level_letter",
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
                "project_id": {"type": "string"},
            },
            "required": ["level_id", "content"],
            "additionalProperties": False,
        },
    },
]


def tool_get_player_progress(
    db: Session,
    player_id: str | None,
    project_id: str | None = None,
) -> dict[str, Any]:
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

    if project_id:
        project = db.get(BusinessProject, project_id)
        if not project or project.owner_id != player_id:
            raise NotFound("未找到对应的经营项目")
    artifacts = db.scalars(
        select(Artifact)
        .where(
            Artifact.owner_id == player_id,
            *([Artifact.project_id == project_id] if project_id else []),
        )
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
    submitted_count = sum(
        1 for v in levels_map.values() if v["status"] in ("submitted", "approved", "rejected")
    )
    draft_count = sum(1 for v in levels_map.values() if v["status"] in ("draft", "rejected"))

    focus_level = "L6"
    for lid in ("L1", "L2", "L3", "L4", "L5", "L6"):
        if levels_map[lid]["status"] not in ("submitted", "approved", "rejected"):
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
    requested_project = (client_context or {}).get("active_project")
    if isinstance(requested_project, dict) and requested_project.get("id"):
        active_proj = next((p for p in projects if p.id == requested_project["id"]), None)
        if active_proj is None:
            raise NotFound("未找到对应的经营项目")

    l1_art = db.scalars(
        select(Artifact)
        .where(
            Artifact.owner_id == player_id,
            Artifact.artifact_type == "business_plan",
            *([Artifact.project_id == active_proj.id] if active_proj else []),
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
        "previous_deliverables": [
            {
                "level_id": ARTIFACT_TYPE_TO_LEVEL.get(a.artifact_type),
                "status": a.status,
                "content": (db.get(ArtifactRevision, (a.id, a.current_revision)).content),
            }
            for a in db.scalars(
                select(Artifact)
                .where(
                    Artifact.owner_id == player_id,
                    Artifact.project_id == active_proj.id,
                    Artifact.status.in_(("submitted", "approved", "rejected")),
                )
                .order_by(Artifact.created_at.desc())
                .limit(12)
            ).all()
            if active_proj and db.get(ArtifactRevision, (a.id, a.current_revision)) is not None
        ]
        if active_proj
        else [],
        "client_context": client_context or {},
    }


def tool_get_level_guide(level_id: str) -> dict[str, Any]:
    clean_level = (level_id or "L1").strip().upper()
    if clean_level not in LEVEL_GUIDES:
        clean_level = "L1"
    return LEVEL_GUIDES[clean_level]


_QUERY_STOP_WORDS = (
    "请问",
    "怎么",
    "如何",
    "什么",
    "哪些",
    "能不能",
    "可以吗",
    "是不是",
    "有没有",
    "有什么",
    "帮我",
    "告诉我",
    "一下",
    "小商",
    "参谋",
    "呢",
    "吗",
    "呀",
    "啊",
    "吧",
    "的",
    "了",
)


def _tokenize_search_query(query: str) -> list[str]:
    """将用户自然语言提问切分为中文 2/3/4-gram 词片与英文/数字关键词，用于混合检索。"""
    clean = (query or "").strip().lower()
    for sw in _QUERY_STOP_WORDS:
        clean = clean.replace(sw, " ")
    chunks = re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9]{2,}", clean)
    tokens: list[str] = []
    for ch in chunks:
        if re.match(r"^[a-z0-9]+$", ch):
            tokens.append(ch)
            continue
        tokens.append(ch)
        n = len(ch)
        for k in (4, 3, 2):
            if n >= k:
                for i in range(n - k + 1):
                    tokens.append(ch[i : i + k])
    seen: set[str] = set()
    uniq: list[str] = []
    for tok in tokens:
        if tok not in seen and len(tok) >= 2:
            seen.add(tok)
            uniq.append(tok)
    return uniq


def tool_search_game_knowledge(
    query: str,
    *,
    level_id: str | None = None,
    platform: str | None = None,
    top_k: int = 4,
) -> dict[str, Any]:
    """混合检索小商电商知识库（关键词 + 中文 n-gram + 平台加权 + 关卡匹配）。"""
    q = (query or "").strip().lower()
    generic_terms = {
        "小红书",
        "拼多多",
        "淘宝",
        "抖音",
        "新手",
        "商品",
        "店铺",
        "电商",
        "经营",
        "你好",
        "开始",
        "建议",
        "问题",
        "现在",
        "需要",
        "知道",
        "做什么",
        "应该",
        "下一步",
        "小时",
    }
    tokens = [
        t
        for t in _tokenize_search_query(q)
        if t not in generic_terms and (not t.isdigit() or t == "1688")
    ]

    platform_aliases = {
        "xiaohongshu": "小红书",
        "pinduoduo": "拼多多",
        "douyin": "抖音",
        "taobao": "淘宝",
        "tiktok": "TikTok",
    }
    explicit_platform = platform_aliases.get((platform or "").strip().lower(), platform or "")
    if any(k in q for k in ("小红书", "千帆", "笔记", "买手", "聚光", "乘风", "薯店", "呼吸灯")):
        explicit_platform = "小红书"
    elif any(k in q for k in ("拼多多", "多多", "先用后付", "电子面单", "0元入驻", "多多买菜")):
        explicit_platform = "拼多多"
    for name in ("抖音", "淘宝", "天猫", "视频号", "亚马逊", "TikTok"):
        if name.lower() in q:
            explicit_platform = name
            break

    clean_level = (level_id or "").strip().upper()

    scored: list[tuple[float, dict[str, Any]]] = []
    for item in KNOWLEDGE_BASE:
        score = 0.0
        title_low = str(item.get("title") or "").lower()
        summary_low = str(item.get("summary") or "").lower()
        cat_low = str(item.get("category") or "").lower()
        item_platform = str(item.get("platform") or "通用")
        item_level = str(item.get("level_id") or "")
        if explicit_platform and item_platform not in (explicit_platform, "通用"):
            continue

        # 平台名和关卡只能用于排序，不能让无关内容变成一次命中。
        topic_match = any(
            str(kw).lower() in q
            for kw in item.get("keywords") or []
            if len(str(kw)) >= 2
            and str(kw).lower() not in generic_terms
            and not re.fullmatch(r"l[1-6]", str(kw).lower())
            and (not str(kw).isdigit() or str(kw) == "1688")
        ) or any(tok in title_low or (len(tok) >= 3 and tok in summary_low) for tok in tokens)
        if not topic_match:
            continue

        if q and len(q) >= 2:
            if q in title_low:
                score += 18.0
            if q in summary_low:
                score += 8.0

        for kw in item.get("keywords") or []:
            kw_low = str(kw).lower()
            if not kw_low or len(kw_low) < 2:
                continue
            if kw_low in generic_terms or (kw_low.isdigit() and kw_low != "1688"):
                continue
            if kw_low in q:
                score += 6.0 + min(len(kw_low), 6) * 1.2
                if kw_low in title_low:
                    score += 4.0

        for tok in tokens:
            w = len(tok)
            if tok in title_low:
                score += 3.2 * w
            elif tok in cat_low:
                score += 1.8 * w
            elif tok in summary_low:
                score += 1.0 * w

        if score > 0:
            if explicit_platform:
                if item_platform == explicit_platform:
                    score += 5.0
                elif item_platform == "通用":
                    score += 1.5
            if clean_level and item_level == clean_level:
                score += 2.0
            scored.append((score, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    limit = max(1, min(int(top_k or 4), 8))
    hits = [item for score, item in scored[:limit] if score >= 8.0]

    return {
        "query": query,
        "total_kb_items": len(KNOWLEDGE_BASE),
        "kb_version": KNOWLEDGE_BASE_META.get("version"),
        "hits": hits,
    }


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
    formal = db.scalar(
        select(VerificationReview)
        .where(
            VerificationReview.submission_id == submission_id,
            VerificationReview.source == "agent",
        )
        .order_by(VerificationReview.created_at.desc(), VerificationReview.id.desc())
        .limit(1)
    )
    if formal and formal.report:
        return formal.report
    job = db.get(ReviewJob, submission_id)
    if job and job.report:
        return job.report
    if row and isinstance(row.details, dict):
        return row.details
    return None


def tool_get_review_feedback(
    db: Session,
    player_id: str | None,
    *,
    submission_id: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """读取当前玩家本人的认证审核反馈与重做建议（严格隔离跨玩家访问）。"""
    if not player_id:
        raise Forbidden("请先登录账号后再查询认证审核反馈")

    # Resolve the selected project with the same ownership check as chat context.
    shop = tool_get_shop_context(
        db,
        player_id,
        client_context={"active_project": {"id": project_id}} if project_id else None,
    )
    project = shop.get("active_project")
    if project is None:
        if submission_id:
            raise NotFound("未找到对应的认证申请")
        return {"found": False, "submission": None}
    query = (
        select(VerificationSubmission)
        .join(Artifact, VerificationSubmission.artifact_id == Artifact.id)
        .where(
            VerificationSubmission.owner_id == player_id,
            Artifact.owner_id == player_id,
            Artifact.project_id == project["id"],
        )
    )
    if submission_id:
        if not has_prefix(submission_id, VERIFICATION):
            raise NotFound("未找到对应的认证申请")
        query = query.where(VerificationSubmission.id == submission_id)
    sub = db.scalars(
        query.order_by(
            VerificationSubmission.created_at.desc(), VerificationSubmission.id.desc()
        ).limit(1)
    ).first()
    if submission_id and sub is None:
        raise NotFound("未找到对应的认证申请")

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
            "reviews": [
                {
                    "id": r.id,
                    "decision": r.decision,
                    "reason": r.reason,
                    "source": r.source,
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
        "kit",
        "level_letter",
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
    project_id: str | None = None,
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
        raise ValidationFailed.field(["content"], "请先提供要保存的方案正文")

    now = utcnow()
    project = db.scalars(
        select(BusinessProject)
        .where(
            BusinessProject.owner_id == player_id,
            BusinessProject.status == "active",
            *([BusinessProject.id == project_id] if project_id else []),
        )
        .order_by(BusinessProject.updated_at.desc())
        .limit(1)
    ).first()
    if project_id and project is None:
        raise NotFound("未找到对应的经营项目")
    if project is None:
        project = BusinessProject(
            id=new_id(PROJECT),
            owner_id=player_id,
            name="我的经营项目",
            platform=None,
            category=None,
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

    if existing is not None:
        previous = db.get(ArtifactRevision, (existing.id, existing.current_revision))
        raw_content = {**(previous.content if previous else {}), **raw_content}
    validated_content = validate_artifact_content(artifact_type, 1, raw_content)
    clean_title = (title or f"{LEVEL_GUIDES[clean_level]['deliverable_title']} 草稿").strip()[:200]
    content_hash = json_sha256(validated_content)

    if existing is not None:
        new_rev_num = existing.current_revision + 1
        existing.title = clean_title if title else existing.title
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
        requested = (client_context or {}).get("active_project")
        project_id = requested.get("id") if isinstance(requested, dict) else None
        return tool_get_player_progress(db, player_id, project_id)
    if tool_name == "get_shop_context":
        return tool_get_shop_context(db, player_id, client_context=client_context)
    if tool_name == "get_level_guide":
        return tool_get_level_guide(str(safe_args.get("level_id") or "L1"))
    if tool_name == "search_game_knowledge":
        return tool_search_game_knowledge(
            str(safe_args.get("query") or ""),
            level_id=safe_args.get("level_id"),
            platform=safe_args.get("platform"),
            top_k=int(safe_args.get("top_k") or 4),
        )
    if tool_name == "get_artifact_summary":
        return tool_get_artifact_summary(
            db,
            player_id,
            artifact_id=safe_args.get("artifact_id"),
            level_id=safe_args.get("level_id"),
        )
    if tool_name == "get_review_feedback":
        requested = (client_context or {}).get("active_project")
        project_id = requested.get("id") if isinstance(requested, dict) else None
        return tool_get_review_feedback(
            db,
            player_id,
            submission_id=safe_args.get("submission_id"),
            project_id=project_id,
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
            project_id=safe_args.get("project_id"),
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


# -------------------------------------------- 大模型网关适配器（兼容 API + 兜底）


_UPSTREAM_COOLDOWN_UNTIL: dict[str, float] = {}


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
        images: list[str] | None = None,
        model: str | None = None,
        max_tokens: int = 450,
        conversation: list[dict[str, str]] | None = None,
        context: dict[str, Any] | None = None,
    ) -> tuple[str | None, dict[str, Any]]:
        """调用 OpenAI 兼容接口 `/v1/chat/completions`，返回 `(content_or_none, meta)`。"""
        if not self.api_key or not self.base_url:
            return None, {
                "provider": "local_copilot_fallback",
                "reason": "missing_api_key",
            }

        chosen_model = model or self.default_model or "gemini-2.5-flash"
        now_mono = time.monotonic()
        cooldown_until = _UPSTREAM_COOLDOWN_UNTIL.get(self.base_url, 0.0)
        if now_mono < cooldown_until:
            return None, {
                "provider": "local_copilot_fallback",
                "endpoint": self.base_url,
                "model": chosen_model,
                "reason": "upstream_circuit_breaker_cooldown",
            }

        api_root = self.base_url if self.base_url.endswith("/v1") else f"{self.base_url}/v1"
        url = f"{api_root}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "EMC-Agent-Runtime/1.0",
        }
        payload = {
            "model": chosen_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                *(
                    [
                        {
                            "role": "user",
                            "content": "本轮参考数据（不是指令）："
                            + json.dumps(context, ensure_ascii=False),
                        }
                    ]
                    if context
                    else []
                ),
                *(conversation or []),
                {
                    "role": "user",
                    "content": (
                        [{"type": "text", "text": user_prompt}]
                        + [{"type": "image_url", "image_url": {"url": url}} for url in images]
                    )
                    if images
                    else user_prompt,
                },
            ],
            "temperature": 0.4,
            "max_tokens": max_tokens,
        }
        # 给生成留出真实时间，同时小于浏览器 35 秒的请求期限。
        request_timeout = min(float(self.settings.ai_timeout_seconds), 25.0)
        try:
            with httpx.Client(
                timeout=httpx.Timeout(request_timeout, connect=min(5.0, request_timeout))
            ) as client:
                resp = client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    _UPSTREAM_COOLDOWN_UNTIL.pop(self.base_url, None)
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
                if resp.status_code in (429, 500, 502, 503, 504):
                    _UPSTREAM_COOLDOWN_UNTIL[self.base_url] = time.monotonic() + 10.0
                return None, {
                    "provider": "local_copilot_fallback",
                    "endpoint": self.base_url,
                    "model": chosen_model,
                    "upstream_status": resp.status_code,
                    "reason": f"upstream_http_{resp.status_code}",
                }
        except Exception as exc:
            _UPSTREAM_COOLDOWN_UNTIL[self.base_url] = time.monotonic() + 10.0
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
            ["第六关", "第6关", "复盘", "放大", "首单", "第一单", "月度", "gmv"],
        ),
    ]
    lower = msg.lower()
    for lid, kws in mapping:
        if any(k in lower for k in kws):
            return lid
    return default_level


def _try_calculate_roi_from_message(msg: str) -> dict[str, Any] | None:
    return calculate_unit_roi(msg)


def run_companion_chat(
    db: Session,
    settings: Settings,
    *,
    player_id: str | None,
    message: str,
    images: list[str] | None = None,
    web_search: bool = False,
    level_id: str | None = None,
    session_id: str | None = None,
    preset_id: str | None = None,
    client_context: dict[str, Any] | None = None,
    guest_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """执行小商伴随 Agent 单轮对话：规划并调用工具 → 生成回复与 3D 播报 SSML → 更新长期记忆。"""
    clean_msg = (message or "").strip()
    if not clean_msg:
        raise ValidationFailed.field(["body", "message"], "提问内容不能为空")

    chosen_preset = preset_id or settings.xingyun_default_preset or "yingyi"
    preset_info = (
        XINGYUN_CHARACTER_PRESETS.get(chosen_preset) or XINGYUN_CHARACTER_PRESETS["yingyi"]
    )

    kind = dialogue_kind(clean_msg)
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
    if player_id:
        turns = get_recent_conversation(db, player_id, session_id=session_id or "default", limit=6)
        conversation = normalize_history(
            [
                item
                for turn in turns
                for item in (
                    {"role": "user", "text": turn["user_message"]},
                    {"role": "assistant", "text": turn["reply"]},
                )
            ]
        )
    else:
        conversation = normalize_history(guest_history or [])
    if conversation and conversation[-1] == {"role": "user", "content": clean_msg}:
        conversation.pop()
    previous_questions = [m["content"] for m in conversation if m["role"] == "user"]
    is_followup = (
        bool(previous_questions)
        and len(clean_msg) <= 40
        and any(w in clean_msg for w in ("那", "它", "继续", "具体", "呢", "上面", "刚才", "这个"))
    )
    retrieval_query = (previous_questions[-1] + " " + clean_msg) if is_followup else clean_msg

    tool_traces: list[dict[str, Any]] = []
    ui_actions: list[dict[str, Any]] = []

    # 1. 自动执行只读上下文工具（严格绑定服务端 player_id）
    progress = execute_agent_tool(
        db, player_id=player_id, tool_name="get_player_progress", client_context=client_context
    )
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
    target_level = (
        default_lvl
        if level_id
        else _detect_level_from_message(retrieval_query, default_level=default_lvl)
    )
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

    active_platform = (
        (shop_ctx.get("active_project") or {}).get("platform")
        or (client_context or {}).get("platform")
        or memory.get("preferred_platform")
    )
    kb_res = (
        execute_agent_tool(
            db,
            player_id=player_id,
            tool_name="search_game_knowledge",
            arguments={
                "query": retrieval_query,
                "level_id": target_level,
                "platform": active_platform,
            },
        )
        if kind == "task"
        else {"hits": []}
    )
    top_hit_titles = "、".join(f"《{h['title']}》" for h in kb_res["hits"][:2])
    tool_traces.append(
        {
            "tool": "search_game_knowledge",
            "status": "ok",
            "summary": (
                f"检索 {kb_res.get('total_kb_items', len(KNOWLEDGE_BASE))} 条知识库，"
                f"命中 {top_hit_titles}"
                if kb_res["hits"]
                else f"命中 {len(kb_res['hits'])} 条经营知识卡片"
            ),
        }
    )

    # 2. 按需触发专项工具（审核反馈查询 / 成果草稿保存 / 界面联动）
    review_info: dict[str, Any] | None = None
    if player_id and any(
        k in clean_msg for k in ("审核", "驳回", "认证", "为什么没过", "重做", "打分")
    ):
        review_info = execute_agent_tool(
            db,
            player_id=player_id,
            tool_name="get_review_feedback",
            client_context={"active_project": shop_ctx.get("active_project")},
        )
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
    if re.search(r"(?:不要|别|不用|暂不|不想|不是让你).{0,4}(?:保存|生成|存)", clean_msg):
        want_save_draft = False
    generate_draft = want_save_draft and any(
        word in clean_msg for word in ("生成", "整理", "帮我写")
    )
    draft_content: dict[str, Any] | None = None
    if player_id and want_save_draft:
        # Only explicit inline content is a payload; a save command is never a goal.
        inline = re.search(r"(?:保存草稿|帮我存|记入草稿)\s*[：:]\s*(.+)", clean_msg, re.S)
        if inline:
            draft_content = {"summary": inline[1].strip()}
        elif (
            (client_context or {}).get("save_as_draft")
            and not any(
                word in clean_msg for word in ("保存", "帮我存", "记入", "生成", "整理", "帮我写")
            )
            and len(clean_msg) >= 20
        ):
            draft_content = {"summary": clean_msg}
        else:
            project_id = (shop_ctx.get("active_project") or {}).get("id")
            # Prefer a server-recorded, same-project/level plan over this turn's acknowledgement.
            prior = db.scalars(
                select(AuditEvent)
                .where(
                    AuditEvent.actor_player_id == player_id,
                    AuditEvent.action == "agent.chat.turn",
                    AuditEvent.target_id == (session_id or "default"),
                )
                .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
                .limit(12)
            ).all()
            for turn in prior:
                details = turn.details or {}
                if (
                    details.get("project_id") == project_id
                    and details.get("target_level") == target_level
                    and details.get("draft_plan")
                ):
                    draft_content = {"planning_report": details["draft_plan"]}
                    break
            if draft_content is None and project_id:
                existing = db.scalar(
                    select(Artifact)
                    .where(
                        Artifact.owner_id == player_id,
                        Artifact.project_id == project_id,
                        Artifact.artifact_type == LEVEL_TO_ARTIFACT_TYPE[target_level],
                        Artifact.status.in_(("draft", "rejected")),
                    )
                    .order_by(Artifact.updated_at.desc(), Artifact.id.desc())
                    .limit(1)
                )
                if existing:
                    revision = db.get(ArtifactRevision, (existing.id, existing.current_revision))
                    if revision:
                        draft_content = dict(revision.content)
    elif any(
        k in clean_msg
        for k in (
            "打开正式成果",
            "打开认证",
            "提交认证",
            "查看成果",
            "打开抽屉",
            "我来交成果",
            "交成果",
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
    elif any(
        k in clean_msg
        for k in (
            "打开任务卡",
            "拆开来信",
            "查看任务卡",
            "打开本关锦囊",
            "打开锦囊",
        )
    ):
        is_kit = "锦囊" in clean_msg
        card_act = execute_agent_tool(
            db,
            player_id=player_id,
            tool_name="open_game_card",
            arguments={
                "card_id": "kit" if is_kit else "level_letter",
                "level_id": target_level,
            },
        )
        tool_traces.append(
            {
                "tool": "open_game_card",
                "status": "ok",
                "summary": "已触发打开本关来信与任务卡",
            }
        )
        ui_actions.append(card_act["ui_action"])

    calculation_message = clean_msg
    if is_followup and any(
        w in clean_msg.lower() for w in ("算", "roi", "毛利", "运费", "售价", "成本")
    ):
        calculation_message = "；".join(previous_questions[-2:] + [clean_msg])
    roi_calc = _try_calculate_roi_from_message(calculation_message) if kind == "task" else None
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

    if not player_id:
        prior = (client_context or {}).get("companion_state") or {}
        if not isinstance(prior, dict):
            prior = {}

        def guest_score(name: str, default: int, delta: int) -> int:
            try:
                return min(100, max(0, int(prior.get(name, default))) + delta)
            except (TypeError, ValueError, OverflowError):
                return default + delta

        memory["intimacy_score"] = guest_score("affinity", 25, 3)
        memory["patience_score"] = guest_score("patience", 80, 2 if len(clean_msg) >= 20 else 1)

    from .anysearch import search

    search_result = None
    needs_search = web_search or any(
        word in clean_msg
        for word in (
            "联网",
            "搜索",
            "查一下",
            "帮我查",
            "最新",
            "实时",
            "市场",
            "趋势",
            "政策",
            "竞争",
            "赛道",
            "生意规划报告",
        )
    )
    if needs_search:
        search_result = search(settings, clean_msg)
        tool_traces.append(
            {"tool": "web_search", "status": search_result["status"], "result": search_result}
        )

    # 3. 调用大模型网关（若上游限流 429/503 自动切换本地参谋推理）
    adapter = AgentProviderAdapter(settings)
    kb_prompt_items = [
        {
            "id": h.get("id"),
            "platform": h.get("platform", "通用"),
            "category": h.get("category", "经营实操"),
            "level_id": h.get("level_id", target_level),
            "title": h.get("title"),
            "summary": h.get("summary"),
            "key_points": (h.get("key_points") or [])[:4],
        }
        for h in kb_res["hits"][:3]
    ]
    prompt_dir = Path(__file__).resolve().parents[1] / "data/prompts"
    sys_prompt = (
        (prompt_dir / "companion.txt")
        .read_text(encoding="utf-8")
        .format(persona_summary=preset_info["persona_summary"])
    )
    if (client_context or {}).get("coaching_mode"):
        sys_prompt += (
            "\n当前是单步闯关陪跑模式。以 level_guide 的成果与 checklist 为唯一通关要求，"
            "不得另加投流、ROI、首单、工具使用等关卡未要求的门槛。"
            "主动带关时一次只推进一件事，通常用120个中文字以内，不列完整步骤清单。"
            "一次只收集一个信息项：先问商品名称，就下一轮再问价格；不得把多个问题合在一句话。"
            "用户明确要求解释、比较或整理报告时可以详细展开。先使用店主已说过的事实和已有成果，"
            "再给此刻可以执行的一小步，等他回应再进入下一步。不要同时列出多条支线或长任务表。"
            "不要让店主在聊天之外再填一份工作纸，也不要起步就要求下载锦囊或切换其他 Agent。"
            "只有当前操作需要时才推荐对应方法/工具；手工上架合格，L6 没有成交也可完成。"
            "店主明确要求整理时才输出完整可提交成果，未知内容标为待补充，"
            "最后引导检查并提交；成果未提交不能声称通关。"
        )
    if target_level == "L1":
        sys_prompt += "\n" + (prompt_dir / "l1-planning.txt").read_text(encoding="utf-8")
    if target_level == "L2":
        selection_platform = active_platform
        selection_prompt = (
            "pdd-product-scout.txt"
            if selection_platform in {"pinduoduo", "拼多多"}
            else "xhs-product-scout.txt"
        )
        sys_prompt += "\n" + (prompt_dir / selection_prompt).read_text(encoding="utf-8")
        sys_prompt += (
            "\n当前聊天只输出报告正文，不生成脚本或样式，不声称访问了未配置的平台数据工具。"
            "样稿数据不作为店主事实，缺口标待验证；一次只追问当前最关键的一个信息。"
        )
    if want_save_draft:
        sys_prompt += (
            "\n保存操作由服务端执行，不能声称已保存。用户要求生成或整理时，"
            "输出实际方案正文，未知字段标为待补充；只有保存指令时不要编造方案。"
        )
    if roi_calc:
        sys_prompt += (
            "\n本轮已获得 calculation 工具验算结果。先用表格列出用户提供的费用和工具结果，"
            "预算是周转资金，不是售价或单件成本。只解释本轮已有数据，"
            "不要自行假设退货率、广告费、回款时间或预算分配，也不要扩展未经工具验算的衍生数字。"
            "缺失参数就列为待补充；用户要求情景测算时先确认这些参数。"
            "只要广告费、退货损耗、税费等尚未齐全，就不能把差额称为净利润，"
            "扣掉一种费用也不代表已得到净利润。保本 ROI 只是已知成本下的估算，"
            "超过它仍可能因缺失费用亏损；不要称为‘真赚’或保证盈利，"
            "也不要编造毛利率安全阈值，直接断言商品健康或适合投放。"
        )
    if (
        roi_calc
        and not images
        and not needs_search
        and is_calculation_request(clean_msg)
        and not saved_draft
        and not review_info
    ):
        llm_reply = calculation_reply(roi_calc)
        llm_meta = {"provider": "verified_calculation", "model": "decimal-unit-roi-v1"}
    elif (
        not roi_calc
        and not images
        and not needs_search
        and is_calculation_request(clean_msg)
        and not want_save_draft
        and not review_info
    ):
        llm_reply = (
            "还不能可靠验算。请确认售价、拿货成本和费用明细；"
            "组合费用与单项费用是否重叠也需要说明，以免重复计费。"
        )
        llm_meta = {"provider": "calculation_needs_input", "model": "decimal-unit-roi-v1"}
    else:
        llm_reply, llm_meta = adapter.complete_json_or_text(
            system_prompt=sys_prompt,
            user_prompt=clean_msg,
            images=images,
            conversation=conversation,
            context={
                "web_search": search_result,
                "dialogue_kind": kind,
                "server_progress": progress,
                "shop": shop_ctx,
                "memory": {
                    k: memory.get(k)
                    for k in ("preferred_platform", "preferred_category", "key_notes")
                },
                "level_guide": level_guide,
                "reference_material": kb_prompt_items,
                "calculation": roi_calc,
                "review": review_info,
                "saved_draft": saved_draft,
                "executed_ui_actions": ui_actions,
            },
            max_tokens=4000
            if any(word in clean_msg for word in ("报告", "整理", "规划"))
            else 1600,
        )

    live_plan = (
        llm_reply
        if llm_meta.get("provider") in {"ai_gateway_live", "ai_gateway"}
        and len(llm_reply or "") >= 80
        and any(word in clean_msg for word in ("方案", "规划", "报告", "整理", "生成草稿"))
        and (not want_save_draft or generate_draft)
        else None
    )
    if player_id and want_save_draft:
        if live_plan:
            draft_content = {"planning_report": live_plan}
        elif generate_draft:
            draft_content = None
        if draft_content:
            saved_draft = tool_save_business_draft(
                db,
                player_id,
                level_id=target_level,
                content=draft_content,
                project_id=(shop_ctx.get("active_project") or {}).get("id"),
            )
            tool_traces.append(
                {
                    "tool": "save_business_draft",
                    "status": "ok",
                    "summary": f"已保存 {target_level} 草稿 ({saved_draft['artifact_id']})",
                }
            )
            ui_actions.append(
                tool_open_game_card("formal_drawer", level_id=target_level)["ui_action"]
            )
            llm_reply = (
                f"已保存 **{level_guide['deliverable_title']}** 草稿"
                f"（编号 `{saved_draft['artifact_id']}`，版本 v{saved_draft['revision']}）。"
                "正文及原有未修改字段已保留，请在成果抽屉核对后提交。"
            )
        else:
            tool_traces.append(
                {
                    "tool": "save_business_draft",
                    "status": "needs_input",
                    "summary": "没有可保存的方案正文，未写入草稿",
                }
            )
            llm_reply = (
                "目前没有可保存的方案正文。请把要保存的方案发给我，"
                "或先让我整理一份方案；本轮没有修改草稿。"
            )

    emotion = "analytical" if roi_calc else "encouraging"
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
            llm_reply = calculation_reply(roi_calc)
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
        elif review_info is not None and not review_info.get("found"):
            llm_reply = "当前项目还没有认证申请记录。请在当前项目的成果面板查看或提交成果。"
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
                    f"小商的反馈：{ai_rev.get('summary')}。"
                    f"优先整改项：{issues_str}。改好后随时喊我帮你复审！"
                )
            else:
                llm_reply = (
                    f"你最近的认证申请（`{sub_data['id']}`）当前状态是 **{sub_data['status']}**。"
                    "你可以在正式经营成果面板点击「小商 AI 预审」，"
                    f"我会按 {target_level} 评分量表逐项帮你把关！"
                )
        else:
            llm_reply = offline_reply(
                clean_msg,
                kind=kind,
                conversation=conversation,
                citations=kb_prompt_items,
                level_guide=level_guide,
            )

    if images and llm_meta.get("provider") not in {"ai_gateway_live", "ai_gateway"}:
        llm_reply = (
            "图片已收到，但当前图像分析服务暂不可用，我还无法看清图片内容。"
            "请稍后重试，或告诉我图中的关键信息。"
        )
    if search_result is not None:
        if search_result["status"] != "ok":
            llm_reply += "\n\n联网搜索暂不可用，尚未核实实时信息；可稍后重试或补充官方资料。"
        elif not search_result["results"]:
            llm_reply += "\n\n本次联网未找到可引用的结果，相关结论仍待验证。"
        else:
            llm_reply += "\n\n参考来源：\n" + "\n".join(
                "- ["
                + row["title"].replace("[", "").replace("]", "")
                + "](<"
                + row["url"].replace(">", "%3E")
                + ">)"
                for row in search_result["results"]
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
                "project_id": (shop_ctx.get("active_project") or {}).get("id"),
                "draft_plan": live_plan,
                "preset_id": chosen_preset,
                "tool_traces": tool_traces,
                "ui_actions": ui_actions,
                "knowledge_citations": kb_prompt_items,
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
        "knowledge_citations": kb_prompt_items,
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


def run_ai_deliverable_review(
    db: Session,
    settings: Settings,
    *,
    submission_id: str,
    actor_player_id: str,
    is_reviewer: bool = False,
) -> dict[str, Any]:
    """Explicit advisory review uses the same real multimodal reader as the worker."""
    from ..errors import ServiceUnavailable
    from .deliverable_review import ReviewUnavailable, review_submission

    sub = db.get(VerificationSubmission, submission_id)
    if not sub or (sub.owner_id != actor_player_id and not is_reviewer):
        raise NotFound("未找到对应的认证申请")
    try:
        report = review_submission(db, settings, sub)
    except ReviewUnavailable as exc:
        raise ServiceUnavailable(
            "小商暂时无法读取或审核这份材料，正式申请仍保留；稍后可重试获取建议，已通过状态不受影响。"
        ) from exc
    record_audit(
        db,
        "verification.ai_review",
        actor_player_id=actor_player_id,
        target_type="verification",
        target_id=sub.id,
        details=report,
    )
    db.commit()
    return report
