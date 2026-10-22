"""浮岛版账号前端：同源接口替身验证，不代表真实 OIDC 授权。"""
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import expect

from conftest import shots_dir
from mock_server import CSRF_TOKEN


def goto(h, path="/"):
    h.page.goto(h.base + path)
    h.page.wait_for_function("window.EmcSession && ['ready','unavailable'].includes(EmcSession.status())")
    return h.page


def dialog(page):
    return page.locator("#emcLoginPrompt .emc-dialog")


def no_auth_navigation(h):
    return not [u for _, u in h.requests if urlsplit(u).path.startswith("/auth/")]


def test_guest_can_play_without_login(open_page):
    h = open_page()
    page = goto(h)
    page.locator("#continueButton").click()
    expect(page.locator("#drawer")).to_be_visible()
    assert page.evaluate("JSON.parse(render_game_to_text()).mode") == "business_journey"
    assert no_auth_navigation(h)
    assert not h.urls("/api/artifacts")
    assert not h.urls("/api/verifications")


@pytest.mark.parametrize("panel", ["settings", "inventory", "quests"])
def test_login_returns_to_current_panel(open_page, panel):
    h = open_page()
    page = goto(h)
    page.locator('[data-panel="' + panel + '"]').click()
    # Settings and mission navigation are modal. Use an accessible login entry
    # inside each dialog rather than clicking a blocked topbar control.
    login = (
        page.locator("#emcLoginBtn")
        if panel == "inventory"
        else page.locator('[data-account-action="login"]')
    )
    expect(login).to_be_visible()
    login.click()
    expect(page.locator("#confirmPartnerName")).to_be_visible()
    page.locator("#partnerNameInput").fill("小满")
    page.locator("#confirmPartnerName").click()
    page.wait_for_function("window.EmcSession?.isLoggedIn()")
    assert page.evaluate("JSON.parse(render_game_to_text()).panel") == ("missions" if panel == "quests" else panel)
    expect(page.locator("#emcLogoutBtn")).to_be_visible()
    assert not h.urls("/api/artifacts")
    assert not h.urls("/api/verifications")


def test_logout_keeps_tutorial_and_uses_csrf(open_page, state):
    h = open_page(session=True)
    page = goto(h)
    page.locator('[data-panel="settings"]').click()
    page.locator("#shopNameInput").fill("存档保留测试")
    page.locator("#saveName").click()
    saved = page.evaluate("localStorage.getItem(EmcTutorialSave.KEY)")
    page.locator('[data-account-action="logout"]').click()
    expect(page.locator("#emcLoginBtn")).to_be_visible()
    assert page.evaluate("localStorage.getItem(EmcTutorialSave.KEY)") == saved
    calls = [x for x in state.calls if x["path"] == "/auth/logout"]
    assert len(calls) == 1 and calls[0]["csrf"] == CSRF_TOKEN
    assert calls[0]["csrf_ok"] and calls[0]["origin"] == h.base
    assert page.evaluate("document.cookie") == ""
    assert not page.evaluate("[...Object.keys(localStorage),...Object.keys(sessionStorage)].some(k=>/token|session|csrf/i.test(k))")


def test_gated_login_can_name_partner_without_inert_overlay(open_page):
    h = open_page()
    page = goto(h)
    page.evaluate("EmcSession.requireLogin('真实经营')")
    expect(dialog(page)).to_be_visible()
    page.locator("#emcPromptPrimary").click()
    expect(dialog(page)).to_be_hidden()
    expect(page.locator("#confirmPartnerName")).to_be_visible()
    assert page.locator(".game-shell").get_attribute("inert") is None
    page.locator("#partnerNameInput").fill("小麦")
    page.locator("#confirmPartnerName").click()
    page.wait_for_function("window.EmcSession?.isLoggedIn()")
    assert page.evaluate("JSON.parse(render_game_to_text()).companion_name") == "小麦"
    assert not h.urls("/api/artifacts")


@pytest.mark.parametrize("action", ["真实经营", "生成正式选品单", "提交认证"])
def test_restricted_action_interface_has_accessible_prompt(open_page, action):
    h = open_page()
    page = goto(h)
    page.locator('[data-panel="settings"]').click()
    page.evaluate("label=>EmcSession.requireLogin(label)", action)
    expect(dialog(page)).to_be_visible()
    assert action in page.locator("#emcPromptBody").inner_text()
    assert page.locator(".game-shell").get_attribute("inert") == ""
    page.keyboard.press("Tab")
    assert page.locator("#emcPromptClose").evaluate("e=>e===document.activeElement")
    page.keyboard.press("Escape")
    expect(dialog(page)).to_be_hidden()
    expect(page.locator("#drawer")).to_be_visible()
    assert page.locator(".game-shell").get_attribute("inert") is None


