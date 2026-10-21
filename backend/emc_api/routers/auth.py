"""`/auth/login`、`/auth/callback`、`/auth/logout`（契约 §5）。"""

from __future__ import annotations

import html
import logging
import secrets
import urllib.parse

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db, is_duplicate_key_error, with_retry
from ..ids import PLAYER, new_id
from ..models import Player
from ..security import (
    CurrentPlayer,
    NewSession,
    clear_session_cookie,
    create_session,
    get_app_settings,
    require_csrf,
    revoke_session,
    set_session_cookie,
)
from ..services.audit import record_audit
from ..services.oidc import (
    OAUTH_COOKIE,
    OIDCClient,
    OIDCClientError,
    OIDCConfigError,
    OIDCError,
    VerifiedIdToken,
    build_authorize_url,
    clear_oauth_cookie,
    create_oauth_cookie,
    generate_pkce_pair,
    get_oidc_client,
    peek_cookie_return_to,
    sanitize_return_to,
    set_oauth_cookie,
    verify_oauth_cookie,
)
from ..timeutil import utcnow

logger = logging.getLogger("emc_api.auth")

router = APIRouter(prefix="/auth", tags=["auth"])


def _render_auth_error_page(
    *,
    status_code: int,
    title: str,
    message: str,
    return_to: str,
    settings: Settings,
) -> HTMLResponse:
    safe_return_to = sanitize_return_to(return_to)
    retry_href = f"/auth/login?{urllib.parse.urlencode({'return_to': safe_return_to})}"
    escaped_title = html.escape(title)
    escaped_message = html.escape(message)
    escaped_retry = html.escape(retry_href, quote=True)

    issuer = settings.oidc_issuer.strip().rstrip("/")
    account_links_html = ""
    if issuer:
        forgot_href = html.escape(f"{issuer}/forgot-password", quote=True)
        resend_href = html.escape(f"{issuer}/resend-verification", quote=True)
        account_links_html = (
            '<div class="account-links">'
            "<span>遇到账号问题？</span>"
            f'<a href="{forgot_href}" rel="noopener noreferrer">找回密码</a>'
            '<span class="sep">·</span>'
            f'<a href="{resend_href}" rel="noopener noreferrer">重发验证邮件</a>'
            "</div>"
        )

    body = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escaped_title} · 电商搞钱参谋</title>
<style>
:root {{
  --bg: #0f1b33;
  --panel: #1b2b4f;
  --panel-d: #0a1326;
  --gold: #ffd94a;
  --coral: #ff6b81;
  --ink: #f4f1ea;
  --sub: #9fb4e0;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--bg);
  color: var(--ink);
}}
.card {{
  width: 100%;
  max-width: 460px;
  background: var(--panel);
  border: 3px solid var(--panel-d);
  box-shadow: 0 6px 0 var(--panel-d), inset 0 0 0 2px rgba(244, 241, 234, 0.08);
  padding: 28px 24px;
  text-align: center;
}}
.badge {{
  display: inline-block;
  background: var(--coral);
  color: var(--panel-d);
  font-weight: 700;
  font-size: 12px;
  padding: 4px 10px;
  border: 2px solid var(--panel-d);
  margin-bottom: 14px;
}}
h1 {{
  color: var(--gold);
  font-size: 22px;
  margin-bottom: 12px;
  text-shadow: 2px 2px 0 var(--panel-d);
}}
p {{
  color: var(--sub);
  font-size: 14px;
  line-height: 1.7;
  margin-bottom: 22px;
}}
.actions {{
  display: flex;
  flex-direction: column;
  gap: 12px;
}}
.px-btn {{
  display: inline-block;
  width: 100%;
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  color: var(--panel-d);
  background: var(--gold);
  border: 3px solid var(--panel-d);
  box-shadow: 0 4px 0 var(--panel-d);
  min-height: 44px;
}}
.px-btn.ghost {{
  background: transparent;
  color: var(--ink);
}}
.account-links {{
  margin-top: 20px;
  padding-top: 16px;
  border-top: 2px dashed rgba(159, 180, 224, 0.25);
  font-size: 13px;
  color: var(--sub);
}}
.account-links a {{
  color: var(--gold);
  text-decoration: none;
  margin: 0 4px;
}}
.account-links a:hover {{
  text-decoration: underline;
}}
.account-links .sep {{
  color: var(--sub);
}}
</style>
</head>
<body>
  <main class="card">
    <div class="badge">AUTH NOTICE</div>
    <h1>{escaped_title}</h1>
    <p>{escaped_message}</p>
    <div class="actions">
      <a class="px-btn" href="{escaped_retry}">重新登录</a>
      <a class="px-btn ghost" href="/">返回游戏小镇（继续教学）</a>
    </div>
    {account_links_html}
  </main>
