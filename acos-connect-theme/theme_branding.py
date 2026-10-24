"""Server-controlled OAuth client branding.

The theme is chosen only from the signed OAuth pending cookie, and only for
client IDs an operator lists in ACOS_CONNECT_PIXEL_CLIENT_IDS. Clients never
supply HTML/CSS; every dynamic value rendered here is HTML-escaped. Any page
without a matching pending context keeps the default Acos Connect look.
"""
import contextvars
import html
import os
from typing import Any, Callable

from starlette.requests import HTTPConnection
from starlette.responses import HTMLResponse

PIXEL_THEME = "ecommerce-pixel"
DEFAULT_THEME = "default"

# Comma-separated, case-sensitive exact match of operator-approved client IDs.
PIXEL_CLIENT_IDS = frozenset(
    x.strip() for x in os.getenv("ACOS_CONNECT_PIXEL_CLIENT_IDS", "").split(",") if x.strip()
)

_branding_client_id: contextvars.ContextVar[str] = contextvars.ContextVar("branding_client_id", default="")


def theme_for_client(client_id: str) -> str:
    return PIXEL_THEME if client_id and client_id in PIXEL_CLIENT_IDS else DEFAULT_THEME


def current_theme() -> str:
    return theme_for_client(_branding_client_id.get())


def pixel_active() -> bool:
    return current_theme() == PIXEL_THEME


class BrandingMiddleware:
    """Pure ASGI middleware: binds the pending OAuth client_id for this request.

    `read_cookie` must verify the HMAC signature; tampered or missing cookies
    yield no client and therefore the default theme. The value is cosmetic
    only and is never used for authorization decisions.
    """

    def __init__(self, app, read_cookie: Callable[[str | None], Any], cookie_name: str):
        self.app = app
        self.read_cookie = read_cookie
        self.cookie_name = cookie_name

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        client_id = ""
        try:
            pending = self.read_cookie(HTTPConnection(scope).cookies.get(self.cookie_name))
            if isinstance(pending, dict):
                client_id = str(pending.get("client_id") or "")
        except Exception:
            client_id = ""
        marker = _branding_client_id.set(client_id)
        try:
            await self.app(scope, receive, send)
        finally:
            _branding_client_id.reset(marker)


