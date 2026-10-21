"""登录入口前端测试（对 mock 后端运行）。"""
from urllib.parse import urlsplit

import pytest

from conftest import shots_dir
from mock_server import CSRF_TOKEN

GATES = ["真实经营", "生成正式选品单", "提交认证"]


def goto(h, path="/"):
    h.page.goto(h.base + path)
    h.page.wait_for_function("window.EmcSession && EmcSession.status() !== 'loading'")
    return h.page


def gate_button(page, label):
    return page.locator(f'[data-emc-gate="{label}"]')


def dialog(page):
    return page.locator("#emcLoginPrompt .emc-dialog")


def no_auth_navigation(h):
    return not [u for _, u in h.requests if urlsplit(u).path.startswith("/auth/")]


# ---------- 游客可玩教学 ----------

def test_guest_can_play_tutorial_without_login(open_page):
    h = open_page()
    page = goto(h)
    assert page.locator("#emcLoginBtn").is_visible()
    assert page.locator("#modeLabel").inner_text() == "游客"

    nodes = page.locator("#questPath .qnode")
    assert nodes.count() == 6

    # L2-L6 现状是锁定提示；L1 进入关卡面板
    for i in range(1, 6):
        nodes.nth(i).click()
        assert page.locator("#toast").is_visible()
        assert not dialog(page).is_visible() if page.locator("#emcLoginPrompt").count() else True
    nodes.nth(0).click()
    assert page.locator("#view-level").is_visible()
    assert page.evaluate("EmcRoute.read().view") == "level"

    for i in range(3):
        page.locator("#taskList .task").nth(i).click()
    page.locator("#verifyBtn").click()
    assert page.locator("#view-town").is_visible()

    page.locator("#tab-verify").click()
    assert page.locator("#view-verify").is_visible()
    page.locator("#tab-copilot").click()
    assert page.locator("#cpPanel.open").is_visible()
    page.locator("#cpInput").fill("破零动销要满足什么条件？")
    page.locator("#cpPanel .cp-input button").click()
    assert page.locator("#cpPanel.open").is_visible()
    assert "破零动销" in page.locator("#cpBody").inner_text()
    page.get_by_role("button", name="关闭 AI 副驾").click()
    assert not page.locator("#cpPanel.open").count()
    assert not page.locator("#cpOverlay.show").count()
    page.locator("#tab-copilot").click()
    page.keyboard.press("Escape")
    assert not page.locator("#cpPanel.open").count()
    page.locator("#tab-copilot").click()
    page.locator("#cpOverlay").click(position={"x": 5, "y": 5})
    assert not page.locator("#cpPanel.open").count()

    assert page.url.startswith(h.base)
    assert no_auth_navigation(h)
    assert page.locator("#emcLoginPrompt").count() == 0 or page.locator("#emcLoginPrompt").is_hidden()


# ---------- 受限操作 ----------

@pytest.mark.parametrize("label", GATES)
def test_gated_action_prompts_then_login_returns_to_town(open_page, state, label):
    h = open_page()
    page = goto(h)
    btn = gate_button(page, label)
    btn.click()

    assert dialog(page).is_visible()
    assert label in page.locator("#emcPromptBody").inner_text()
    assert page.evaluate("document.activeElement.id") == "emcPromptPrimary"
    assert no_auth_navigation(h)

    page.locator("#emcPromptPrimary").click()
    page.wait_for_url(lambda u: urlsplit(u).path == "/" and "gate=" in u)
    page.wait_for_function("window.EmcSession && EmcSession.isLoggedIn()")
    page.wait_for_function("!location.hash.includes('gate=')")

    login_calls = [c for c in state.calls if c["path"] == "/auth/login"]
    assert len(login_calls) == 1
    assert page.locator("#view-town").is_visible()
    assert page.locator("#emcLogoutBtn").is_visible()
    # 回来后不自动执行任何受限操作
    assert not dialog(page).is_visible()
    assert [c for c in state.calls if c["path"] == "/api/projects"] == []


def test_prompt_escape_closes_and_restores_focus(open_page):
    h = open_page()
    page = goto(h)
    btn = gate_button(page, "提交认证")
    btn.focus()
    btn.press("Enter")
    assert dialog(page).is_visible()

    # Tab 焦点不会逃出对话框
    for _ in range(4):
        page.keyboard.press("Tab")
        assert page.evaluate("document.querySelector('.emc-dialog').contains(document.activeElement)")
    page.keyboard.press("Shift+Tab")
    assert page.evaluate("document.querySelector('.emc-dialog').contains(document.activeElement)")

    page.keyboard.press("Escape")
    assert not dialog(page).is_visible()
    assert page.evaluate("document.activeElement.getAttribute('data-emc-gate')") == "提交认证"
    assert page.evaluate("!document.querySelector('.app').hasAttribute('inert')")


