"""Isolated OAuth theme regression: temp SQLite + temp signing key, no SMTP, no live data.

Run: PYTHONPATH=. python tests/test_theme_branding.py
Covers the full authorization-code + PKCE flow for a pixel-themed client, every
themed page (login, register, consent, message, forgot, resend, reset, verify),
and checks that other clients, standalone pages and tampered cookies keep the
default UI.
"""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

TMP = tempfile.TemporaryDirectory(prefix="acos-theme-regression-")
PIXEL_CLIENT = "ecommerce-money-copilot-test"
OTHER_CLIENT = "other-client-test"
REDIRECT = "https://game.example.invalid/auth/callback"
OTHER_REDIRECT = "https://other.example.invalid/cb"
XSS_NAME = '<script>alert("x")</script>店'

os.environ.update({
    "ACOS_CONNECT_DATA_DIR": TMP.name,
    "ACOS_CONNECT_DB": str(Path(TMP.name) / "test.sqlite3"),
    "ACOS_CONNECT_KEY_FILE": str(Path(TMP.name) / "test-key.pem"),
    "ACOS_CONNECT_SECRET_KEY": "isolated-theme-test-key-not-production-" + "y" * 40,
    "ACOS_CONNECT_PUBLIC_BASE_URL": "http://testserver",
    "ACOS_CONNECT_ISSUER": "http://testserver",
    "ACOS_CONNECT_PIXEL_CLIENT_IDS": PIXEL_CLIENT,
    "ACOS_CONNECT_CLIENTS_JSON": json.dumps([
        {"client_id": PIXEL_CLIENT, "redirect_uris": [REDIRECT],
         "allowed_scopes": ["openid", "profile", "email"], "client_name": XSS_NAME},
        {"client_id": OTHER_CLIENT, "redirect_uris": [OTHER_REDIRECT],
         "allowed_scopes": ["openid", "profile", "email"], "client_name": "Other"},
    ]),
})
for k in ("ACOS_CONNECT_CLIENT_ID", "ACOS_CONNECT_SMTP_HOST", "ACOS_CONNECT_SMTP_PASSWORD"):
    os.environ.pop(k, None)

import app as acos  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

PIXEL_MARK = "电商搞钱参谋"
DEFAULT_MARK = "Acos Connect"
EMAIL = "player@example.invalid"
PASSWORD = "pixel-pass-123"
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -- {detail}"))


def is_pixel(r):
    return PIXEL_MARK in r.text


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize(c, client_id, redirect, state="s1"):
    verifier, challenge = pkce()
    r = c.get("/authorize", params={
        "response_type": "code", "client_id": client_id, "redirect_uri": redirect,
        "scope": "openid profile email", "state": state, "nonce": "n1",
        "code_challenge": challenge, "code_challenge_method": "S256",
    }, follow_redirects=False)
    return r, verifier


def code_from(r, redirect, state):
    loc = r.headers.get("location", "")
    q = parse_qs(urlparse(loc).query)
    ok = loc.startswith(redirect) and q.get("state") == [state] and "code" in q
    return (q["code"][0] if ok else None), loc


def db():
    conn = sqlite3.connect(os.environ["ACOS_CONNECT_DB"])
    conn.row_factory = sqlite3.Row
    return conn


def plant_token(table, account_id, ttl=3600):
    value = secrets.token_urlsafe(24)
    with db() as conn:
        conn.execute(f"INSERT INTO {table} (account_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
                     (account_id, acos.token_hash(value), int(time.time()) + ttl, int(time.time())))
    return value


