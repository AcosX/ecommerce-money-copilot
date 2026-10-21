"""OIDC 登录（/auth/login、/auth/callback、/auth/logout）、PKCE 与 RS256 校验测试。"""

from __future__ import annotations

import hashlib
import io
import json
import math
import secrets
import time
import urllib.error
import urllib.parse
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from emc_api.config import Settings
from emc_api.ids import PLAYER, has_prefix
from emc_api.models import AuditEvent, Player, SessionRecord
from emc_api.security import CSRF_HEADER, SESSION_COOKIE
from emc_api.services.oidc import (
    OAUTH_COOKIE,
    OIDCClient,
    OIDCClientError,
    OIDCUpstreamError,
    b64url_encode,
    clear_jwks_cache,
    compute_code_challenge,
    create_oauth_cookie,
    exchange_code_for_tokens,
    fetch_jwks,
    generate_pkce_pair,
    sanitize_return_to,
    verify_id_token,
    verify_oauth_cookie,
)

TEST_ISSUER = "https://idp.example.test"
TEST_CLIENT_ID = "ecommerce-money-copilot-test"
TEST_CLIENT_SECRET = "test-client-secret-value"
_SHA256_DER_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


# ---------------------------------------------------------------- 纯 Python RSA 测试密钥生成与签名


def _is_probable_prime(n: int) -> bool:
    if n < 2 or n % 2 == 0:
        return n == 2
    for p in (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53):
        if n % p == 0:
            return n == p
    d = n - 1
    s = (d & -d).bit_length() - 1
    d >>= s
    for a in (2, 3, 5, 7, 11, 13, 17, 19):
        x = pow(a, d, n)
        if x == 1 or x == n - 1:
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _generate_prime(bits: int) -> int:
    while True:
        candidate = secrets.randbits(bits) | (1 << (bits - 1)) | 1
        if _is_probable_prime(candidate):
            return candidate


