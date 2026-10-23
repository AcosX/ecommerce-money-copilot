"""小商伴随式数字人 Agent 与六关（L1–L6）成果审核路由（#62）。"""

from __future__ import annotations

import json
import secrets
import time
from collections.abc import Iterator
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..config import Settings
from ..db import get_db
from ..errors import NotFound, ValidationFailed
from ..ids import VERIFICATION, has_prefix
from ..models import VerificationSubmission
from ..security import (
    CurrentPlayer,
    get_app_settings,
    get_current_player,
    require_csrf,
    require_player,
)
from ..services import xingyun_web
from ..services.agent_runtime import (
    AGENT_TOOL_SCHEMAS,
    KNOWLEDGE_BASE_META,
    LEVEL_GUIDES,
    PROMPT_VERSION,
    RUBRIC_VERSION,
    XINGYUN_CHARACTER_PRESETS,
    execute_agent_tool,
    get_latest_ai_review,
    get_player_memory,
    get_recent_conversation,
    proxy_xingyun_session,
    proxy_xingyun_stop_session,
    run_ai_deliverable_review,
    run_companion_chat,
    tool_get_player_progress,
)
from ..services.audit import record_audit
from ..timeutil import utcnow

# 挂载在 include_api_router 下（自动带 /api 前缀与 require_csrf）
router = APIRouter(tags=["agent"])

# 供 XmovAvatar Web SDK 内部 fetch()、游客体验对话与 OpenAI 兼容网关调用的路由
sdk_router = APIRouter(tags=["agent-sdk"])


class GuestChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=2000)


class CompanionChatIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message: str = Field(min_length=1, max_length=2000)
    level_id: str | None = Field(default=None, max_length=16)
    current_level: str | None = Field(default=None, max_length=16)
    current_view: str | None = Field(default=None, max_length=32)
    mood: int | float | None = Field(default=None)
    save_as_draft: bool = Field(default=False)
    preset_id: str | None = Field(default=None, max_length=32)
    session_id: str | None = Field(default=None, max_length=64)
    client_context: dict[str, Any] | None = Field(default=None)
    guest_history: list[GuestChatMessage] = Field(default_factory=list, max_length=12)


class ToolExecuteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_name: str = Field(min_length=1, max_length=64)
    arguments: dict[str, Any] = Field(default_factory=dict)
    client_context: dict[str, Any] | None = Field(default=None)