with TestClient(acos.app) as c:
    # 1. Standalone pages keep the default UI.
    for path in ("/login", "/register", "/forgot-password", "/resend-verification"):
        r = c.get(path)
        check(f"default {path} without OAuth context", r.status_code == 200 and not is_pixel(r) and DEFAULT_MARK in r.text, r.status_code)

    # 2. Pixel client: /authorize -> /login, pending cookie selects the theme.
    r, verifier = authorize(c, PIXEL_CLIENT, REDIRECT, "st-pixel")
    check("authorize redirects to /login", r.status_code in (302, 303, 307) and r.headers["location"].endswith("/login"), r.status_code)
    for path in ("/login", "/register", "/forgot-password", "/resend-verification"):
        r = c.get(path)
        check(f"pixel {path}", r.status_code == 200 and is_pixel(r), r.status_code)
    r = c.get("/login")
    check("pixel login has accessible labels", 'for="username"' in r.text and 'for="password"' in r.text)
    check("pixel login keeps Entra + forgot links", "/login/entra" in r.text and "/forgot-password" in r.text)
    check("pixel page no-store", r.headers.get("cache-control") == "no-store")

    # 3. Register through themed flow; message page themed; error escaped.
    r = c.post("/register", data={"username": "not-an-email<b>", "password": PASSWORD})
    check("pixel register error escaped", is_pixel(r) and "<b>" not in r.text.split("</style>")[1] and "请输入有效的邮箱地址" in r.text)
    r = c.post("/register", data={"display_name": "店主", "username": EMAIL, "password": PASSWORD})
    check("pixel register success message", r.status_code == 200 and is_pixel(r) and "注册成功" in r.text, r.status_code)
    with db() as conn:
        account_id = conn.execute("SELECT account_id FROM local_credentials WHERE username=?", (EMAIL,)).fetchone()[0]
        queued = conn.execute("SELECT COUNT(*) FROM email_outbox WHERE account_id=? AND kind='verification'", (account_id,)).fetchone()[0]
    check("verification email queued (outbox only)", queued == 1, queued)

    # 4. Unverified login -> themed 403 message.
    r = c.post("/login", data={"username": EMAIL, "password": PASSWORD}, follow_redirects=False)
    check("pixel unverified login 403", r.status_code == 403 and is_pixel(r) and "邮箱验证" in r.text, r.status_code)
    r = c.post("/login", data={"username": EMAIL, "password": "wrong-password"}, follow_redirects=False)
    check("pixel wrong password error", r.status_code == 200 and is_pixel(r) and "不正确" in r.text, r.status_code)

    # 5. Verify email via link (themed while pending is present).
    tok = plant_token("email_verification_tokens", account_id)
    r = c.get("/verify-email", params={"token": tok})
    check("pixel verify-email success", r.status_code == 200 and is_pixel(r) and "邮箱已验证" in r.text, r.status_code)
    r = c.get("/verify-email", params={"token": tok})
    check("pixel verify-email reused token rejected", r.status_code == 400 and is_pixel(r), r.status_code)

    # 6. Login -> authorization code -> token exchange with PKCE.
    r = c.post("/login", data={"username": EMAIL, "password": PASSWORD}, follow_redirects=False)
    code, loc = code_from(r, REDIRECT, "st-pixel")
    check("login returns code to client redirect", r.status_code == 303 and code, f"{r.status_code} {loc[:80]}")
    t = c.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                                "client_id": PIXEL_CLIENT, "code_verifier": verifier})
    body = t.json() if t.headers.get("content-type", "").startswith("application/json") else {}
    check("token exchange with PKCE", t.status_code == 200 and body.get("access_token") and body.get("id_token"), f"{t.status_code} {t.text[:200]}")
    t2 = c.post("/token", data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                                 "client_id": PIXEL_CLIENT, "code_verifier": verifier})
    check("code is single use", t2.status_code == 400, t2.status_code)
    if body.get("access_token"):
        u = c.get("/userinfo", headers={"Authorization": f"Bearer {body['access_token']}"})
        check("userinfo returns stable sub", u.status_code == 200 and u.json().get("sub"), f"{u.status_code} {u.text[:200]}")

    # 7. Wrong PKCE verifier rejected.
    r, _ = authorize(c, PIXEL_CLIENT, REDIRECT, "st-bad")
    r = c.post("/authorize/confirm", follow_redirects=False)
    bad_code, _ = code_from(r, REDIRECT, "st-bad")
    t = c.post("/token", data={"grant_type": "authorization_code", "code": bad_code, "redirect_uri": REDIRECT,
                                "client_id": PIXEL_CLIENT, "code_verifier": "x" * 50})
    check("wrong PKCE verifier rejected", t.status_code == 400, t.status_code)

    # 8. Logged-in authorize -> themed consent page, client name escaped.
    r, verifier = authorize(c, PIXEL_CLIENT, REDIRECT, "st-consent")
    check("logged-in authorize -> consent", r.headers.get("location", "").endswith("/authorize/confirm"), r.headers.get("location"))
    r = c.get("/authorize/confirm")
    check("pixel consent page", r.status_code == 200 and is_pixel(r) and EMAIL in r.text, r.status_code)
    check("consent client_name escaped", "<script>alert" not in r.text and "&lt;script&gt;" in r.text)
    r = c.post("/authorize/confirm", follow_redirects=False)
    code, loc = code_from(r, REDIRECT, "st-consent")
    check("consent confirm returns code", r.status_code == 303 and code, loc[:80])

    # 9. Password reset pages themed while pending is present.
    authorize(c, PIXEL_CLIENT, REDIRECT, "st-reset")
    r = c.post("/forgot-password", data={"username": EMAIL})
    check("pixel forgot-password result", r.status_code == 200 and is_pixel(r), r.status_code)
    rtok = plant_token("password_reset_tokens", account_id)
    r = c.get("/reset-password", params={"token": rtok})
    check("pixel reset form", r.status_code == 200 and is_pixel(r) and 'name="token"' in r.text, r.status_code)
    r = c.post("/reset-password", data={"token": rtok, "password": "short"})
    check("pixel reset short password error", is_pixel(r) and "至少需要 8 个字符" in r.text)
    r = c.post("/reset-password", data={"token": rtok, "password": "new-pixel-pass-456"})
    check("pixel reset success", r.status_code == 200 and is_pixel(r) and "密码已更新" in r.text, r.status_code)

    # 10. Switch account clears session and keeps theme on /login.
    r = c.post("/authorize/switch", follow_redirects=False)
    check("switch -> /login 303", r.status_code == 303, r.status_code)
    c.cookies.delete(acos.COOKIE_SESSION)
    r = c.get("/login")
    check("pixel login after switch", is_pixel(r))

