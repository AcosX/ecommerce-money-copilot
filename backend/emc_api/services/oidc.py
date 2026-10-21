"""OIDC 授权码 + PKCE（S256）、签名短期 Cookie 与 RS256 ID Token 校验（契约 §5）。

纯 Python 3.12 标准库实现：
- `sanitize_return_to`：严格同源相对路径校验，防止开放重定向。
- `generate_pkce_pair` / `compute_code_challenge`：RFC 7636 S256。
- `OAuthPendingState` / `create_oauth_cookie` / `verify_oauth_cookie`：
  HMAC-SHA256 签名的短期 `emc_oauth` Cookie（10 分钟、HttpOnly、SameSite=Lax、Path=/auth）。
- `verify_id_token`：RFC 7515 / RFC 8017 §8.2.2 RSASSA-PKCS1-v1_5 (RS256) 签名校验及
  `iss`、`aud`/`azp`、`exp`、`iat`、`nbf`、`nonce`、`sub` 声明校验。
- `exchange_code_for_tokens` / `fetch_jwks` / `OIDCClient`：与 OIDC 提供方的 HTTP 交互及 JWKS 缓存。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

from fastapi import Request, Response

from ..config import Settings

OAUTH_COOKIE: Final = "emc_oauth"
OAUTH_COOKIE_MAX_AGE: Final = 600
OAUTH_COOKIE_PATH: Final = "/auth"
OAUTH_SCOPES: Final = "openid profile email"
HTTP_TIMEOUT_SECONDS: Final = 10.0
JWKS_CACHE_TTL_SECONDS: Final = 300.0
CLOCK_SKEW_SECONDS: Final = 30.0
IAT_SKEW_SECONDS: Final = 60.0
MIN_RSA_MODULUS_BITS: Final = 2048
MAX_JWT_LENGTH: Final = 16384
MAX_COOKIE_LENGTH: Final = 4096

# RFC 8017 §9.2 Notes 1: SHA-256 DigestInfo ASN.1 DER prefix (19 bytes; + 32-byte digest = 51 bytes)
_SHA256_DER_PREFIX: Final = bytes.fromhex("3031300d060960864801650304020105000420")
_B64URL_ALPHABET: Final = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
)
# 当开发/测试环境未显式配置 EMC_SESSION_SECRET 时的进程内随机密钥回退
_PROCESS_FALLBACK_SECRET: Final = secrets.token_bytes(32)

# 内存 JWKS 缓存：issuer -> (expires_at_epoch, jwks_dict)
_JWKS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


class OIDCError(Exception):
    """OIDC 流程可预期异常（用于渲染游戏风格 HTML 错误页，绝不回显内部细节或令牌）。"""

    status_code: int = 400
    user_title: str = "登录校验未通过"
    user_message: str = "登录状态已失效或校验未通过，请重新发起登录。"

    def __init__(
        self,
        message: str = "",
        *,
        reason: str = "oidc_error",
        user_title: str | None = None,
        user_message: str | None = None,
    ) -> None:
        super().__init__(message or reason)
        self.reason = reason
        if user_title is not None:
            self.user_title = user_title
        if user_message is not None:
            self.user_message = user_message


class OIDCConfigError(OIDCError):
    status_code = 503
    user_title = "登录服务暂未就绪"
    user_message = "当前环境尚未完成账号登录配置，您可以先返回游戏小镇体验教学模式。"


class OIDCClientError(OIDCError):
    status_code = 400
    user_title = "登录校验未通过"
    user_message = "登录请求已过期、被取消或校验未通过，请重新发起登录。"


class OIDCUnknownKeyIdError(OIDCClientError):
    """JWKS 中未找到匹配的 kid，触发单次强刷后若仍失败则按 400 处理。"""


class OIDCUpstreamError(OIDCError):
    status_code = 502
    user_title = "账号服务连接繁忙"
    user_message = "暂时无法连接账号认证服务，请稍后重试或先返回游戏小镇继续教学。"


@dataclass(frozen=True)
class OAuthPendingState:
    state: str
    nonce: str
    verifier: str
    return_to: str
    exp: int


@dataclass(frozen=True)
class VerifiedIdToken:
    sub: str
    display_name: str
    email: str | None
    claims: dict[str, Any]


def sanitize_return_to(value: str | None) -> str:
    """校验并返回安全的同源相对路径（契约 §5）。

    仅允许长度 1..2000、以 `/` 开头且不以 `//` 开头、不含 `\\` 与控制字符、
    且 `urlsplit` 后无 `scheme` 和 `netloc` 的相对路径；其余一律回退为 `"/"`。
    """
    if not isinstance(value, str):
        return "/"
    if not (1 <= len(value) <= 2000):
        return "/"
    if not value.startswith("/") or value.startswith("//"):
        return "/"
    if "\\" in value:
        return "/"
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in value):
        return "/"
    try:
        parts = urllib.parse.urlsplit(value)
    except ValueError:
        return "/"
    if parts.scheme or parts.netloc:
        return "/"
    return value


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(data: str) -> bytes:
    if not isinstance(data, str) or not data or len(data) % 4 == 1:
        raise OIDCClientError("invalid base64url length", reason="invalid_base64url")
    if any(ch not in _B64URL_ALPHABET for ch in data):
        raise OIDCClientError("invalid base64url characters", reason="invalid_base64url")
    padding = "=" * ((4 - len(data) % 4) % 4)
    try:
        return base64.urlsafe_b64decode((data + padding).encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise OIDCClientError("base64url decode failed", reason="invalid_base64url") from exc


def compute_code_challenge(code_verifier: str) -> str:
    """RFC 7636 S256：`BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`。"""
    if not isinstance(code_verifier, str) or not (43 <= len(code_verifier) <= 128):
        raise ValueError("code_verifier length must be between 43 and 128")
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return b64url_encode(digest)


def generate_pkce_pair() -> tuple[str, str]:
    """生成 `(code_verifier, code_challenge)`（verifier 为 64 字符 URL-safe 随机串）。"""
    verifier = secrets.token_urlsafe(48)
    return verifier, compute_code_challenge(verifier)


def redirect_uri_for(settings: Settings) -> str:
    custom = settings.oidc_redirect_uri.strip()
    if custom:
        return custom
    return f"{settings.public_origin}/auth/callback"


def build_authorize_url(
    settings: Settings,
    *,
    state: str,
    nonce: str,
    code_challenge: str,
) -> str:
    issuer = settings.oidc_issuer.strip().rstrip("/")
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": settings.oidc_client_id.strip(),
            "redirect_uri": redirect_uri_for(settings),
            "scope": OAUTH_SCOPES,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{issuer}/authorize?{query}"


def _cookie_signing_key(settings: Settings) -> bytes:
    raw = settings.session_secret.get_secret_value()
    secret_bytes = raw.encode("utf-8") if raw else _PROCESS_FALLBACK_SECRET
    return hashlib.sha256(b"emc_oauth_cookie_v1:" + secret_bytes).digest()


def create_oauth_cookie(
    settings: Settings,
    *,
    state: str,
    nonce: str,
    verifier: str,
    return_to: str,
    now_ts: float | None = None,
) -> tuple[str, OAuthPendingState]:
    now = int(time.time() if now_ts is None else now_ts)
    pending = OAuthPendingState(
        state=state,
        nonce=nonce,
        verifier=verifier,
        return_to=sanitize_return_to(return_to),
        exp=now + OAUTH_COOKIE_MAX_AGE,
    )
    payload_bytes = json.dumps(
        {
            "state": pending.state,
            "nonce": pending.nonce,
            "verifier": pending.verifier,
            "return_to": pending.return_to,
            "exp": pending.exp,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    payload_b64 = b64url_encode(payload_bytes)
    sig = hmac.new(
        _cookie_signing_key(settings),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    cookie_value = f"{payload_b64}.{b64url_encode(sig)}"
    return cookie_value, pending


def _decode_signed_cookie_payload(cookie_value: str | None, settings: Settings) -> dict[str, Any]:
    if (
        not isinstance(cookie_value, str)
        or not cookie_value
        or len(cookie_value) > MAX_COOKIE_LENGTH
        or cookie_value.count(".") != 1
    ):
        raise OIDCClientError("missing or malformed oauth cookie", reason="oauth_cookie_missing")
    payload_b64, sig_b64 = cookie_value.split(".", 1)
    actual_sig = b64url_decode(sig_b64)
    expected_sig = hmac.new(
        _cookie_signing_key(settings),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(actual_sig, expected_sig):
        raise OIDCClientError("oauth cookie signature mismatch", reason="oauth_cookie_bad_sig")
    raw_payload = b64url_decode(payload_b64)
    try:
        data = json.loads(raw_payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OIDCClientError("oauth cookie invalid json", reason="oauth_cookie_bad_json") from exc
    if not isinstance(data, dict):
        raise OIDCClientError("oauth cookie payload not an object", reason="oauth_cookie_bad_json")
    return data


def peek_cookie_return_to(cookie_value: str | None, settings: Settings) -> str:
    """从签名有效的 `emc_oauth` Cookie 中提取 `return_to`（用于错误页重试按钮）；失败回退 `/`。"""
    try:
        data = _decode_signed_cookie_payload(cookie_value, settings)
    except OIDCError:
        return "/"
    return sanitize_return_to(data.get("return_to"))


def verify_oauth_cookie(
    cookie_value: str | None,
    *,
    expected_state: str | None,
    settings: Settings,
    now_ts: float | None = None,
) -> OAuthPendingState:
    data = _decode_signed_cookie_payload(cookie_value, settings)
    state = data.get("state")
    nonce = data.get("nonce")
    verifier = data.get("verifier")
    return_to = data.get("return_to")
    exp = data.get("exp")

    if (
        not isinstance(state, str)
        or not state
        or not isinstance(nonce, str)
        or not nonce
        or not isinstance(verifier, str)
        or not verifier
        or not isinstance(return_to, str)
        or not isinstance(exp, int)
        or isinstance(exp, bool)
    ):
        raise OIDCClientError("oauth cookie missing fields", reason="oauth_cookie_invalid_fields")

    now = time.time() if now_ts is None else now_ts
    if exp < now:
        raise OIDCClientError("oauth cookie expired", reason="oauth_cookie_expired")

    if (
        not isinstance(expected_state, str)
        or not expected_state
        or not hmac.compare_digest(state.encode("utf-8"), expected_state.encode("utf-8"))
    ):
        raise OIDCClientError("oauth state mismatch", reason="oauth_state_mismatch")

    return OAuthPendingState(
        state=state,
        nonce=nonce,
        verifier=verifier,
        return_to=sanitize_return_to(return_to),
        exp=exp,
    )


def set_oauth_cookie(response: Response, cookie_value: str, settings: Settings) -> None:
    response.set_cookie(
        OAUTH_COOKIE,
        cookie_value,
        max_age=OAUTH_COOKIE_MAX_AGE,
        path=OAUTH_COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_oauth_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        OAUTH_COOKIE,
        path=OAUTH_COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _select_jwk(jwks: dict[str, Any], kid: str | None) -> dict[str, Any]:
    if not isinstance(jwks, dict) or not isinstance(jwks.get("keys"), list):
        raise OIDCClientError("invalid jwks structure", reason="invalid_jwks")
    keys = [k for k in jwks["keys"] if isinstance(k, dict)]

    if kid is not None:
        if not isinstance(kid, str) or not kid:
            raise OIDCClientError("invalid jwt kid header", reason="invalid_kid")
        matched = [k for k in keys if k.get("kid") == kid]
        if not matched:
            raise OIDCUnknownKeyIdError("kid not found in jwks", reason="unknown_kid")
        key = matched[0]
        if (
            key.get("kty") != "RSA"
            or key.get("use") not in (None, "sig")
            or key.get("alg") not in (None, "RS256")
        ):
            raise OIDCClientError("jwk not eligible for RS256", reason="ineligible_jwk")
        return key

    eligible = [
        k
        for k in keys
        if k.get("kty") == "RSA"
        and k.get("use") in (None, "sig")
        and k.get("alg") in (None, "RS256")
    ]
    if len(eligible) != 1:
        raise OIDCClientError("ambiguous or missing RSA jwk", reason="ambiguous_jwk")
    return eligible[0]


def _verify_rs256_signature(signing_input: bytes, sig: bytes, jwk: dict[str, Any]) -> None:
    n_b64 = jwk.get("n")
    e_b64 = jwk.get("e")
    if not isinstance(n_b64, str) or not isinstance(e_b64, str):
        raise OIDCClientError("jwk missing modulus or exponent", reason="invalid_jwk_params")

    n = int.from_bytes(b64url_decode(n_b64), "big")
    e = int.from_bytes(b64url_decode(e_b64), "big")
    if n <= 0 or e < 3 or e % 2 == 0 or e >= n:
        raise OIDCClientError("invalid RSA public key parameters", reason="invalid_jwk_params")
    if n.bit_length() < MIN_RSA_MODULUS_BITS:
        raise OIDCClientError("RSA modulus shorter than 2048 bits", reason="weak_rsa_key")

    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        raise OIDCClientError("signature length does not match modulus", reason="bad_sig_len")

    s = int.from_bytes(sig, "big")
    if s < 0 or s >= n:
        raise OIDCClientError("signature representative out of range", reason="bad_sig_range")

    em = pow(s, e, n).to_bytes(k, "big")
    digest_info = _SHA256_DER_PREFIX + hashlib.sha256(signing_input).digest()
    ps_len = k - len(digest_info) - 3
    if ps_len < 8:
        raise OIDCClientError("insufficient RSA modulus length", reason="weak_rsa_key")
    expected_em = b"\x00\x01" + (b"\xff" * ps_len) + b"\x00" + digest_info
    if not hmac.compare_digest(em, expected_em):
        raise OIDCClientError("id_token signature verification failed", reason="bad_id_token_sig")


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def verify_id_token(
    id_token: str,
    *,
    jwks: dict[str, Any],
    settings: Settings,
    expected_nonce: str,
    now_ts: float | None = None,
) -> VerifiedIdToken:
    """校验 RS256 `id_token` 的签名与 OIDC 声明，返回标准化玩家身份信息。"""
    if (
        not isinstance(id_token, str)
        or not id_token
        or len(id_token) > MAX_JWT_LENGTH
        or id_token.count(".") != 2
    ):
        raise OIDCClientError("malformed jwt", reason="malformed_id_token")

    header_b64, payload_b64, sig_b64 = id_token.split(".", 2)
    try:
        header = json.loads(b64url_decode(header_b64).decode("utf-8"))
        claims = json.loads(b64url_decode(payload_b64).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OIDCClientError("jwt json decode failed", reason="malformed_id_token") from exc

    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise OIDCClientError("jwt header or payload not an object", reason="malformed_id_token")

    if header.get("alg") != "RS256":
        raise OIDCClientError("unsupported jwt alg", reason="unsupported_alg")

    jwk = _select_jwk(jwks, header.get("kid"))
    sig = b64url_decode(sig_b64)
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    _verify_rs256_signature(signing_input, sig, jwk)

    expected_iss = settings.oidc_issuer.strip().rstrip("/")
    iss = claims.get("iss")
    if not isinstance(iss, str) or iss != expected_iss:
        raise OIDCClientError("id_token issuer mismatch", reason="bad_iss")

    client_id = settings.oidc_client_id.strip()
    aud = claims.get("aud")
    azp = claims.get("azp")
    if isinstance(aud, str):
        if aud != client_id:
            raise OIDCClientError("id_token audience mismatch", reason="bad_aud")
        if azp is not None and azp != client_id:
            raise OIDCClientError("id_token azp mismatch", reason="bad_azp")
    elif isinstance(aud, list):
        if not aud or not all(isinstance(item, str) for item in aud) or client_id not in aud:
            raise OIDCClientError("id_token audience list mismatch", reason="bad_aud")
        if (len(aud) > 1 or azp is not None) and azp != client_id:
            raise OIDCClientError("id_token azp required or mismatch", reason="bad_azp")
    else:
        raise OIDCClientError("id_token missing or invalid aud", reason="bad_aud")

    now = time.time() if now_ts is None else now_ts
    exp = claims.get("exp")
    if not _is_number(exp) or now >= float(exp) + CLOCK_SKEW_SECONDS:
        raise OIDCClientError("id_token expired", reason="id_token_expired")

    iat = claims.get("iat")
    if iat is not None and (not _is_number(iat) or float(iat) > now + IAT_SKEW_SECONDS):
        raise OIDCClientError("id_token invalid iat", reason="bad_iat")

    nbf = claims.get("nbf")
    if nbf is not None and (not _is_number(nbf) or float(nbf) > now + CLOCK_SKEW_SECONDS):
        raise OIDCClientError("id_token not yet valid", reason="bad_nbf")

    nonce = claims.get("nonce")
    if (
        not isinstance(nonce, str)
        or not nonce
        or not isinstance(expected_nonce, str)
        or not expected_nonce
        or not hmac.compare_digest(nonce.encode("utf-8"), expected_nonce.encode("utf-8"))
    ):
        raise OIDCClientError("id_token nonce mismatch", reason="bad_nonce")

    sub = claims.get("sub")
    if not isinstance(sub, str) or not (1 <= len(sub) <= 255) or not sub.strip():
        raise OIDCClientError("id_token invalid sub", reason="bad_sub")

    raw_email = claims.get("email")
    email: str | None = None
    if isinstance(raw_email, str):
        cleaned_email = raw_email.strip()[:320]
        if cleaned_email:
            email = cleaned_email

    email_local = email.split("@", 1)[0].strip() if email and "@" in email else (email or "")
    display_name = "店主"
    for candidate in (claims.get("name"), claims.get("preferred_username"), email_local):
        if isinstance(candidate, str):
            cleaned = candidate.strip()[:100]
            if cleaned:
                display_name = cleaned
                break

    return VerifiedIdToken(
        sub=sub,
        display_name=display_name,
        email=email,
        claims=claims,
    )


def clear_jwks_cache() -> None:
    _JWKS_CACHE.clear()


def exchange_code_for_tokens(
    settings: Settings,
    *,
    code: str,
    code_verifier: str,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """向 `{issuer}/token` 发送 `authorization_code` + PKCE 换取令牌。"""
    issuer = settings.oidc_issuer.strip().rstrip("/")
    token_url = f"{issuer}/token"
    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri_for(settings),
            "client_id": settings.oidc_client_id.strip(),
            "client_secret": settings.oidc_client_secret.get_secret_value(),
            "code_verifier": code_verifier,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        token_url,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            raw_bytes = resp.read(65536)
    except urllib.error.HTTPError as exc:
        if 400 <= exc.code < 500:
            raise OIDCClientError(
                "token endpoint rejected code", reason="token_exchange_4xx"
            ) from exc
        raise OIDCUpstreamError("token endpoint server error", reason="token_exchange_5xx") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OIDCUpstreamError(
            "token endpoint unreachable", reason="token_exchange_network"
        ) from exc

    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OIDCUpstreamError(
            "token endpoint invalid json", reason="token_exchange_bad_json"
        ) from exc

    if not isinstance(data, dict):
        raise OIDCUpstreamError("token response not an object", reason="token_exchange_bad_json")
    if "error" in data:
        raise OIDCClientError("token response returned error", reason="token_exchange_error")
    id_token = data.get("id_token")
    if not isinstance(id_token, str) or not id_token:
        raise OIDCClientError("token response missing id_token", reason="missing_id_token")
    return data


def fetch_jwks(
    settings: Settings,
    *,
    force_refresh: bool = False,
    now_ts: float | None = None,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """获取 `{issuer}/jwks` 公钥集（带 5 分钟内存缓存）。"""
    issuer = settings.oidc_issuer.strip().rstrip("/")
    now = time.time() if now_ts is None else now_ts
    if not force_refresh and issuer in _JWKS_CACHE:
        expires_at, cached = _JWKS_CACHE[issuer]
        if now < expires_at:
            return cached

    jwks_url = f"{issuer}/jwks"
    req = urllib.request.Request(
        jwks_url,
        headers={"Accept": "application/json"},
        method="GET",
    )
    open_fn = opener or urllib.request.urlopen
    try:
        with open_fn(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            raw_bytes = resp.read(65536)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OIDCUpstreamError("failed to fetch jwks", reason="jwks_fetch_failed") from exc

    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OIDCUpstreamError("invalid jwks json", reason="jwks_bad_json") from exc

    if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
        raise OIDCUpstreamError("invalid jwks structure", reason="jwks_bad_structure")

    _JWKS_CACHE[issuer] = (now + JWKS_CACHE_TTL_SECONDS, data)
    return data


class OIDCClient:
    """可注入的 OIDC 客户端抽象（测试可挂载到 `app.state.oidc_client`）。"""

    def exchange_code(
        self,
        settings: Settings,
        *,
        code: str,
        code_verifier: str,
    ) -> dict[str, Any]:
        return exchange_code_for_tokens(settings, code=code, code_verifier=code_verifier)

    def get_jwks(
        self,
        settings: Settings,
        *,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        return fetch_jwks(settings, force_refresh=force_refresh)

    def authenticate_code(
        self,
        settings: Settings,
        *,
        code: str,
        code_verifier: str,
        expected_nonce: str,
        now_ts: float | None = None,
    ) -> VerifiedIdToken:
        token_data = self.exchange_code(settings, code=code, code_verifier=code_verifier)
        id_token = token_data.get("id_token")
        if not isinstance(id_token, str) or not id_token:
            raise OIDCClientError("missing id_token", reason="missing_id_token")

        jwks = self.get_jwks(settings, force_refresh=False)
        try:
            return verify_id_token(
                id_token,
                jwks=jwks,
                settings=settings,
                expected_nonce=expected_nonce,
                now_ts=now_ts,
            )
        except OIDCUnknownKeyIdError:
            jwks = self.get_jwks(settings, force_refresh=True)
            return verify_id_token(
                id_token,
                jwks=jwks,
                settings=settings,
                expected_nonce=expected_nonce,
                now_ts=now_ts,
            )


_DEFAULT_OIDC_CLIENT = OIDCClient()


def get_oidc_client(request: Request) -> OIDCClient:
    """从 `app.state.oidc_client` 或 `app.state.oidc_transport` 获取客户端，默认使用标准库实现。"""
    custom = getattr(request.app.state, "oidc_client", None) or getattr(
        request.app.state, "oidc_transport", None
    )
    if custom is not None:
        return custom  # type: ignore[return-value]
    return _DEFAULT_OIDC_CLIENT