_CSS = """
:root{--bg:#0f1b33;--panel:#1b2b4f;--panel-d:#0a1326;--gold:#ffd94a;--mint:#38d9a9;--coral:#ff6b81;--ink:#f4f1ea;--sub:#a9bde6;--edge:#5a6c96}
*{box-sizing:border-box}html{min-height:100%;background:#0f1b33}body{min-height:100%;min-height:100dvh}
body{margin:0;background:radial-gradient(ellipse at 50% 0%,#22365e 0%,#0f1b33 65%);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.16;background-image:linear-gradient(#5b8def 1px,transparent 1px),linear-gradient(90deg,#5b8def 1px,transparent 1px);background-size:28px 28px}
.shell{min-height:100dvh;display:grid;place-items:center;padding:28px 16px 45px;position:relative}
.wrap{width:100%;max-width:430px;min-width:0}
.panel{width:100%;background:var(--panel);border:3px solid var(--panel-d);box-shadow:0 8px 0 var(--panel-d),inset 0 0 0 2px #31456b;padding:clamp(20px,5vw,36px)}
.badge{display:block;width:max-content;max-width:100%;margin:0 auto 22px;padding:4px 12px;border:2px solid var(--gold);color:var(--gold);font:11px/1.4 ui-monospace,monospace}
.brand{color:var(--gold);font-weight:900;font-size:clamp(22px,5vw,30px);text-shadow:3px 3px #7a4d00;line-height:1.4;text-align:center;letter-spacing:1px}
h1{font-size:18px;margin:16px 0 6px;text-align:center}.sub{text-align:center;color:var(--sub);font-size:13px;margin:0 0 20px;text-wrap:balance}
p{margin:10px 0}.msg{text-align:center}
label{display:block;font-weight:700;margin:14px 0 5px}
input{display:block;width:100%;background:var(--panel-d);border:2px solid var(--edge);color:var(--ink);border-radius:0;padding:12px;font-size:16px;min-height:48px;outline:none}
input:focus-visible{border-color:var(--gold);box-shadow:0 0 0 2px #b8860b}
button,.btn{display:block;width:100%;min-height:48px;margin-top:22px;background:var(--gold);border:3px solid var(--panel-d);box-shadow:0 5px 0 var(--panel-d);color:var(--panel-d);font-weight:900;font-size:15px;cursor:pointer;text-align:center;padding:10px;text-decoration:none;font-family:inherit}
button:active,.btn:active{transform:translateY(3px);box-shadow:0 2px 0 var(--panel-d)}button:disabled{opacity:.6;cursor:wait}
button.ghost,.btn.ghost{background:transparent;color:var(--ink);border:2px solid var(--edge);box-shadow:none;margin-top:12px}
form{margin:0}
.links{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:24px}
.links.center{justify-content:center;flex-direction:column;align-items:center}
a{color:var(--mint);text-underline-offset:4px}
a:focus-visible,button:focus-visible,.btn:focus-visible{outline:3px solid var(--mint);outline-offset:3px}
.divider{text-align:center;color:var(--sub);margin:24px 0 8px;font-size:12px}
.secondary{display:block;text-align:center;padding:10px;border:2px solid var(--edge);text-decoration:none;color:var(--ink);min-height:44px}
.error{background:#46263c;border:2px solid var(--coral);color:#ffe3e7;padding:10px;margin:12px 0}
.card{background:var(--panel-d);border:2px solid var(--edge);padding:14px;margin:16px 0}
.card .k{color:var(--sub);font-size:12px;display:block}.card .v{font-weight:700;overflow-wrap:anywhere}
.note{font-size:12px;color:var(--sub);margin:10px 0}.footer{text-align:center;color:var(--sub);font-size:11px;margin:18px 0}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}button:active,.btn:active{transform:none}}
"""

# Re-enables a submit button when the page is restored from bfcache and shows a
# busy label while the form is submitting. Labels come from data attributes.
_SUBMIT_SCRIPT = """<script>(function(){document.querySelectorAll('form[data-busy]').forEach(function(f){var b=f.querySelector('button[type=submit]');if(!b)return;var idle=b.textContent;f.addEventListener('submit',function(e){if(b.disabled){e.preventDefault();return;}b.disabled=true;b.textContent=f.getAttribute('data-busy');});window.addEventListener('pageshow',function(){b.disabled=false;b.textContent=idle;});});})();</script>"""