def test_backend_unavailable_does_not_block_teaching(open_page, state):
    state.me_status = 500
    h = open_page()
    page = goto(h)
    page.locator("#continueButton").click()
    expect(page.locator("#drawer")).to_be_visible()
    # Welcome letter is modal; close it before using the header login button.
    page.locator("#closePanel").click()
    page.locator("#emcLoginBtn").click()
    expect(page.locator("#emcPromptTitle")).to_have_text("登录服务暂时不可用")
    page.locator("#emcPromptPrimary").click()
    expect(page.locator("#emcPromptBody")).to_contain_text("仍然")
    assert no_auth_navigation(h)
    state.me_status = 200
    page.locator("#emcPromptPrimary").click()
    expect(page.locator("#emcPromptTitle")).to_have_text("需要先登录")


@pytest.mark.parametrize("width", [320, 390, 1440])
@pytest.mark.parametrize("session", [False, True])
def test_responsive_account_header(open_page, width, session):
    h = open_page(width=width, height=844, session=session)
    page = goto(h)
    bounds = page.locator(".brand,.top-controls").evaluate_all("es=>es.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}})")
    assert bounds[0]["right"] <= bounds[1]["left"]
    assert bounds[1]["right"] <= width
    page.locator('[data-panel="settings"]').click()
    expect(page.locator(".account-settings")).to_be_visible()
    assert "当前浏览器" in page.locator(".account-settings").inner_text()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(shots_dir() / f"account-{width}-{session}.png"))


def test_unknown_route_is_ignored(open_page):
    h = open_page()
    page = goto(h, "/#view=not-a-page")
    assert page.evaluate("JSON.parse(render_game_to_text()).panel") is None
    expect(page.locator("#emcLoginBtn")).to_be_visible()

def test_display_name_is_rendered_as_text(open_page, state):
    state.display_name = '<img src=x onerror="window.__xss=1">'
    h = open_page(session=True)
    page = goto(h)
    assert page.evaluate("window.__xss") is None
    assert page.locator(".emc-acct-name img").count() == 0

def test_api_wrapper_headers_and_error_envelope(open_page, state):
    h = open_page(session=True)
    page = goto(h)
    ok = page.evaluate("EmcApi.post('/api/projects', {name: 'x'}, {idempotencyKey: 'key-1'})")
    assert ok["id"] == "prj_mock0001"
    call = [c for c in state.calls if c["path"] == "/api/projects" and c["method"] == "POST"][0]
    assert call["csrf"] == CSRF_TOKEN and call["idempotency_key"] == "key-1"
    assert call["content_type"] == "application/json"

    bad = page.evaluate("""fetch('/api/nope').then(() => null)""")
    err = page.evaluate("""EmcApi.get('/api/nope').then(() => null, e => ({
        name: e.name, status: e.status, code: e.code, requestId: e.requestId, isErr: e instanceof EmcApi.EmcApiError}))""")
    assert err["name"] == "EmcApiError" and err["status"] == 404 and err["code"] == "not_found"
    assert err["requestId"].startswith("req_") and err["isErr"] is True

    rejected = page.evaluate("EmcApi.get('//evil.example/x').then(() => null, e => e.code)")
    assert rejected == "invalid_path"
    assert not h.foreign

def test_401_clears_session_and_updates_ui(open_page, state):
    h = open_page(session=True)
    page = goto(h)
    assert page.locator("#emcLogoutBtn").is_visible()
    state.sessions.clear()  # 服务端会话过期
    code = page.evaluate("EmcApi.get('/api/projects').then(() => null, e => [e.code, e.needsLogin])")
    assert code == ["unauthenticated", True]
    page.wait_for_function("window.EmcSession && !EmcSession.isLoggedIn()")
    assert page.locator("#emcLoginBtn").is_visible()
    assert page.locator("#toast").is_visible()

@pytest.mark.parametrize("evil", ["//evil.example", "/\\evil.example", "https://evil.example/", "javascript:alert(1)"])
def test_open_redirect_never_leaves_origin(open_page, evil):
    h = open_page()
    page = goto(h)
    url = page.evaluate("(p) => EmcSession.loginUrl(p)", evil)
    assert url.startswith("/auth/login?return_to=")
    # 非法 return_to 回退为当前位置（本页路径），不携带恶意目标
    assert "evil" not in url and "return_to=%2F" in url
    page.evaluate("(p) => EmcSession.login(p)", evil)
    page.locator("#confirmPartnerName").click()
    page.wait_for_url(lambda u: u.startswith(h.base))
    page.wait_for_function("window.EmcSession && EmcSession.isLoggedIn()")
    assert page.url.startswith(h.base)
    assert not h.foreign

