"""Server-controlled OAuth client branding.

The theme is chosen only from the signed OAuth pending cookie, and only for
client IDs an operator lists in ACOS_CONNECT_PIXEL_CLIENT_IDS. Clients never
supply HTML/CSS; every dynamic value rendered here is HTML-escaped. Any page
without a matching pending context keeps the default Acos Connect look.
"""
import base64
import contextvars
import html
import os
from typing import Any, Callable
from pathlib import Path
from functools import lru_cache

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
/* 与浮岛游戏共用的天空、奶油纸张与像素边框。 */
:root{--ink:#20294c;--sub:#596980;--paper:#fff9e9;--gold:#ffe548;--teal:#277b80;--edge:#273551}
*{box-sizing:border-box}html{min-height:100%;background:#d7e9f5}body{margin:0;min-height:100svh;color:var(--ink);font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#d7e9f5 url("assets/login-sky.webp") center/cover fixed}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:radial-gradient(#20345112 .7px,transparent .7px);background-size:14px 14px;z-index:-1}
a{color:var(--teal);text-underline-offset:3px}button,input{font:inherit}button,a,input{touch-action:manipulation}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #b88529;outline-offset:4px}
.site-header{max-width:1536px;margin:auto;padding:28px 40px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{color:var(--gold);font-size:clamp(23px,2.5vw,34px);font-weight:950;letter-spacing:1px;text-decoration:none;-webkit-text-stroke:1px var(--ink);paint-order:stroke fill;text-shadow:2px 3px 0 var(--ink);line-height:1.4}.brand i{font-size:20px;font-style:normal;vertical-align:top;margin-left:4px}.back-link{display:inline-flex;align-items:center;gap:7px;color:var(--ink);font-size:13px;font-weight:750;text-decoration:none;background:var(--paper);border:2px solid var(--edge);padding:7px 13px;box-shadow:3px 3px var(--edge);white-space:nowrap}
.shell{max-width:1440px;margin:auto;min-height:calc(100svh - 108px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(380px,.85fr);align-items:center;gap:36px;padding:12px 50px 46px}.scene{margin:0;min-width:0;align-self:center;position:relative;animation:arrive .5s ease-out}.scene img{display:block;width:100%;height:auto;max-height:min(700px,calc(100svh - 200px));object-fit:contain;filter:drop-shadow(0 16px 16px #3f627927)}.scene figcaption{text-align:center;font-size:13px;font-weight:650;letter-spacing:.5px;color:#31455d;margin-top:8px}
.wrap{width:100%;min-width:0;max-width:510px;justify-self:end;animation:arrive .45s ease-out}.panel{position:relative;width:100%;background:var(--paper);border:3px solid var(--edge);padding:40px 36px 26px;box-shadow:5px 6px 0 #263451;clip-path:polygon(12px 0,calc(100% - 12px) 0,calc(100% - 12px) 5px,100% 5px,100% calc(100% - 12px),calc(100% - 5px) calc(100% - 12px),calc(100% - 5px) 100%,12px 100%,12px calc(100% - 5px),0 calc(100% - 5px),0 12px,5px 12px,5px 0)}.panel:before{content:"";position:absolute;inset:10px;border:1px solid #d7bd734a;pointer-events:none}.badge{position:relative;display:inline-flex;align-items:center;gap:7px;background:#a5d9d9;border:2px solid var(--edge);padding:5px 12px;font-size:12px;font-weight:750;margin:0 0 24px;box-shadow:2px 2px #263451}.badge:before{content:"♧";font-size:16px}.postage{position:absolute;right:27px;top:28px;width:66px;height:54px;opacity:.45;pointer-events:none}.postage svg{width:100%;height:100%;fill:none;stroke:#687d88;stroke-width:1.7}
h1{font-size:clamp(23px,2.1vw,29px);line-height:1.4;margin:0 0 8px;letter-spacing:.2px}.sub{font-size:13px;color:var(--sub);margin:0 0 24px}form{margin:0}label{display:block;font-size:13px;font-weight:750;margin:17px 0 7px}input{display:block;width:100%;min-height:46px;padding:10px 12px;background:#fdfaf0;border:1.5px solid var(--edge);border-radius:5px;font-size:16px;color:var(--ink)}input:hover{background:#fffdf6}input:focus{background:#fffef9}.password-field{position:relative}.password-field input{padding-right:48px}.password-toggle{position:absolute;right:2px;top:2px;width:42px;height:42px;min-height:0;margin:0;padding:10px;background:transparent;border:0;box-shadow:none;color:var(--sub);display:grid;place-items:center}.password-toggle svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8}.form-help{text-align:right;margin:8px 0 16px;font-size:12px}
button,.btn{display:block;cursor:pointer;width:100%;min-height:48px;padding:10px 14px;margin-top:20px;background:var(--gold);color:var(--ink);border:2px solid var(--edge);border-radius:3px;box-shadow:2px 3px var(--edge);font-size:15px;font-weight:800;text-align:center;text-decoration:none;transition:transform .15s,background .15s}button:hover,.btn:hover{background:#ffdc3c}button:active,.btn:active{transform:translateY(2px);box-shadow:1px 1px var(--edge)}button:disabled{opacity:.65;cursor:wait}.password-toggle{margin:0;background:transparent;box-shadow:none}.password-toggle:hover{background:#f1ead9}.ghost,.btn.ghost{background:transparent;color:var(--ink);box-shadow:none;border:1px solid #9aa7ae}
.links{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:19px;font-size:12px}.links.center{flex-direction:column;align-items:center}.divider{display:flex;align-items:center;gap:12px;margin:24px 0 15px;color:var(--sub);font-size:12px}.divider:before,.divider:after{content:"";height:1px;background:#a2adb344;flex:1}.secondary{display:flex;align-items:center;justify-content:center;gap:10px;min-height:46px;border:1.5px solid var(--edge);border-radius:4px;color:var(--ink);font-size:13px;font-weight:650;text-decoration:none;background:#fffdf340}.ms-icon{display:grid;grid-template-columns:repeat(2,9px);gap:2px}.ms-icon i{width:9px;height:9px;background:#f35325}.ms-icon i:nth-child(2){background:#81bc06}.ms-icon i:nth-child(3){background:#05a6f0}.ms-icon i:nth-child(4){background:#ffba08}
.note{font-size:11px;line-height:1.7;color:var(--sub);margin:12px 0}.resend{text-align:center;margin:14px 0 0}.footer{text-align:center;font-size:10px;line-height:1.7;color:var(--sub);margin:22px 0 0}.error{background:#ffefdf;border:1px solid #b8674d;border-left:3px solid #b8674d;color:#853d2b;padding:10px 12px;margin:14px 0;font-size:12px;overflow-wrap:anywhere}.card{padding:14px;border:1px dashed #80a5a3;background:#91c2b51a;margin:20px 0}.card .k{display:block;color:var(--sub);font-size:12px}.card .v{font-weight:750;overflow-wrap:anywhere}.msg{font-size:14px;line-height:1.9;overflow-wrap:anywhere}
@keyframes arrive{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media(min-width:1100px) and (max-height:850px){.site-header{padding-block:18px}.shell{padding-top:0;gap:30px}.panel{padding:27px 32px 22px}.badge{margin-bottom:18px}.sub{margin-bottom:16px}label{margin-top:13px}.divider{margin-top:18px}.footer{margin-top:16px}}
@media(max-width:1000px){.site-header{padding:22px 28px}.shell{padding:6px 28px 36px;gap:22px;grid-template-columns:minmax(0,1fr) minmax(340px,1fr)}.panel{padding:30px 26px 24px}.scene figcaption{font-size:11px}.postage{width:52px;right:22px}}
@media(max-width:740px){body{background-attachment:scroll}.site-header{padding:18px 18px 10px;gap:10px}.brand{font-size:22px}.back-link{font-size:11px;padding:6px 9px}.shell{min-height:0;grid-template-columns:minmax(0,1fr);gap:0;padding:18px 16px 30px}.scene{display:none}.scene img{max-height:160px}.scene figcaption{display:none}.wrap{max-width:470px;justify-self:center}.panel{padding:27px 26px 24px}.badge{margin-bottom:20px;font-size:11px}.postage{top:20px;right:22px;width:54px}h1{font-size:24px}.sub{margin-bottom:18px}.footer{margin-top:20px}}
@media(max-width:370px){.site-header{padding:14px 12px 10px}.brand{font-size:19px}.back-link{font-size:10px;padding:5px 7px}.shell{padding:0 10px 24px}.scene{width:120px;margin-bottom:-6px}.panel{padding:24px 22px 22px}.badge{font-size:10px}.postage{width:44px;right:18px}h1{font-size:22px}}
@media(max-width:740px) and (max-height:700px){.scene{display:none}.shell{padding-top:14px}.panel{padding-top:24px}.badge{margin-bottom:17px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
"""

# Re-enables a submit button when the page is restored from bfcache and shows a
# busy label while the form is submitting. Labels come from data attributes.
_SUBMIT_SCRIPT = """<script>(function(){document.querySelectorAll('form[data-busy]').forEach(function(f){var b=f.querySelector('button[type=submit]');if(!b)return;var idle=b.textContent;f.addEventListener('submit',function(e){if(b.disabled){e.preventDefault();return;}b.disabled=true;b.textContent=f.getAttribute('data-busy');});window.addEventListener('pageshow',function(){b.disabled=false;b.textContent=idle;});});document.querySelectorAll('[data-password-toggle]').forEach(function(b){b.addEventListener('click',function(){var i=document.getElementById('password'),show=i.type==='password';i.type=show?'text':'password';b.setAttribute('aria-pressed',String(show));b.setAttribute('aria-label',show?'隐藏密码':'显示密码');});});})();</script>"""


@lru_cache(maxsize=2)
def _asset_data(name: str) -> str:
    """仅嵌入随主题发布的固定素材，不要求认证服务新增公开静态路由。"""
    if name not in {"login-island.webp", "login-sky.webp"}:
        raise ValueError("unknown theme asset")
    path = Path(__file__).resolve().parent / "assets" / name
    if not path.is_file():
        return ""
    return "data:image/webp;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _page(title: str, inner: str, status_code: int = 200) -> HTMLResponse:
    css = _CSS.replace("assets/login-sky.webp", _asset_data("login-sky.webp"))
    island = _asset_data("login-island.webp")
    game_url = html.escape(os.getenv("ACOS_CONNECT_GAME_URL", "https://money.acosx.top/"), quote=True)
    response = HTMLResponse(
        f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{html.escape(title)} · 电商搞钱参谋</title>
<style>{css}</style></head><body>
<header class="site-header"><a class="brand" href="{game_url}">电商搞钱参谋<i aria-hidden="true">✦</i></a><a class="back-link" href="{game_url}"><span aria-hidden="true">←</span> 返回小岛</a></header>
<main class="shell"><figure class="scene" aria-hidden="true"><img src="{island}" alt="" width="1000" height="1000" fetchpriority="high"><figcaption>从一间小店开始，学会经营每一步。</figcaption></figure>
<div class="wrap"><section class="panel" aria-labelledby="page-title">
<div class="badge">店主通行证</div>
<div class="postage" aria-hidden="true"><svg viewBox="0 0 80 60"><path d="M36 7h36v45H36zM42 16h24v25H42zM47 41V29h14v12M44 26l10-8 10 8M2 20c11-8 17 8 28 0M2 29c11-8 17 8 28 0M2 38c11-8 17 8 28 0"/></svg></div>
{inner}
<p class="footer">由 Acos Connect 提供安全账号服务</p>
</section></div></main>{_SUBMIT_SCRIPT}</body></html>""",
        status_code=status_code,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _error(error: str) -> str:
    return f'<div class="error" role="alert">{html.escape(error)}</div>' if error else ""


def pixel_auth_page(mode: str, error: str = "") -> HTMLResponse:
    register = mode == "register"
    title = "创建你的商店账号" if register else "欢迎回到你的小店"
    name_field = (
        '<label for="display_name">店主昵称（可选）</label>'
        '<input id="display_name" name="display_name" autocomplete="name" maxlength="80">'
        if register else ""
    )
    hint = '<p class="note" id="pw-hint">至少 8 个字符，注册后请查收邮箱验证邮件。</p>' if register else ""
    inner = f"""<h1 id="page-title">{html.escape(title)}</h1>
<p class="sub">和小商一起，把生意做起来。</p>
{_error(error)}
<form action="{"/register" if register else "/login"}" method="post" data-busy="{"正在创建…" if register else "正在登录…"}">
{name_field}
<label for="username">{"邮箱" if register else "邮箱 / 用户名"}</label>
<input id="username" name="username" type="{"email" if register else "text"}" autocomplete="username" required maxlength="254">
<label for="password">密码</label>
<div class="password-field"><input id="password" name="password" type="password" autocomplete="{"new-password" if register else "current-password"}" required{' minlength="8" aria-describedby="pw-hint"' if register else ""}>
<button class="password-toggle" type="button" aria-label="显示密码" aria-pressed="false" data-password-toggle><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
{hint}
<p class="form-help"><a href="/forgot-password">忘记密码？</a></p>
<button type="submit">{"创建账号 →" if register else "进入小店 →"}</button></form>
<div class="links"><a href="{"/login" if register else "/register"}">{"已有账号？返回登录" if register else "还没有账号？创建账号"}</a></div>
<div class="divider">其他登录方式</div><a class="secondary" href="/login/entra"><span class="ms-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>使用 Microsoft 账号登录</a>
{"" if register else '<p class="note resend"><a href="/resend-verification">没收到验证邮件？</a></p>'}"""
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