def _page(title: str, inner: str, status_code: int = 200) -> HTMLResponse:
    response = HTMLResponse(
        f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · 电商搞钱参谋</title>
<style>{_CSS}</style></head><body><main class="shell"><div class="wrap"><section class="panel" aria-labelledby="page-title">
<div class="badge" aria-hidden="true">★ LEVEL UP · PLAYER ACCOUNT ★</div>
<div class="brand">电商搞钱参谋</div>
{inner}
</section><p class="footer">由 Acos Connect 提供安全账号服务</p></div></main>{_SUBMIT_SCRIPT}</body></html>""",
        status_code=status_code,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _error(error: str) -> str:
    return f'<div class="error" role="alert">{html.escape(error)}</div>' if error else ""


def pixel_auth_page(mode: str, error: str = "") -> HTMLResponse:
    register = mode == "register"
    title = "创建你的商店账号" if register else "欢迎回到搞钱小镇"
    name_field = (
        '<label for="display_name">店主昵称（可选）</label>'
        '<input id="display_name" name="display_name" autocomplete="name" maxlength="80">'
        if register else ""
    )
    hint = '<p class="note" id="pw-hint">至少 8 个字符，注册后请查收邮箱验证邮件。</p>' if register else ""
    inner = f"""<h1 id="page-title">{html.escape(title)}</h1>
<p class="sub">游客可体验全部教学 · 登录后开启正式经营</p>
{_error(error)}
<form action="{"/register" if register else "/login"}" method="post" data-busy="{"正在创建…" if register else "正在登录…"}">
{name_field}
<label for="username">{"邮箱" if register else "邮箱 / 用户名"}</label>
<input id="username" name="username" type="{"email" if register else "text"}" autocomplete="username" required maxlength="254">
<label for="password">密码</label>
<input id="password" name="password" type="password" autocomplete="{"new-password" if register else "current-password"}" required{' minlength="8" aria-describedby="pw-hint"' if register else ""}>
{hint}
<button type="submit">{"创建账号 →" if register else "进入小镇 →"}</button></form>
<div class="links"><a href="{"/login" if register else "/register"}">{"已有账号？返回登录" if register else "还没有账号？创建账号"}</a><a href="/forgot-password">忘记密码？</a></div>
<div class="divider">其他登录方式</div><a class="secondary" href="/login/entra">使用 Microsoft 账号登录</a>
{"" if register else '<p class="note" style="text-align:center"><a href="/resend-verification">没收到验证邮件？</a></p>'}"""
    return _page(title, inner)


def pixel_message_page(title: str, message: str, links: list[tuple[str, str]] | None = None, status_code: int = 200) -> HTMLResponse:
    link_html = "".join(
        f'<a href="{html.escape(href)}">{html.escape(text)}</a>' for href, text in (links or [])
    )
    inner = f"""<h1 id="page-title">{html.escape(title)}</h1>
<p class="msg" {'role="alert"' if status_code >= 400 else 'role="status"'}>{html.escape(message)}</p>
<div class="links center">{link_html}</div>"""
    return _page(title, inner, status_code=status_code)


def pixel_consent_page(client_name: str, email: str) -> HTMLResponse:
    title = "确认进入游戏"
    inner = f"""<h1 id="page-title">{title}</h1>
<p class="sub"><strong>{html.escape(client_name)}</strong> 请求使用你的 Acos Connect 账号</p>
<div class="card"><span class="k">当前已登录账号</span><span class="v">{html.escape(email)}</span></div>
<form method="post" action="/authorize/confirm" data-busy="正在进入…"><button type="submit">用这个账号继续 →</button></form>
<form method="post" action="/authorize/switch"><button class="ghost" type="submit">退出并切换账号</button></form>"""
    return _page(title, inner)


def pixel_email_form_page(kind: str) -> HTMLResponse:
    """`kind` is 'forgot' (POST /forgot-password) or 'resend' (POST /resend-verification)."""
    forgot = kind == "forgot"
    title = "找回密码" if forgot else "重新发送验证邮件"
    intro = "输入注册邮箱，如果账号存在，我们会发送重置链接。" if forgot else "输入注册邮箱，如果账号尚未验证，我们会重新发送验证邮件。"
    inner = f"""<h1 id="page-title">{title}</h1>
<p class="sub">{intro}</p>
<form method="post" action="{"/forgot-password" if forgot else "/resend-verification"}" data-busy="正在发送…">
<label for="username">邮箱</label>
<input id="username" name="username" type="email" autocomplete="username" required maxlength="254">
<button type="submit">{"发送重置链接 →" if forgot else "重新发送 →"}</button></form>
<div class="links center"><a href="/login">返回登录</a></div>"""
    return _page(title, inner)


def pixel_reset_form(token_value: str, error: str = "") -> HTMLResponse:
    title = "设置新密码"
    inner = f"""<h1 id="page-title">{title}</h1>
<p class="sub">重置后旧的登录会话将全部失效。</p>
{_error(error)}
<form method="post" action="/reset-password" data-busy="正在更新…">
<input type="hidden" name="token" value="{html.escape(token_value)}">
<label for="password">新密码</label>
<input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" aria-describedby="pw-hint">
<p class="note" id="pw-hint">至少 8 个字符。</p>
<button type="submit">更新密码 →</button></form>
<div class="links center"><a href="/login">返回登录</a></div>"""
    return _page(title, inner)