@dataclass(frozen=True)
class RSATestKey:
    kid: str
    n: int
    e: int
    d: int

    @property
    def k_bytes(self) -> int:
        return (self.n.bit_length() + 7) // 8

    def to_jwk(self) -> dict[str, Any]:
        e_len = (self.e.bit_length() + 7) // 8
        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": self.kid,
            "n": b64url_encode(self.n.to_bytes(self.k_bytes, "big")),
            "e": b64url_encode(self.e.to_bytes(e_len, "big")),
        }

    def sign_rs256(self, signing_input: bytes) -> bytes:
        digest_info = _SHA256_DER_PREFIX + hashlib.sha256(signing_input).digest()
        ps_len = self.k_bytes - len(digest_info) - 3
        em = b"\x00\x01" + (b"\xff" * ps_len) + b"\x00" + digest_info
        m = int.from_bytes(em, "big")
        s = pow(m, self.d, self.n)
        return s.to_bytes(self.k_bytes, "big")

    def make_jwt(
        self,
        claims: dict[str, Any],
        *,
        header_overrides: dict[str, Any] | None = None,
        tamper_signature: bool = False,
    ) -> str:
        header: dict[str, Any] = {"alg": "RS256", "typ": "JWT", "kid": self.kid}
        if header_overrides:
            header.update(header_overrides)
        header_b64 = b64url_encode(
            json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        payload_b64 = b64url_encode(
            json.dumps(claims, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
                "utf-8"
            )
        )
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        sig = bytearray(self.sign_rs256(signing_input))
        if tamper_signature:
            sig[-1] ^= 0x01
        return f"{header_b64}.{payload_b64}.{b64url_encode(bytes(sig))}"


def generate_rsa_key(bits: int = 2048, kid: str = "test-key-1") -> RSATestKey:
    half = bits // 2
    e = 65537
    while True:
        p = _generate_prime(half)
        q = _generate_prime(half)
        phi = (p - 1) * (q - 1)
        n = p * q
        if p != q and n.bit_length() == bits and math.gcd(e, phi) == 1:
            d = pow(e, -1, phi)
            return RSATestKey(kid=kid, n=n, e=e, d=d)


@pytest.fixture(scope="session")
def rsa_key() -> RSATestKey:
    return generate_rsa_key(2048, kid="test-key-1")


@pytest.fixture(scope="session")
def rotated_rsa_key() -> RSATestKey:
    return generate_rsa_key(2048, kid="test-key-2")


class FakeOIDCProvider(OIDCClient):
    """测试用可编程 OIDC 提供方（检验 code_verifier / PKCE 并签发真实 RS256 id_token）。"""

    def __init__(self, key: RSATestKey) -> None:
        self.key = key
        self.jwks_keys: list[dict[str, Any]] = [key.to_jwk()]
        self.expected_code = "valid-auth-code"
        self.expected_challenge: str | None = None
        self.last_code: str | None = None
        self.last_verifier: str | None = None
        self.sub = "user-sub-001"
        self.name: str | None = "阿猫掌柜"
        self.preferred_username: str | None = None
        self.email: str | None = "cat@shop.example"
        self.claims_override: dict[str, Any] = {}
        self.header_override: dict[str, Any] = {}
        self.tamper_signature = False
        self.next_error: Exception | None = None
        self.jwks_fetch_count = 0

    def exchange_code(
        self,
        settings: Settings,
        *,
        code: str,
        code_verifier: str,
    ) -> dict[str, Any]:
        if self.next_error is not None:
            raise self.next_error
        self.last_code = code
        self.last_verifier = code_verifier
        if code != self.expected_code:
            raise OIDCClientError("invalid authorization code", reason="invalid_grant")
        if self.expected_challenge is not None:
            actual_challenge = compute_code_challenge(code_verifier)
            if actual_challenge != self.expected_challenge:
                raise OIDCClientError("pkce verifier mismatch", reason="pkce_mismatch")

        now = int(time.time())
        claims: dict[str, Any] = {
            "iss": settings.oidc_issuer.rstrip("/"),
            "sub": self.sub,
            "aud": settings.oidc_client_id,
            "iat": now,
            "exp": now + 300,
            "nonce": self._pending_nonce,
        }
        if self.name is not None:
            claims["name"] = self.name
        if self.preferred_username is not None:
            claims["preferred_username"] = self.preferred_username
        if self.email is not None:
            claims["email"] = self.email
        claims.update(self.claims_override)

        id_token = self.key.make_jwt(
            claims,
            header_overrides=self.header_override,
            tamper_signature=self.tamper_signature,
        )
        return {
            "access_token": "unused-access-token",
            "token_type": "Bearer",
            "expires_in": 300,
            "id_token": id_token,
        }

    def get_jwks(
        self,
        settings: Settings,
        *,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        self.jwks_fetch_count += 1
        return {"keys": list(self.jwks_keys)}

    def bind_from_authorize_redirect(self, location: str) -> dict[str, str]:
        parsed = urllib.parse.urlsplit(location)
        params = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        self._pending_nonce = params["nonce"]
        self.expected_challenge = params["code_challenge"]
        return params


@pytest.fixture
def oidc_settings(settings: Settings) -> Settings:
    clear_jwks_cache()
    settings.oidc_issuer = TEST_ISSUER
    settings.oidc_client_id = TEST_CLIENT_ID
    settings.oidc_client_secret = SecretStr(TEST_CLIENT_SECRET)
    return settings


@pytest.fixture
def fake_idp(rsa_key: RSATestKey) -> FakeOIDCProvider:
    return FakeOIDCProvider(rsa_key)


@pytest.fixture
def app(app_factory, oidc_settings: Settings, fake_idp: FakeOIDCProvider) -> FastAPI:
    application = app_factory(settings_override=oidc_settings)
    application.state.oidc_client = fake_idp
    return application


# ---------------------------------------------------------------- sanitize_return_to 与 PKCE


@pytest.mark.parametrize(
    "valid_path",
    [
        "/",
        "/#view=level&lv=2&gate=%E7%9C%9F%E5%AE%9E%E7%BB%8F%E8%90%A5",
        "/index.html?a=1#view=verify",
        "/admin/?status=pending",
        "/" + "a" * 1999,
    ],
)
def test_sanitize_return_to_allows_safe_relative_paths(valid_path: str) -> None:
    assert sanitize_return_to(valid_path) == valid_path


@pytest.mark.parametrize(
    "unsafe_input",
    [
        None,
        "",
        "relative/no-leading-slash",
        "//evil.com",
        "///evil.com",
        "https://evil.com/path",
        "http://evil.com",
        "javascript:alert(1)",
        "/\\evil.com",
        "/path\\with\\backslash",
        "/path\x00null",
        "/path\r\nheader:injected",
        "/path\x1fcontrol",
        "/path\x7fdel",
        "/" + "a" * 2000,
    ],
)
def test_sanitize_return_to_rejects_open_redirects(unsafe_input: str | None) -> None:
    assert sanitize_return_to(unsafe_input) == "/"


def test_pkce_s256_generation() -> None:
    verifier, challenge = generate_pkce_pair()
    assert len(verifier) == 64
    assert "=" not in challenge
    expected = hashlib.sha256(verifier.encode("ascii")).digest()
    assert challenge == b64url_encode(expected)
    assert challenge == compute_code_challenge(verifier)


# ---------------------------------------------------------------- GET /auth/login


def test_login_sets_signed_cookie_and_redirects_to_authorize(
    client: TestClient, oidc_settings: Settings
) -> None:
    target = "/#view=level&lv=2&gate=%E7%9C%9F%E5%AE%9E%E7%BB%8F%E8%90%A5"
    resp = client.get("/auth/login", params={"return_to": target}, follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["Cache-Control"] == "no-store"

    location = resp.headers["location"]
    parsed = urllib.parse.urlsplit(location)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == f"{TEST_ISSUER}/authorize"
    params = dict(urllib.parse.parse_qsl(parsed.query))
    assert params["response_type"] == "code"
    assert params["client_id"] == TEST_CLIENT_ID
    assert params["redirect_uri"] == "http://testserver/auth/callback"
    assert params["scope"] == "openid profile email"
    assert params["code_challenge_method"] == "S256"
    assert len(params["state"]) >= 32
    assert len(params["nonce"]) >= 32

    set_cookie_header = resp.headers.get("set-cookie", "")
    assert "emc_oauth=" in set_cookie_header
    assert "HttpOnly" in set_cookie_header
    assert "Path=/auth" in set_cookie_header
    assert "SameSite=lax" in set_cookie_header

    raw_cookie = resp.cookies.get(OAUTH_COOKIE)
    pending = verify_oauth_cookie(
        raw_cookie, expected_state=params["state"], settings=oidc_settings
    )
    assert pending.nonce == params["nonce"]
    assert pending.return_to == target
    assert compute_code_challenge(pending.verifier) == params["code_challenge"]


def test_login_sanitizes_malicious_return_to(client: TestClient, oidc_settings: Settings) -> None:
    resp = client.get(
        "/auth/login", params={"return_to": "https://evil.example/phish"}, follow_redirects=False
    )
    assert resp.status_code == 302
    params = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(resp.headers["location"]).query))
    pending = verify_oauth_cookie(
        resp.cookies.get(OAUTH_COOKIE), expected_state=params["state"], settings=oidc_settings
    )
    assert pending.return_to == "/"


def test_login_when_oidc_not_configured_returns_503_html(
    client: TestClient, oidc_settings: Settings
) -> None:
    oidc_settings.oidc_issuer = ""
    resp = client.get("/auth/login?return_to=/index.html", follow_redirects=False)
    assert resp.status_code == 503
    assert "text/html" in resp.headers["content-type"]
    assert "重新登录" in resp.text
    assert "返回游戏小镇（继续教学）" in resp.text


# ---------------------------------------------------------------- 完整 OIDC 登录与回调闭环


def test_full_oidc_login_callback_creates_player_session_and_audit(
    client: TestClient,
    db_session: Session,
    fake_idp: FakeOIDCProvider,
) -> None:
    return_to = "/#view=level&lv=2&gate=%E7%9C%9F%E5%AE%9E%E7%BB%8F%E8%90%A5"
    login_resp = client.get("/auth/login", params={"return_to": return_to}, follow_redirects=False)
    auth_params = fake_idp.bind_from_authorize_redirect(login_resp.headers["location"])

    cb_resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": auth_params["state"]},
        follow_redirects=False,
    )
    assert cb_resp.status_code == 303
    assert cb_resp.headers["location"] == return_to
    assert cb_resp.headers["Cache-Control"] == "no-store"

    # emc_oauth 临时 Cookie 被清除，emc_session 会话 Cookie 被设置
    set_cookies = cb_resp.headers.get_list("set-cookie")
    assert any("emc_oauth=" in c and ("Max-Age=0" in c or 'emc_oauth=""' in c) for c in set_cookies)
    assert any("emc_session=" in c and "HttpOnly" in c and "Path=/" in c for c in set_cookies)

    # 数据库已创建 Player、SessionRecord 与 auth.login 审计事件
    db_session.expire_all()
    player = db_session.scalar(select(Player).where(Player.acos_sub == "user-sub-001"))
    assert player is not None
    assert has_prefix(player.id, PLAYER)
    assert player.display_name == "阿猫掌柜"
    assert player.email == "cat@shop.example"
    assert player.last_login_at is not None

    audit = db_session.scalar(
        select(AuditEvent).where(
            AuditEvent.action == "auth.login", AuditEvent.actor_player_id == player.id
        )
    )
    assert audit is not None
    assert audit.target_type == "player"
    assert audit.target_id == player.id

    # 后续 GET /api/me 返回登录玩家与 csrf_token
    me_resp = client.get("/api/me")
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["authenticated"] is True
    assert me_data["player"] == {
        "id": player.id,
        "display_name": "阿猫掌柜",
        "email": "cat@shop.example",
    }
    assert me_data["roles"] == ["player"]
    assert isinstance(me_data["csrf_token"], str) and len(me_data["csrf_token"]) >= 32