def test_continue_teaching_closes_prompt_and_tutorial_still_works(open_page):
    h = open_page()
    page = goto(h)
    gate_button(page, "真实经营").click()
    page.locator("#emcPromptClose").click()
    assert not dialog(page).is_visible()
    page.locator("#questPath .qnode").first.click()
    assert page.locator("#view-level").is_visible()
    page.locator("#taskList .task").first.click()
    assert page.locator("#taskProgTx").inner_text().startswith("1 / 3")
    assert no_auth_navigation(h)


def test_login_from_level_view_returns_to_same_level(open_page, state):
    h = open_page()
    page = goto(h)
    page.locator("#questPath .qnode").first.click()
    assert page.evaluate("EmcRoute.read()") == {"view": "level", "lv": 1, "gate": None}

    page.evaluate("EmcSession.requireLogin(EmcSession.ACTIONS.SUBMIT_VERIFICATION)")
    assert dialog(page).is_visible()
    page.locator("#emcPromptPrimary").click()
    page.wait_for_function("window.EmcSession && EmcSession.isLoggedIn()")

    assert page.locator("#view-level").is_visible()
    assert page.locator("#lvTag").inner_text() == "L1"
    login = [c for c in state.calls if c["path"] == "/auth/login"][0]
    assert "view%3Dlevel" in login["query"] and "lv%3D1" in login["query"]
    page.wait_for_function("!location.hash.includes('gate=')")
    assert "view=level" in page.url and "lv=1" in page.url


def test_header_login_button_returns_to_current_view(open_page):
    h = open_page()
    page = goto(h, "/#view=verify")
    assert page.locator("#view-verify").is_visible()
    page.locator("#emcLoginBtn").click()
    page.wait_for_function("window.EmcSession && EmcSession.isLoggedIn()")
    assert page.locator("#view-verify").is_visible()


def test_url_for_mismatched_level_falls_back_to_town(open_page):
    h = open_page()
    page = goto(h, "/#view=level&lv=3")
    assert page.locator("#view-town").is_visible()


def test_junk_hash_is_ignored(open_page):
    h = open_page()
    page = goto(h, "/#view=%3Cscript%3E&lv=99&gate=%00x")
    assert page.locator("#view-town").is_visible()


# ---------- 已登录 / 退出 ----------

def test_logged_in_indicator_and_logout_sends_csrf(open_page, state):
    h = open_page(session=True)
    page = goto(h)
    assert "店主" in page.locator(".emc-acct-name").inner_text()
    assert page.locator("#modeLabel").inner_text() == "已登录"
    assert page.locator("#guestBanner").is_hidden()
    assert page.locator("#emcLoginBtn").count() == 0

    # 已登录点击受限入口：不弹登录提示
    gate_button(page, "真实经营").click()
    assert page.locator("#emcLoginPrompt").count() == 0 or page.locator("#emcLoginPrompt").is_hidden()

    page.locator("#emcLogoutBtn").click()
    page.wait_for_function("window.EmcSession && !EmcSession.isLoggedIn()")
    assert page.locator("#emcLoginBtn").is_visible()
    assert page.locator("#modeLabel").inner_text() == "游客"

    logout = [c for c in state.calls if c["path"] == "/auth/logout"]
    assert len(logout) == 1
    assert logout[0]["csrf"] == CSRF_TOKEN and logout[0]["csrf_ok"] is True
    assert logout[0]["origin"] == h.base
    assert not state.sessions
    # 令牌不落本地存储
    assert page.evaluate("JSON.stringify([localStorage.length, sessionStorage.length, document.cookie])") == '[0,0,""]'


def test_display_name_is_rendered_as_text(open_page, state):
    state.display_name = '<img src=x onerror="window.__xss=1">'
    h = open_page(session=True)
    page = goto(h)
    assert page.evaluate("window.__xss") is None
    assert page.locator(".emc-acct-name img").count() == 0


# ---------- EmcApi ----------

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


# ---------- 开放重定向 ----------

@pytest.mark.parametrize("evil", ["//evil.example", "/\\evil.example", "https://evil.example/", "javascript:alert(1)"])
def test_open_redirect_never_leaves_origin(open_page, evil):
    h = open_page()
    page = goto(h)
    url = page.evaluate("(p) => EmcSession.loginUrl(p)", evil)
    assert url.startswith("/auth/login?return_to=")
    # 非法 return_to 回退为当前位置（本页路径），不携带恶意目标
    assert "evil" not in url and "return_to=%2F" in url
    page.evaluate("(p) => EmcSession.login(p)", evil)
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


# ---------- /api/me 故障 ----------

