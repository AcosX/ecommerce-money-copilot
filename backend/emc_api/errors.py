"""统一错误响应（契约 §6）。

所有错误都以如下格式返回，且不泄露内部细节：

    {"error": {"code": "...", "message": "...", "request_id": "req_…", "details": {}}}

业务代码只需 `raise NotFound()` / `raise VersionConflict(details={...})` 等。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import get_request_id

logger = logging.getLogger("emc_api.errors")


class ApiError(Exception):
    """可预期的业务错误。子类定义 HTTP 状态码、错误码与默认提示语。"""

    status_code: int = 500
    code: str = "internal_error"
    message: str = "服务器内部错误"

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.message = message or type(self).message
        self.details = details or {}
        self.headers = headers
        super().__init__(self.message)


class BadRequest(ApiError):
    status_code, code, message = 400, "bad_request", "请求格式不正确"


class Unauthenticated(ApiError):
    status_code, code, message = 401, "unauthenticated", "请先登录"


class CsrfFailed(ApiError):
    status_code, code, message = 403, "csrf_failed", "请求校验失败，请刷新页面后重试"


class Forbidden(ApiError):
    status_code, code, message = 403, "forbidden", "没有权限执行此操作"


class NotFound(ApiError):
    status_code, code, message = 404, "not_found", "资源不存在"


class MethodNotAllowed(ApiError):
    status_code, code, message = 405, "method_not_allowed", "不支持该请求方法"


class VersionConflict(ApiError):
    status_code, code, message = 409, "version_conflict", "数据已被修改，请刷新后重试"


class InvalidState(ApiError):
    status_code, code, message = 409, "invalid_state", "当前状态不允许此操作"


class PayloadTooLarge(ApiError):
    status_code, code, message = 413, "payload_too_large", "请求内容过大"


class UnsupportedMediaType(ApiError):
    status_code, code, message = 415, "unsupported_media_type", "不支持的文件类型"


class ValidationFailed(ApiError):
    status_code, code, message = 422, "validation_error", "请求参数不合法"

    @classmethod
    def field(cls, loc: list[str | int], msg: str, type_: str = "value_error") -> ValidationFailed:
        """单个字段错误的便捷构造：`raise ValidationFailed.field(["body", "name"], "必填")`。"""
        return cls(details={"errors": [{"loc": loc, "msg": msg, "type": type_}]})


class IdempotencyKeyReuse(ApiError):
    status_code, code, message = 422, "idempotency_key_reuse", "同一幂等键对应了不同的请求内容"


class RateLimited(ApiError):
    status_code, code, message = 429, "rate_limited", "请求过于频繁，请稍后再试"


class InternalError(ApiError):
    status_code, code, message = 500, "internal_error", "服务器内部错误"


# 框架抛出的 HTTPException（路由未匹配、静态文件不存在等）按状态码映射到契约错误码。
_HTTP_STATUS_TO_ERROR: dict[int, type[ApiError]] = {
    400: BadRequest,
    401: Unauthenticated,
    403: Forbidden,
    404: NotFound,
    405: MethodNotAllowed,
    413: PayloadTooLarge,
    415: UnsupportedMediaType,
    422: ValidationFailed,
    429: RateLimited,
}


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": get_request_id(),
            "details": details or {},
        }
    }


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=error_body(code, message, details),
        headers=headers,
    )


def api_error_response(exc: ApiError) -> JSONResponse:
    return error_response(exc.status_code, exc.code, exc.message, exc.details, exc.headers)


def internal_error_response() -> JSONResponse:
    return api_error_response(InternalError())


def _clean_validation_errors(errors: Any) -> list[dict[str, Any]]:
    # 只保留 loc/msg/type；pydantic 的 input/ctx 可能回显用户数据或包含不可序列化对象。
    cleaned = []
    for err in errors:
        cleaned.append(
            {
                "loc": [p if isinstance(p, int | str) else str(p) for p in err.get("loc", ())],
                "msg": str(err.get("msg", "")),
                "type": str(err.get("type", "value_error")),
            }
        )
    return cleaned


async def _handle_api_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    if exc.status_code >= 500:
        logger.error("api_error", extra={"code": exc.code})
    return api_error_response(exc)


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return api_error_response(
        ValidationFailed(details={"errors": _clean_validation_errors(exc.errors())})
    )


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    error_cls = _HTTP_STATUS_TO_ERROR.get(exc.status_code)
    if error_cls is None:
        if exc.status_code >= 500:
            error_cls = InternalError
        else:
            # 其他 4xx：保留状态码，使用通用错误码；不回显框架的 detail 文本。
            return error_response(
                exc.status_code, "bad_request", BadRequest.message, headers=exc.headers
            )
    err = error_cls(headers=exc.headers)
    return api_error_response(err)


def install_exception_handlers(app: FastAPI) -> None:
    """注册错误处理器。未预期异常由 RequestContextMiddleware 兜底为 500。"""
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