def test_relogin_same_sub_preserves_player_id_and_updates_profile(
    client: TestClient,
    db_session: Session,
    oidc_settings: Settings,
    fake_idp: FakeOIDCProvider,
) -> None:
    # 首次登录
    r1 = client.get("/auth/login", follow_redirects=False)
    p1 = fake_idp.bind_from_authorize_redirect(r1.headers["location"])
    cb1 = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": p1["state"]},
        follow_redirects=False,
    )
    assert cb1.status_code == 303
    first_me = client.get("/api/me").json()
    player_id = first_me["player"]["id"]

    db_session.expire_all()
    first_login_at = db_session.get(Player, player_id).last_login_at
    assert first_login_at is not None
    # 将首次登录时间回拨 10 秒以验证再次登录会更新 last_login_at
    db_session.get(Player, player_id).last_login_at = first_login_at - timedelta(seconds=10)
    db_session.commit()

    # 配置该 sub 为 reviewer，且在 IdP 更新昵称与邮箱后再次登录
    oidc_settings.reviewer_subs = f"other-sub,{fake_idp.sub}"
    fake_idp.name = None
    fake_idp.preferred_username = "皇冠店主阿猫"
    fake_idp.email = "newcat@shop.example"

    r2 = client.get("/auth/login", follow_redirects=False)
    p2 = fake_idp.bind_from_authorize_redirect(r2.headers["location"])
    cb2 = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": p2["state"]},
        follow_redirects=False,
    )
    assert cb2.status_code == 303

    second_me = client.get("/api/me").json()
    assert second_me["authenticated"] is True
    assert second_me["player"] == {
        "id": player_id,
        "display_name": "皇冠店主阿猫",
        "email": "newcat@shop.example",
    }
    assert second_me["roles"] == ["player", "reviewer"]

    db_session.expire_all()
    total_players = db_session.scalar(select(func.count()).select_from(Player))
    assert total_players == 1
    updated_player = db_session.get(Player, player_id)
    assert updated_player.last_login_at >= first_login_at


