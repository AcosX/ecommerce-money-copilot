"""主题渲染回归，不连接真实认证服务。"""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("login_theme_render", ROOT / "theme_branding.py")
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)


@pytest.mark.parametrize("mode,action,complete", [("login", "/login", "current-password"), ("register", "/register", "new-password")])
def test_form_contract(mode, action, complete):
    response = theme.pixel_auth_page(mode)
    markup = response.body.decode()
    assert f'action="{action}" method="post"' in markup
    assert 'name="username"' in markup
    assert 'name="password"' in markup
    assert f'autocomplete="{complete}"' in markup
    assert 'href="/login/entra"' in markup
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert markup.count('<div class="password-field">') == 1
    assert 'data-password-toggle' in markup
    if mode == "register":
        assert 'minlength="8"' in markup
        assert 'name="display_name"' in markup


def test_escape_dynamic_content():
    payload = '<script>alert("x")</script>'
    assert payload not in theme.pixel_auth_page("login", payload).body.decode()
    assert payload not in theme.pixel_consent_page(payload, payload).body.decode()
    assert payload not in theme.pixel_message_page(payload, payload).body.decode()
    assert payload not in theme.pixel_reset_form(payload).body.decode()


@pytest.mark.parametrize("kind,action", [("forgot", "/forgot-password"), ("resend", "/resend-verification")])
def test_email_forms(kind, action):
    body = theme.pixel_email_form_page(kind).body.decode()
    assert f'action="{action}"' in body
    assert 'type="email"' in body


def test_consent_and_reset_contract():
    body = theme.pixel_consent_page("游戏", "a@example.com").body.decode()
    assert 'action="/authorize/confirm"' in body
    assert 'action="/authorize/switch"' in body
    body = theme.pixel_reset_form('token"<x>').body.decode()
    assert 'action="/reset-password"' in body
    assert 'name="token" value="token&quot;&lt;x&gt;"' in body


def test_assets_are_self_contained_and_styles_match():
    assert theme._CSS.strip() == (ROOT / "ecommerce-pixel.css").read_text(encoding="utf-8").strip()
    for name in ("login-island.webp", "login-sky.webp"):
        assert (ROOT / "assets" / name).read_bytes().startswith(b"RIFF")
        assert theme._asset_data(name).startswith("data:image/webp;base64,")
    with pytest.raises(ValueError):
        theme._asset_data("../secret")
    markup = theme.pixel_auth_page("login").body.decode()
    assert 'assets/login-sky.webp' not in markup
    assert 'height:auto' in markup
    assert 'prefers-reduced-motion' in markup
