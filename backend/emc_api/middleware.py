"""纯 ASGI 中间件：请求 ID / 访问日志 / 未预期异常兜底，以及请求体大小限制。"""

from __future__ import annotations

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
        started = False
        status_code = 500
        t0 = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            nonlocal started, status_code
            if message["type"] == "http.response.start":
                started = True
                status_code = message["status"]
                message.setdefault("headers", [])
                headers = MutableHeaders(scope=message)
                headers[REQUEST_ID_HEADER] = request_id
                headers.setdefault("X-Content-Type-Options", "nosniff")
                if path.startswith("/api/") or path.startswith("/auth/"):
                    headers.setdefault("Cache-Control", "no-store")
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