def test_jwks_unknown_kid_refreshes_once_and_succeeds(
    client: TestClient,
    fake_idp: FakeOIDCProvider,
    rotated_rsa_key: RSATestKey,
) -> None:
    # 初始 JWKS 仅含旧密钥；当签发新 kid 的令牌时，get_jwks(force_refresh=True) 返回新密钥
    old_key = fake_idp.key

    def get_jwks_with_rotation(
        settings: Settings, *, force_refresh: bool = False
    ) -> dict[str, Any]:
        fake_idp.jwks_fetch_count += 1
        if force_refresh:
            return {"keys": [rotated_rsa_key.to_jwk()]}
        return {"keys": [old_key.to_jwk()]}

    fake_idp.get_jwks = get_jwks_with_rotation  # type: ignore[method-assign]
    fake_idp.key = rotated_rsa_key

    r1 = client.get("/auth/login", follow_redirects=False)
    p1 = fake_idp.bind_from_authorize_redirect(r1.headers["location"])
    cb = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": p1["state"]},
        follow_redirects=False,
    )
    assert cb.status_code == 303
    assert fake_idp.jwks_fetch_count == 2
    assert client.get("/api/me").json()["authenticated"] is True


# ---------------------------------------------------------------- 回调负向安全测试


def _assert_error_html(
    resp,
    *,
    expected_status: int = 400,
    expected_return_to: str = "/",
) -> None:
    assert resp.status_code == expected_status
    assert "text/html" in resp.headers["content-type"]
    assert resp.headers.get("Cache-Control") == "no-store"
    body = resp.text
    expected_retry = f"/auth/login?{urllib.parse.urlencode({'return_to': expected_return_to})}"
    assert expected_retry in body
    assert "重新登录" in body
    assert "返回游戏小镇（继续教学）" in body
    assert f"{TEST_ISSUER}/forgot-password" in body
    assert f"{TEST_ISSUER}/resend-verification" in body
    assert TEST_CLIENT_SECRET not in body