</body>
</html>
"""
    return HTMLResponse(
        content=body,
        status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


def _ensure_oidc_configured(settings: Settings) -> None:
    if not settings.oidc_issuer.strip() or not settings.oidc_client_id.strip():
        raise OIDCConfigError("oidc not configured", reason="oidc_not_configured")


def _upsert_player_and_create_session(
    db: Session,
    verified: VerifiedIdToken,
    settings: Settings,
) -> NewSession:
    def work(s: Session) -> NewSession:
        now = utcnow()
        player = s.scalar(select(Player).where(Player.acos_sub == verified.sub).with_for_update())
        if player is None:
            player = Player(
                id=new_id(PLAYER),
                acos_sub=verified.sub,
                display_name=verified.display_name,
                email=verified.email,
                created_at=now,
                last_login_at=now,
            )
            s.add(player)
            s.flush()
        else:
            player.display_name = verified.display_name
            player.email = verified.email
            player.last_login_at = now
            s.flush()

        new_session = create_session(s, player, settings, now=now)
        record_audit(
            s,
            "auth.login",
            actor_player_id=player.id,
            target_type="player",
            target_id=player.id,
            now=now,
        )
        return new_session

    return with_retry(db, work, retry_if=is_duplicate_key_error)


@router.get("/login", response_model=None)
def login(
    return_to: str | None = None,
    settings: Settings = Depends(get_app_settings),
) -> Response:
    """发起 OIDC 授权码 + PKCE 登录，设置短期签名 `emc_oauth` Cookie 并 302 跳转。"""
    safe_return_to = sanitize_return_to(return_to)
    try:
        _ensure_oidc_configured(settings)
    except OIDCError as exc:
        logger.warning("auth_login_unavailable", extra={"reason": exc.reason})
        return _render_auth_error_page(
            status_code=exc.status_code,
            title=exc.user_title,
            message=exc.user_message,
            return_to=safe_return_to,
            settings=settings,
        )

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    code_verifier, code_challenge = generate_pkce_pair()
    cookie_value, _ = create_oauth_cookie(
        settings,
        state=state,
        nonce=nonce,
        verifier=code_verifier,
        return_to=safe_return_to,
    )
    authorize_url = build_authorize_url(
        settings,
        state=state,
        nonce=nonce,
        code_challenge=code_challenge,
    )
    response = RedirectResponse(
        url=authorize_url,
        status_code=302,
        headers={"Cache-Control": "no-store"},
    )
    set_oauth_cookie(response, cookie_value, settings)
    return response


@router.get("/callback", response_model=None)
def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,  # noqa: ARG001 - 不回显上游描述，仅接收标准参数
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    oidc_client: OIDCClient = Depends(get_oidc_client),
) -> Response:
    """处理 OIDC 回调：校验 state、换取并校验 id_token、创建/更新玩家与服务端会话。"""
    raw_cookie = request.cookies.get(OAUTH_COOKIE)
    fallback_return_to = peek_cookie_return_to(raw_cookie, settings)

    try:
        _ensure_oidc_configured(settings)
        if error is not None:
            raise OIDCClientError(
                "upstream oauth error",
                reason="upstream_oauth_error",
                user_title="登录未完成",
                user_message="授权已取消或未通过验证，您可以点击下方按钮重新登录。",
            )
        pending = verify_oauth_cookie(raw_cookie, expected_state=state, settings=settings)
        fallback_return_to = pending.return_to
        if not isinstance(code, str) or not code.strip():
            raise OIDCClientError("missing authorization code", reason="missing_code")

        verified = oidc_client.authenticate_code(
            settings,
            code=code.strip(),
            code_verifier=pending.verifier,
            expected_nonce=pending.nonce,
        )
        new_session = _upsert_player_and_create_session(db, verified, settings)
    except OIDCError as exc:
        logger.warning(
            "auth_callback_failed",
            extra={"reason": exc.reason, "status_code": exc.status_code},
        )
        err_resp = _render_auth_error_page(
            status_code=exc.status_code,
            title=exc.user_title,
            message=exc.user_message,
            return_to=fallback_return_to,
            settings=settings,
        )
        clear_oauth_cookie(err_resp, settings)
        return err_resp

    redirect_resp = RedirectResponse(
        url=pending.return_to,
        status_code=303,
        headers={"Cache-Control": "no-store"},
    )
    clear_oauth_cookie(redirect_resp, settings)
    set_session_cookie(redirect_resp, new_session, settings)
    return redirect_resp


@router.post("/logout", status_code=204)
def logout(
    current: CurrentPlayer | None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> Response:
    """吊销当前会话并清除 Cookie（需 CSRF，返回 204）。"""
    assert current is not None

    def work(s: Session) -> None:
        now = utcnow()
        revoke_session(s, current.session_id_hash, now=now)
        record_audit(
            s,
            "auth.logout",
            actor_player_id=current.id,
            target_type="player",
            target_id=current.id,
            now=now,
        )

    with_retry(db, work)
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    clear_session_cookie(response, settings)
    return response