def test_me_500_keeps_guest_mode_working(open_page, state):
    state.me_status = 500
    h = open_page()
    page = goto(h)
    assert page.evaluate("EmcSession.status()") == "unavailable"
    assert page.locator("#emcLoginBtn").is_visible()
    assert page.locator("#modeLabel").inner_text() == "游客"

    # 教学照常
    page.locator("#questPath .qnode").first.click()
    for i in range(3):
        page.locator("#taskList .task").nth(i).click()
    page.locator("#verifyBtn").click()
    assert page.locator("#view-town").is_visible()

    # 受限入口：提示登录服务暂不可用，且不跳转
    gate_button(page, "提交认证").click()
    assert dialog(page).is_visible()
    assert "暂时不可用" in page.locator("#emcPromptTitle").inner_text()
    assert page.locator("#emcPromptPrimary").inner_text() == "重试"
    assert no_auth_navigation(h)

    # 仍然故障：继续提示
    page.locator("#emcPromptPrimary").click()
    page.wait_for_function("document.getElementById('emcPromptBody').textContent.includes('仍然')")

    # 恢复后重试：变为正常的登录提示
    state.me_status = 200
    page.locator("#emcPromptPrimary").click()
    page.wait_for_function("document.getElementById('emcPromptPrimary').textContent.includes('登录')")
    assert "需要先登录" in page.locator("#emcPromptTitle").inner_text()


def test_me_network_failure_keeps_guest_mode(open_page):
    h = open_page()
    h.page.route("**/api/me", lambda r: r.abort())
    page = goto(h)
    assert page.evaluate("EmcSession.status()") == "unavailable"
    page.locator("#questPath .qnode").first.click()
    assert page.locator("#view-level").is_visible()
    h.resource_errors.clear()  # abort 产生的 net::ERR_FAILED 日志是预期的


# ---------- 窄屏 ----------

def overflow(page):
    return page.evaluate("""() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
        hud: document.querySelector('.hud').scrollWidth - document.querySelector('.hud').clientWidth,
        dlg: (document.querySelector('.emc-dialog') || {scrollWidth: 0, clientWidth: 0}).scrollWidth
             - (document.querySelector('.emc-dialog') || {scrollWidth: 0, clientWidth: 0}).clientWidth,
    })""")


@pytest.mark.parametrize("width,height", [(320, 640), (390, 844)])
@pytest.mark.parametrize("session", [False, True])
def test_narrow_widths_have_no_horizontal_overflow(open_page, width, height, session):
    h = open_page(width=width, height=height, session=session)
    page = goto(h)
    tag = f"{width}-{'in' if session else 'guest'}"
    out = shots_dir()

    def check(name):
        o = overflow(page)
        assert all(v <= 0 for v in o.values()), f"{name} 横向溢出: {o}"

    check("town")
    page.screenshot(path=str(out / f"town-{tag}.png"))

    page.locator("#questPath .qnode").first.click()
    check("level")
    page.screenshot(path=str(out / f"level-{tag}.png"))
    page.locator("#tab-town").click()

    page.locator("#tab-verify").click()
    check("verify")
    page.locator("#tab-town").click()

    if not session:
        gate_button(page, "提交认证").scroll_into_view_if_needed()
        gate_button(page, "提交认证").click()
        assert dialog(page).is_visible()
        check("dialog")
        box = dialog(page).bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= width
        page.screenshot(path=str(out / f"prompt-{tag}.png"))
        page.keyboard.press("Escape")

    # 所有可交互的新按钮至少 36px 高
    heights = page.evaluate("""[...document.querySelectorAll('.emc-acct button, .emc-real button')].map(b => b.getBoundingClientRect().height)""")
    assert heights and min(heights) >= 36


# ---------- 状态区分与同源真实经营工作台 (#36, #41) ----------

def test_ui_distinguishes_tutorial_vs_formal_statuses(open_page, state):
    state.roles = ["player", "reviewer"]
    h = open_page(session=True)
    page = goto(h)

    # 1. 状态图例始终明确区分 5 种状态
    legend = page.locator("#emcStatusLegend")
    assert legend.is_visible()
    for label in ["教学通关（仅前端本地）", "草稿", "待审核", "正式认证通过", "已驳回"]:
        assert label in legend.inner_text()

    # 2. 教学关卡核验只产生「教学通关（仅前端本地）」，绝不产生正式认证通过
    page.locator("#questPath .qnode").first.click()
    for i in range(3):
        page.locator("#taskList .task").nth(i).click()
    page.locator("#verifyBtn").click()
    page.locator("#tab-level").click()
    res_text = page.locator("#resultCard").inner_text()
    assert "教学通关（仅前端本地）" in res_text
    assert "不代表正式认证通过" in res_text
    page.locator("#tab-town").click()

    # 3. 打开真实经营内嵌工作台（审核员可见 /admin/ 入口）
    gate_button(page, "真实经营").click()
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