def test_callback_missing_oauth_cookie_returns_400_html(
    client: TestClient, db_session: Session
) -> None:
    resp = client.get(
        "/auth/callback", params={"code": "valid-auth-code", "state": "any"}, follow_redirects=False
    )
    _assert_error_html(resp, expected_status=400, expected_return_to="/")
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_tampered_oauth_cookie_signature_returns_400_html(
    client: TestClient, db_session: Session
) -> None:
    r = client.get("/auth/login", params={"return_to": "/#view=verify"}, follow_redirects=False)
    state = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(r.headers["location"]).query))[
        "state"
    ]
    raw_cookie = r.cookies.get(OAUTH_COOKIE)
    assert raw_cookie is not None
    tampered = raw_cookie[:-2] + ("AA" if not raw_cookie.endswith("AA") else "BB")
    client.cookies.set(OAUTH_COOKIE, tampered, path="/auth")

    resp = client.get(
        "/auth/callback", params={"code": "valid-auth-code", "state": state}, follow_redirects=False
    )
    _assert_error_html(resp, expected_status=400, expected_return_to="/")
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_expired_oauth_cookie_returns_400_html(
    client: TestClient, oidc_settings: Settings, db_session: Session
) -> None:
    expired_cookie, pending = create_oauth_cookie(
        oidc_settings,
        state="state-expired-123",
        nonce="nonce-expired-123",
        verifier="v" * 64,
        return_to="/#view=level&lv=3",
        now_ts=time.time() - 1200,
    )
    client.cookies.set(OAUTH_COOKIE, expired_cookie, path="/auth")
    resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": pending.state},
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=400, expected_return_to="/#view=level&lv=3")
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_state_mismatch_returns_400_html(
    client: TestClient, fake_idp: FakeOIDCProvider, db_session: Session
) -> None:
    r = client.get("/auth/login", params={"return_to": "/#view=level&lv=1"}, follow_redirects=False)
    fake_idp.bind_from_authorize_redirect(r.headers["location"])
    resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": "wrong-state-value"},
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=400, expected_return_to="/#view=level&lv=1")
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_upstream_oauth_error_returns_400_html(
    client: TestClient, fake_idp: FakeOIDCProvider, db_session: Session
) -> None:
    r = client.get("/auth/login", params={"return_to": "/#view=verify"}, follow_redirects=False)
    params = fake_idp.bind_from_authorize_redirect(r.headers["location"])
    resp = client.get(
        "/auth/callback",
        params={
            "error": "access_denied",
            "error_description": "<script>alert('xss')</script>",
            "state": params["state"],
        },
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=400, expected_return_to="/#view=verify")
    assert "<script>" not in resp.text
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