@router.get("/agent/config")
def get_agent_config(
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """返回小商 3D 数字人 SDK 配置、候选角色预设、工具清单及当前玩家记忆。"""
    presets_public = [
        {
            "preset_id": item["preset_id"],
            "name": item["name"],
            "role_title": item["role_title"],
            "persona_summary": item["persona_summary"],
            "avatar_badge": item["avatar_badge"],
            "preview_image": item["preview_image"],
            "preview_video": item["preview_video"],
        }
        for item in XINGYUN_CHARACTER_PRESETS.values()
    ]
    memory = get_player_memory(db, player.id) if player else None
    progress = tool_get_player_progress(db, player.id if player else None)
    recent_turns = get_recent_conversation(db, player.id, limit=6) if player else []

    return {
        "architecture": {
            "selected_scheme": "xingyun_web_e2e_plus_fastapi_runtime",
            "title": "星云 Web Agent + 小商关卡服务",
            "rubric_version": RUBRIC_VERSION,
            "prompt_version": PROMPT_VERSION,
        },
        "xingyun": {
            "app_id": settings.xingyun_app_id,
            "gateway_server": "/api/agent/xingyun/session",
            "e2e_gateway_server": "/api/agent/xingyun/e2e-session",
            "web_e2e": True,
            "default_preset": settings.xingyun_default_preset,
            "presets": presets_public,
        },
        "authenticated": player is not None,
        "player": (
            {
                "id": player.id,
                "display_name": player.display_name,
                "roles": player.roles,
            }
            if player
            else None
        ),
        "memory": memory,
        "progress": progress,
        "recent_conversation": recent_turns,
        "tools": AGENT_TOOL_SCHEMAS,
        "level_guides": LEVEL_GUIDES,
        "knowledge_base": KNOWLEDGE_BASE_META,
    }


@router.get("/agent/memory")
def read_agent_memory(
    session_id: str | None = Query(default=None, min_length=1, max_length=64),
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """读取当前登录玩家的长期记忆与最近对话历史（按 player_id 强隔离）。"""
    return {
        "memory": get_player_memory(db, player.id),
        "recent_conversation": get_recent_conversation(
            db, player.id, limit=10, session_id=session_id
        ),
        "progress": tool_get_player_progress(db, player.id),
    }


@router.post("/agent/tools/execute")
def execute_tool_endpoint(
    body: ToolExecuteIn,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """执行受控 Agent 工具（强制以服务端会话 player.id 为准，忽略客户端伪造的 player_id）。"""
    result = execute_agent_tool(
        db,
        player_id=player.id,
        tool_name=body.tool_name,
        arguments=body.arguments,
        client_context=body.client_context,
    )
    db.commit()
    return {
        "tool_name": body.tool_name,
        "player_id": player.id,
        "result": result,
    }


@router.post("/agent/reviews/{submission_id}")
def trigger_ai_deliverable_review(
    submission_id: str,
    player: CurrentPlayer = Depends(require_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """触发小商 L1–L6 结构化成果审核（仅申请人本人或审核员可触发）。"""
    return run_ai_deliverable_review(
        db,
        settings,
        submission_id=submission_id,
        actor_player_id=player.id,
        is_reviewer=player.is_reviewer,
    )


@router.get("/agent/reviews/{submission_id}")
def get_ai_deliverable_review(
    submission_id: str,
    player: CurrentPlayer = Depends(require_player),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """查询指定认证申请的最新 AI 审核报告（仅申请人本人或审核员可读）。"""
    if not has_prefix(submission_id, VERIFICATION):
        raise NotFound("未找到对应的认证申请")
    sub = db.get(VerificationSubmission, submission_id)
    if sub is None:
        raise NotFound("未找到对应的认证申请")
    if sub.owner_id != player.id and not player.is_reviewer:
        raise NotFound("未找到对应的认证申请")

    report = get_latest_ai_review(db, submission_id)
    return {
        "submission_id": sub.id,
        "status": sub.status,
        "has_ai_review": report is not None,
        "ai_review": report,
    }


# ---------------------------------------------------------------- SDK 网关代理与伴随对话路由


@sdk_router.post("/agent/xingyun/session")
async def start_xingyun_session(
    request: Request,
    preset: str | None = Query(default=None, max_length=32),
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """代理魔珐星云 `POST /user/v1/ttsa/session`：服务端计算 X-TOKEN 签名并注入 3D 角色配置。"""
    try:
        raw_body = await request.json()
        payload = raw_body if isinstance(raw_body, dict) else {}
    except Exception:
        payload = {}

    chosen_preset = preset or str(payload.pop("preset_id", "") or settings.xingyun_default_preset)
    data = proxy_xingyun_session(settings, payload, preset_id=chosen_preset, e2e=False)

    if player is not None:
        session_id = str((data.get("data") or {}).get("session_id") or "")
        record_audit(
            db,
            "agent.xingyun.session_start",
            actor_player_id=player.id,
            target_type="xingyun_session",
            target_id=session_id or "init",
            details={
                "preset_id": chosen_preset,
                "error_code": data.get("error_code"),
                "sdk_mode": "ttsa_v1",
            },
        )
        db.commit()
    return data


@sdk_router.delete("/agent/xingyun/session")
async def stop_xingyun_session(
    request: Request,
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    """代理魔珐星云 `DELETE /user/v1/ttsa/session`。"""
    try:
        raw_body = await request.json()
        payload = raw_body if isinstance(raw_body, dict) else {}
    except Exception:
        payload = {}
    return proxy_xingyun_stop_session(settings, payload, e2e=False)


@sdk_router.post("/agent/xingyun/web-sessions")
def issue_web_session(
    request: Request,
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if player:
        require_csrf(request, db, settings)
    return xingyun_web.issue(db, settings, player)


@sdk_router.post("/agent/xingyun/web-sessions/{grant_id}/turns")
def prepare_web_turn(
    grant_id: str,
    body: CompanionChatIn,
    request: Request,
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if player:
        require_csrf(request, db, settings)
    return xingyun_web.prepare(db, settings, grant_id, player, body.model_dump())


@sdk_router.get("/agent/xingyun/web-sessions/{grant_id}/turns/{turn_id}")
def read_web_turn(
    grant_id: str,
    turn_id: str,
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return xingyun_web.result(db, settings, grant_id, turn_id, player)


@sdk_router.delete("/agent/xingyun/web-sessions/{grant_id}")
def revoke_web_session(
    grant_id: str,
    request: Request,
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if player:
        require_csrf(request, db, settings)
    grant = xingyun_web.owned(db, settings, grant_id, player, lock=True, active=False)
    grant.expires_at = utcnow()
    db.commit()
    return {"revoked": True}


@sdk_router.post("/agent/xingyun/e2e-session")
async def start_xingyun_e2e_session(
    request: Request,
    grant_id: str = Query(min_length=64, max_length=64),
    preset: str | None = Query(default=None, max_length=32),
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """SDK handshake. Provider credentials and the scoped callback key stay on the server."""
    grant = xingyun_web.owned(db, settings, grant_id, player, lock=True)
    request_id = secrets.token_hex(16)
    try:
        raw_body = await request.json()
    except Exception:
        raw_body = {}
    # The SDK sends its protocol version in config. Ignore all client Brain/provider settings.
    config = raw_body.get("config") if isinstance(raw_body, dict) else {}
    version = (config or {}).get("sdk_version") if isinstance(config, dict) else None
    payload = {
        "config": {
            "sdk_version": str(version or "2.4.1")[:64],
            "framedata_proto_version": 2,
            "walk_version": 3,
            "raw_audio": (config or {}).get("raw_audio") is True,
        },
        "session_speak_req_id": 1,
        "request_id": request_id,
        "brain_config": {
            "provider": "openai",
            "base_url": settings.public_origin.rstrip("/") + "/api/agent/v1",
            "api_key": xingyun_web.bearer(settings, grant_id),
            "model": "xiaoshang-agent-v1",
            "history_length": 0,
        },
        "features": {"auto_send_asr_to_llm": False},
    }
    data = await run_in_threadpool(
        proxy_xingyun_session,
        settings,
        payload,
        preset_id=preset or settings.xingyun_default_preset,
        e2e=True,
    )
    session_id = str((data.get("data") or {}).get("session_id") or "")
    if session_id:
        grant.turn = {
            **(grant.turn or {}),
            "upstream": {"session_id": session_id, "request_id": request_id},
        }
    db.commit()
    return xingyun_web.public_session_response(data)


@sdk_router.delete("/agent/xingyun/e2e-session")
async def stop_xingyun_e2e_session(
    request: Request,
    grant_id: str = Query(min_length=64, max_length=64),
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    grant = xingyun_web.owned(db, settings, grant_id, player, lock=True, active=False)
    try:
        raw_body = await request.json()
        payload = raw_body if isinstance(raw_body, dict) else {}
    except Exception:
        payload = {}
    upstream = (grant.turn or {}).get("upstream") or {}
    # A receipt never authorizes terminating another connection. Late stop is idempotent.
    if not upstream or (
        payload.get("session_id") and payload["session_id"] != upstream.get("session_id")
    ):
        return {"error_code": 0}
    result = await run_in_threadpool(
        proxy_xingyun_stop_session,
        settings,
        {**upstream, "stop_reason": "web_client_disconnect"},
        e2e=True,
    )
    grant.turn = {**(grant.turn or {}), "upstream": None}
    db.commit()
    return result


@sdk_router.post("/agent/chat")
def companion_chat(
    body: CompanionChatIn,
    request: Request,
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """小商伴随对话主入口。

    - 若玩家已登录（有效 `emc_session`），强制校验 CSRF，并开启个人成果/草稿/记忆读写。
    - 若为未登录游客，以只读沙盘陪伴模式运行（不写入个人数据库草稿，随时可体验 3D 数字人互动）。
    """
    if player is not None:
        require_csrf(request, db, settings)

    merged_context = dict(body.client_context or {})
    if body.current_view is not None:
        merged_context.setdefault("current_view", body.current_view)
    if body.mood is not None:
        merged_context.setdefault("mood", body.mood)
    if body.save_as_draft:
        merged_context["save_as_draft"] = True

    return run_companion_chat(
        db,
        settings,
        player_id=player.id if player else None,
        message=body.message,
        level_id=body.level_id or body.current_level,
        preset_id=body.preset_id,
        client_context=merged_context,
        session_id=body.session_id,
        guest_history=[item.model_dump() for item in body.guest_history]
        if player is None
        else None,
    )


@sdk_router.post("/agent/v1/chat/completions")
async def openai_compatible_agent_bridge(
    request: Request,
    player: CurrentPlayer | None = Depends(get_current_player),
    settings: Settings = Depends(get_app_settings),
    db: Session = Depends(get_db),
) -> Any:
    """Native Web Agent callback; requires a server-issued, login-bound capability."""
    try:
        payload = await request.json()
    except Exception as exc:
        raise ValidationFailed("请求体必须为合法 JSON") from exc

    messages = payload.get("messages") if isinstance(payload, dict) else []
    user_msg = "你好，请介绍一下小商参谋"
    if isinstance(messages, list):
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user" and msg.get("content"):
                user_msg = str(msg["content"])[:2080]
                break

    chat_res = await run_in_threadpool(
        xingyun_web.complete, db, settings, request.headers.get("authorization", ""), user_msg
    )
    reply_text = chat_res["spoken_text"]
    completion_id = f"chatcmpl-emc-{int(time.time() * 1000)}"
    created_ts = int(time.time())
    model_name = str(payload.get("model") or "xiaoshang-agent-v1")

    if isinstance(payload, dict) and payload.get("stream") is True:

        def event_stream() -> Iterator[str]:
            chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_ts,
                "model": model_name,
                "choices": [
                    {
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "content": reply_text,
                        },
                        "finish_reason": None,
                    }
                ],
            }
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            done_chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created_ts,
                "model": model_name,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done_chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created_ts,
        "model": model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply_text},
                "finish_reason": "stop",
            }
        ],
        "emc_agent": chat_res,
    }