with TestClient(acos.app) as c:
    # 11. Other client keeps default UI end to end.
    r, _ = authorize(c, OTHER_CLIENT, OTHER_REDIRECT, "st-other")
    r = c.get("/login")
    check("other client login default", r.status_code == 200 and not is_pixel(r))
    r = c.post("/login", data={"username": EMAIL, "password": "new-pixel-pass-456"}, follow_redirects=False)
    code, loc = code_from(r, OTHER_REDIRECT, "st-other")
    check("other client login still issues code", r.status_code == 303 and code, f"{r.status_code} {loc[:80]}")
    authorize(c, OTHER_CLIENT, OTHER_REDIRECT, "st-other2")
    r = c.get("/authorize/confirm")
    check("other client consent default", r.status_code == 200 and not is_pixel(r) and "确认授权" in r.text)

with TestClient(acos.app) as c:
    # 12. Forged (unsigned/tampered) pending cookie falls back to default.
    forged = base64.urlsafe_b64encode(json.dumps({"client_id": PIXEL_CLIENT}).encode()).rstrip(b"=").decode() + ".bad"
    c.cookies.set(acos.COOKIE_PENDING, forged)
    r = c.get("/login")
    check("forged pending cookie -> default", not is_pixel(r))
    c.cookies.set(acos.COOKIE_PENDING, "garbage")
    r = c.get("/login")
    check("garbage pending cookie -> default", r.status_code == 200 and not is_pixel(r))
    # 13. Health and discovery unaffected by middleware.
    check("health 200", c.get("/health").status_code == 200)
    check("openid-configuration 200", c.get("/.well-known/openid-configuration").status_code == 200)

# 14. Theme context does not leak across requests (context var reset).
import theme_branding  # noqa: E402
check("context var reset after requests", theme_branding.current_theme() == theme_branding.DEFAULT_THEME)

TMP.cleanup()
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