@pytest.mark.parametrize(
    ("override_field", "override_value"),
    [
        ("nonce", "wrong-nonce-value"),
        ("iss", "https://evil-idp.example.test"),
        ("aud", "other-client-id"),
        ("aud", [TEST_CLIENT_ID, "second-aud-without-azp"]),
        ("exp", int(time.time()) - 120),
        ("iat", int(time.time()) + 300),
        ("nbf", int(time.time()) + 300),
        ("sub", ""),
    ],
)
def test_callback_rejects_invalid_id_token_claims(
    client: TestClient,
    fake_idp: FakeOIDCProvider,
    db_session: Session,
    override_field: str,
    override_value: Any,
) -> None:
    fake_idp.claims_override = {override_field: override_value}
    r = client.get("/auth/login", follow_redirects=False)
    params = fake_idp.bind_from_authorize_redirect(r.headers["location"])
    resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": params["state"]},
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=400)
    assert db_session.scalar(select(func.count()).select_from(Player)) == 0
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_rejects_tampered_id_token_signature(
    client: TestClient,
    fake_idp: FakeOIDCProvider,
    db_session: Session,
) -> None:
    fake_idp.tamper_signature = True
    r = client.get("/auth/login", follow_redirects=False)
    params = fake_idp.bind_from_authorize_redirect(r.headers["location"])
    resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": params["state"]},
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=400)
    assert db_session.scalar(select(func.count()).select_from(Player)) == 0
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_rejects_non_rs256_alg(
    client: TestClient,
    fake_idp: FakeOIDCProvider,
    db_session: Session,
) -> None:
    fake_idp.header_override = {"alg": "HS256"}
    r = client.get("/auth/login", follow_redirects=False)
    params = fake_idp.bind_from_authorize_redirect(r.headers["location"])
    resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": params["state"]},
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=400)
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_callback_upstream_network_failure_returns_502_html(
    client: TestClient,
    fake_idp: FakeOIDCProvider,
    db_session: Session,
) -> None:
    fake_idp.next_error = OIDCUpstreamError("upstream down", reason="token_exchange_network")
    r = client.get("/auth/login", params={"return_to": "/#view=level&lv=4"}, follow_redirects=False)
    params = fake_idp.bind_from_authorize_redirect(r.headers["location"])
    resp = client.get(
        "/auth/callback",
        params={"code": "valid-auth-code", "state": params["state"]},
        follow_redirects=False,
    )
    _assert_error_html(resp, expected_status=502, expected_return_to="/#view=level&lv=4")
    assert db_session.scalar(select(func.count()).select_from(SessionRecord)) == 0


