"""纯 ASGI 中间件：请求 ID / 访问日志 / 未预期异常兜底、HTTP 条件缓存，以及请求体大小限制。"""

from __future__ import annotations

import hashlib
import logging
import re
import time

from fastapi import HTTPException
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import ids
from .errors import PayloadTooLarge, api_error_response, internal_error_response
from .logging_config import request_id_var

logger = logging.getLogger("emc_api.request")

REQUEST_ID_HEADER = "X-Request-ID"
# 接受上游（如 Apache）传入的请求 ID，但仅限安全字符，防止日志注入。
_INCOMING_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")

# 项目归档后的 HTTP 缓存策略：API JSON GET 响应允许浏览器存储，但必须带
# ETag 逐次回源校验（304 复用）。`private` 阻止共享缓存（Edge/WAF）存储
# 会话数据；逐请求重算 ETag 保证跨会话命中 304 时内容必然逐字节一致，
# 因此不会泄露他人数据，也不会读到过期状态。
_CONDITIONAL_CACHE_CONTROL = "private, max-age=0, must-revalidate"
_JSON_CONTENT_TYPE = "application/json"
# 健康检查必须实时反映数据库状态（systemd 定时器经公网全链路探测），
# 不参与任何缓存。
_HEALTH_PATH = "/api/health"


def _if_none_match_hits(header_value: str | None, etag: str) -> bool:
    """RFC 9111 弱比较：`If-None-Match` 命中当前 ETag（或为 `*`）时返回 True。"""
    if not header_value:
        return False
    bare = etag.strip('"')
    for candidate in header_value.split(","):
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if candidate.startswith("W/"):
            candidate = candidate[2:].strip()
        if candidate.strip('"') == bare:
            return True
    return False


class RequestContextMiddleware:
    """为每个请求分配 request_id，写入响应头 `X-Request-ID`，记录结构化访问日志。

    未被异常处理器处理的异常在此记录（含堆栈，仅日志）并返回统一的 500 internal_error。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER)
        request_id = (
            incoming
            if incoming and _INCOMING_REQUEST_ID.match(incoming)
            else ids.new_id(ids.REQUEST)
        )
        token = request_id_var.set(request_id)
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        path: str = scope.get("path", "")
        method = (scope.get("method") or "").upper()
        if_none_match = Headers(scope=scope).get("if-none-match")
        # 条件缓存状态：命中可缓存响应时暂扣 start 消息，收齐响应体计算 ETag
        # 后再决定回 304 还是完整 200。
        buffering = False
        pending_start: Message | None = None
        body_chunks: list[bytes] = []
        started = False
        status_code = 500
        t0 = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            nonlocal started, status_code, buffering, pending_start
            if message["type"] == "http.response.start":
                # 防御：若上一个响应的 start 仍被暂扣（app 异常后兜底 500 等），
                # 先丢弃旧状态，避免把旧 200 start 重放出去形成 ASGI 双 start。
                buffering = False
                pending_start = None
                status_code = message["status"]
                message.setdefault("headers", [])
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
                headers.setdefault("X-Content-Type-Options", "nosniff")
                if path.startswith("/auth/"):
                    # OIDC 流程携带 Set-Cookie 与一次性 state，禁止缓存。
                    headers.setdefault("Cache-Control", "no-store")
                elif path.startswith("/api/"):
                    cacheable_json_get = (
                        status_code == 200
                        and method in ("GET", "HEAD")
                        and path != _HEALTH_PATH
                        and "set-cookie" not in headers
                        and headers.get("content-type", "").startswith(_JSON_CONTENT_TYPE)
                    )
                    if cacheable_json_get:
                        # 可条件缓存的 JSON GET：暂扣 start，待收齐响应体后注入 ETag。
                        buffering = True
                        pending_start = message
                        return
                    # 其余 API 响应（错误、写操作、健康探针、带 Set-Cookie）禁止缓存。
                    headers.setdefault("Cache-Control", "no-store")
                started = True
                await send(message)
                return
            if buffering and message["type"] == "http.response.body":
                body_chunks.append(message.get("body", b""))
                if message.get("more_body", False):
                    return
                buffering = False
                body = b"".join(body_chunks)
                start_message = pending_start
                pending_start = None
                assert start_message is not None  # buffering 仅在 start 后置位
                headers = MutableHeaders(scope=start_message)
                etag = f'"{hashlib.sha256(body).hexdigest()}"'
                headers["ETag"] = etag
                headers["Cache-Control"] = _CONDITIONAL_CACHE_CONTROL
                started = True
                if _if_none_match_hits(if_none_match, etag):
                    status_code = 304
                    if "content-length" in headers:
                        del headers["content-length"]
                    await send({**start_message, "status": 304})
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
                    return
                await send(start_message)
                await send({"type": "http.response.body", "body": body, "more_body": False})
                return
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception(
                "unhandled_exception", extra={"method": scope.get("method"), "path": path}
            )
            if started:
                raise
            await internal_error_response()(scope, receive, send_wrapper)
        finally:
            logger.info(
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": path,  # 不记录查询串
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
                    "player_id": state.get("player_id"),
                },
            )
            request_id_var.reset(token)


class BodyTooLarge(HTTPException):
    """请求体超限。继承 HTTPException，使 FastAPI 读取请求体时原样抛出并映射为 413。"""

    def __init__(self) -> None:
        super().__init__(status_code=413)


class BodySizeLimitMiddleware:
    """限制请求体大小：先看 Content-Length，再在读取时累计（覆盖 chunked 请求）。

    `path_limits` 为特定路径（如证据上传）设置单独上限。
    """

    def __init__(
        self, app: ASGIApp, *, max_body_bytes: int, path_limits: dict[str, int] | None = None
    ) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes
        self.path_limits = dict(path_limits or {})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.path_limits.get(scope.get("path", ""), self.max_body_bytes)
        path = scope.get("path", "")
        if path == "/api/agent/chat" or (
            path.startswith("/api/agent/xingyun/web-sessions/") and path.endswith("/turns")
        ):
            limit = 1024 * 1024  # Three bounded images and ordinary context.
        content_length = Headers(scope=scope).get("content-length")
        if content_length is not None:
            if not content_length.isdigit() or int(content_length) > limit:
                await self._reject(scope, receive, send)
                return

        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise BodyTooLarge()
            return message

        async def send_wrapper(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, send_wrapper)
        except BodyTooLarge:
            if started:
                raise
            await self._reject(scope, receive, send)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        response = api_error_response(PayloadTooLarge())
        response.headers["Connection"] = "close"
        await response(scope, receive, send)