@pytest.mark.parametrize("evil", ["//evil.example", "/\\evil.example"])
def test_server_side_rejects_non_relative_return_to(open_page, evil):
    h = open_page()
    from urllib.parse import quote
    page = goto(h, "/auth/login?return_to=" + quote(evil, safe=""))
    page.wait_for_function("window.EmcSession && EmcSession.status() !== 'loading'")
    assert urlsplit(page.url).netloc == urlsplit(h.base).netloc
    assert urlsplit(page.url).path == "/"
    assert not h.foreign

def test_safe_return_to_unit(open_page):
    h = open_page()
    page = goto(h)
    cases = page.evaluate("""['/', '/a?b=1#c', '//x', '/\\\\x', 'http://x', 'x', '', null, '/a\\nb']
        .map(p => EmcSession.safeReturnTo(p))""")
    assert cases == ["/", "/a?b=1#c", None, None, None, None, None, None, None]


def test_existing_formal_component_contract_is_preserved(open_page, state):
    """旧工作台不挂入游戏；独立夹具继续验证朋友的正式业务模块。"""
    state.roles = ["player", "reviewer"]
    h = open_page(session=True)
    page = goto(h)
    assert page.locator("#emcRealWorkbench").count() == 0
    page.evaluate("""() => {
        const node=document.createElement('div');node.id='emcRealWorkbench';
        node.style.cssText='position:fixed;inset:0;z-index:500;overflow:auto;background:white;padding:20px';
        document.body.append(node);
    }""")
    page.add_script_tag(url=h.base + "/js/emc-formal-ui.js")
    page.evaluate("EmcFormalUI.start()")
    # 3. 打开真实经营内嵌工作台（审核员可见 /admin/ 入口）
    page.evaluate("EmcFormalUI.openWorkbench('真实经营')")
    wb = page.locator("#emcRealWorkbench")
    assert wb.is_visible()
    assert page.locator("#emcWbAdminLink").get_attribute("href") == "/admin/"

    # 4. 从教学模拟复制为正式草稿：显示「草稿」+「来自教学模拟」
    page.locator("#emcWbCopyTutorialBtn").click()
    page.wait_for_function("document.querySelectorAll('#emcWbList [data-artifact-id]').length === 1")
    first_item = page.locator("#emcWbList [data-artifact-id]").first
    assert "草稿" in first_item.inner_text()
    assert "来自教学模拟" in first_item.inner_text()

    # 5. 上传证据并提交认证：状态切换为「待审核」
    page.locator("#emcWbSubmitVerifyBtn").click()
    page.wait_for_function("document.querySelectorAll('#emcWbList [data-verification-id]').length === 1")
    assert page.locator("#emcWbCurrentStatus").inner_text() == "待审核"

    # 6. 审核员驳回后同步：状态显示「已驳回」及驳回原因
    state.verifications[0]["status"] = "rejected"
    state.verifications[0]["reviews"] = [{"decision": "rejected", "reason": "请补充真实物流轨迹截图"}]
    state.artifacts[0]["status"] = "rejected"
    page.locator("#emcWbLoadBtn").click()
    page.wait_for_function("document.getElementById('emcWbCurrentStatus').textContent === '已驳回'")
    assert "请补充真实物流轨迹截图" in page.locator("[data-emc-rejection-reason]").inner_text()

    # 7. 审核员通过后同步：状态显示「正式认证通过」
    state.verifications[0]["status"] = "approved"
    state.artifacts[0]["status"] = "approved"
    page.locator("#emcWbLoadBtn").click()
    page.wait_for_function("document.getElementById('emcWbCurrentStatus').textContent === '正式认证通过'")
    assert page.locator("#emcWbCurrentStatus").inner_text() == "正式认证通过"
    assert not h.foreign


def test_journey_deep_link_still_requires_shop_entry(open_page):
    h = open_page()
    page = goto(h, "/#view=journey")
    expect(page.locator("[data-j-action=begin]")).to_be_visible()
    assert page.evaluate("JSON.parse(render_game_to_text()).journey.view") == "welcome"
    page.locator("[data-j-action=begin]").click()
    expect(page.locator("#journeySetup")).to_be_visible()
    assert page.evaluate("JSON.parse(render_game_to_text()).journey.view") == "setup"
    assert not h.urls("/api/artifacts")
    assert not h.urls("/api/verifications")