def test_verify_id_token_rejects_weak_1024_bit_rsa_key(oidc_settings: Settings) -> None:
    weak_key = generate_rsa_key(1024, kid="weak-key")
    now = int(time.time())
    token = weak_key.make_jwt(
        {
            "iss": TEST_ISSUER,
            "sub": "sub-weak",
            "aud": TEST_CLIENT_ID,
            "iat": now,
            "exp": now + 300,
            "nonce": "n-1",
        }
    )
    with pytest.raises(OIDCClientError) as exc_info:
        verify_id_token(
            token,
            jwks={"keys": [weak_key.to_jwk()]},
            settings=oidc_settings,
            expected_nonce="n-1",
        )
    assert exc_info.value.reason == "weak_rsa_key"


def test_exchange_code_and_fetch_jwks_stdlib_http(
    oidc_settings: Settings, rsa_key: RSATestKey
) -> None:
    clear_jwks_cache()
    calls: list[str] = []

    class DummyHTTPResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.close()

    def fake_opener(req: urllib.request.Request, timeout: float = 10.0):
        calls.append(req.full_url)
        if req.full_url.endswith("/token"):
            body_params = dict(urllib.parse.parse_qsl((req.data or b"").decode("utf-8")))
            assert body_params["grant_type"] == "authorization_code"
            assert body_params["client_id"] == TEST_CLIENT_ID
            assert body_params["client_secret"] == TEST_CLIENT_SECRET
            assert body_params["code"] == "c-123"
            assert body_params["code_verifier"] == "v" * 64
            return DummyHTTPResponse(json.dumps({"id_token": "header.payload.sig"}).encode("utf-8"))
        if req.full_url.endswith("/jwks"):
            return DummyHTTPResponse(json.dumps({"keys": [rsa_key.to_jwk()]}).encode("utf-8"))
        raise AssertionError(f"unexpected url: {req.full_url}")

    token_data = exchange_code_for_tokens(
        oidc_settings, code="c-123", code_verifier="v" * 64, opener=fake_opener
    )
    assert token_data["id_token"] == "header.payload.sig"

    jwks1 = fetch_jwks(oidc_settings, opener=fake_opener)
    jwks2 = fetch_jwks(oidc_settings, opener=fake_opener)
    assert jwks1 == jwks2
    assert calls.count(f"{TEST_ISSUER}/jwks") == 1  # 第二次命中内存缓存

    def error_400_opener(req: urllib.request.Request, timeout: float = 10.0):
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(b"{}"))

    with pytest.raises(OIDCClientError):
        exchange_code_for_tokens(
            oidc_settings, code="bad", code_verifier="v" * 64, opener=error_400_opener
        )

    def error_net_opener(req: urllib.request.Request, timeout: float = 10.0):
        raise urllib.error.URLError("connection refused")

    with pytest.raises(OIDCUpstreamError):
        exchange_code_for_tokens(
            oidc_settings, code="bad", code_verifier="v" * 64, opener=error_net_opener
        )


# ---------------------------------------------------------------- POST /auth/logout


def test_logout_unauthenticated_returns_401(client: TestClient) -> None:
    resp = client.post("/auth/logout")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthenticated"


def test_logout_requires_csrf_and_origin(client: TestClient, make_player, login_as) -> None:
    player = make_player()
    new_session = login_as(player)

    # 缺少 X-CSRF-Token
    client.headers.pop(CSRF_HEADER, None)
    resp_missing = client.post("/auth/logout")
    assert resp_missing.status_code == 403
    assert resp_missing.json()["error"]["code"] == "csrf_failed"

    # 错误的 X-CSRF-Token
    client.headers[CSRF_HEADER] = "wrong-csrf-token"
    resp_wrong = client.post("/auth/logout")
    assert resp_wrong.status_code == 403
    assert resp_wrong.json()["error"]["code"] == "csrf_failed"

    # 错误的 Origin
    client.headers[CSRF_HEADER] = new_session.csrf_token
    client.headers["Origin"] = "https://evil.example"
    resp_origin = client.post("/auth/logout")
    assert resp_origin.status_code == 403
    assert resp_origin.json()["error"]["code"] == "csrf_failed"

    # 会话仍有效
    assert client.get("/api/me").json()["authenticated"] is True


def test_logout_revokes_session_clears_cookie_and_records_audit(
    client: TestClient,
    db_session: Session,
    make_player,
    login_as,
) -> None:
    player = make_player()
    new_session = login_as(player)

    resp = client.post("/auth/logout")
    assert resp.status_code == 204
    assert resp.content == b""

    set_cookie = resp.headers.get("set-cookie", "")
    assert f"{SESSION_COOKIE}=" in set_cookie
    assert "Max-Age=0" in set_cookie or f'{SESSION_COOKIE}=""' in set_cookie

    # 数据库会话已吊销，且写入 auth.logout 审计记录
    db_session.expire_all()
    record = db_session.get(SessionRecord, new_session.id_hash)
    assert record is not None and record.revoked_at is not None

    audit = db_session.scalar(
        select(AuditEvent).where(
            AuditEvent.action == "auth.logout",
            AuditEvent.actor_player_id == player.id,
        )
    )
    assert audit is not None
    assert audit.target_type == "player"
    assert audit.target_id == player.id

    # 即使客户端强行继续携带旧 Cookie，/api/me 也返回未登录
    client.cookies.set(SESSION_COOKIE, new_session.token)
    assert client.get("/api/me").json() == {"authenticated": False}


def test_verify_id_token_single_jwk_without_kid_and_azp_rules(
    oidc_settings: Settings, rsa_key: RSATestKey, rotated_rsa_key: RSATestKey
) -> None:
    now = int(time.time())
    base_claims = {
        "iss": TEST_ISSUER,
        "sub": "sub-no-kid",
        "aud": [TEST_CLIENT_ID, "secondary-aud"],
        "azp": TEST_CLIENT_ID,
        "iat": now,
        "exp": now + 300,
        "nonce": "nonce-xyz",
        "email": "shopkeeper@merchant.example",
    }
    token_no_kid = rsa_key.make_jwt(base_claims, header_overrides={"kid": None})

    # 单把 RSA 公钥时允许无 kid
    verified = verify_id_token(
        token_no_kid,
        jwks={"keys": [rsa_key.to_jwk()]},
        settings=oidc_settings,
        expected_nonce="nonce-xyz",
    )
    assert verified.sub == "sub-no-kid"
    assert verified.display_name == "shopkeeper"
    assert verified.email == "shopkeeper@merchant.example"

    # 多把 RSA 公钥但无 kid 时拒绝
    with pytest.raises(OIDCClientError) as exc_info:
        verify_id_token(
            token_no_kid,
            jwks={"keys": [rsa_key.to_jwk(), rotated_rsa_key.to_jwk()]},
            settings=oidc_settings,
            expected_nonce="nonce-xyz",
        )
    assert exc_info.value.reason == "ambiguous_jwk"

    # 无 name/preferred_username/email 时回退 "店主"
    token_default_name = rsa_key.make_jwt(
        {
            "iss": TEST_ISSUER,
            "sub": "sub-default-name",
            "aud": TEST_CLIENT_ID,
            "iat": now,
            "exp": now + 300,
            "nonce": "nonce-xyz",
        }
    )
    v2 = verify_id_token(
        token_default_name,
        jwks={"keys": [rsa_key.to_jwk()]},
        settings=oidc_settings,
        expected_nonce="nonce-xyz",
    )
    assert v2.display_name == "店主"
    assert v2.email is None
