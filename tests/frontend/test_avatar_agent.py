"""右下角 3D 具身数字人「向导·小商」与 Agent Runtime 前端端到端测试 (#62)。"""
from conftest import shots_dir


def goto(h, path="/"):
    h.page.goto(h.base + path)
    h.page.wait_for_function("window.EmcSession && EmcSession.status() !== 'loading'")
    return h.page


def test_bottom_right_3d_digital_human_stage_and_controls(open_page, state):
    h = open_page(width=1280, height=820, session=True)
    page = goto(h)

    # 1. 右下角 3D 具身数字人舞台存在且位于页面右下角
    stage = page.locator("#emcAvatarStage")
    holo = page.locator("#emcAvatarHolo")
    canvas = page.locator("#emcAvatarCanvas")
    assert stage.is_visible()
    assert holo.is_visible()
    assert canvas.is_visible()

    box = stage.bounding_box()
    assert box["x"] > 1280 * 0.65
    assert box["y"] > 820 * 0.45
    assert page.locator("#emcAvatarPresetBadge").inner_text() == "小商·盈怡 3D"
    assert holo.get_attribute("data-pose") == "idle"

    # 验证 Canvas 已完成 3D 角色绘制（非空白画布）
    non_empty_pixels = page.evaluate("""() => {
        const c = document.getElementById('emcAvatarCanvas');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let count = 0;
        for (let i = 3; i < d.length; i += 4) {
            if (d[i] > 0) count++;
        }
        return count;
    }""")
    assert non_empty_pixels > 1500

    # 保存小镇右下角 3D 数字人伴学舱截图
    out = shots_dir()
    page.screenshot(path=str(out / "avatar-town-bottom-right.png"))

    # 2. 打开副驾面板，测试 3D 控制台：切换形象、姿态与打断播报
    page.locator("#cpFab").click()
    assert page.locator("#cpPanel.open").is_visible()
    assert page.locator("#emcAvatarDeck").is_visible()
    assert "星云 3D 具身底座" in page.locator("#emcAgentArchBadge").inner_text()

    # 切换形象：星芽 -> 水獭花花 -> 盈怡
    page.locator("#emcAvatarPresetSelect").select_option("xingya")
    assert page.locator("#emcAvatarPresetBadge").inner_text() == "小商·星芽 3D"
    assert holo.get_attribute("data-preset") == "xingya"

    page.locator("#emcAvatarPresetSelect").select_option("huahua")
    assert page.locator("#emcAvatarPresetBadge").inner_text() == "小商·花花 3D"
    assert holo.get_attribute("data-preset") == "huahua"

    page.locator("#emcAvatarPresetSelect").select_option("yingyi")
    assert page.locator("#emcAvatarPresetBadge").inner_text() == "小商·盈怡 3D"

    # 切换姿态与打断播报
    page.locator('[data-avatar-pose-btn="listen"]').click()
    assert holo.get_attribute("data-pose") == "listen"
    assert "倾听" in page.locator("#emcAvatarPoseLabel").inner_text()

    page.locator('[data-avatar-pose-btn="interactive"]').click()
    assert holo.get_attribute("data-pose") == "speak"

    page.locator("#emcAvatarInterruptBtn").click()
    assert holo.get_attribute("data-pose") == "idle"
    assert "已打断播报" in page.locator("#emcAvatarBubble").inner_text()

    # 3. 连接星云 3D 实时流会话 (/api/agent/xingyun/session)
    page.locator("#emcAvatarConnect3dBtn").click()
    page.wait_for_function(
        "document.getElementById('emcAvatarModePill').getAttribute('data-mode') === 'rtc'"
    )
    assert "xy_mock_yingyi_001" in page.locator("#emcAvatarEngineStatus").inner_text()
    xy_calls = [c for c in state.calls if c["path"] == "/api/agent/xingyun/session"]
    assert len(xy_calls) == 1 and xy_calls[0]["preset_id"] == "yingyi"

    # 4. 发送选品算账提问，验证工具链调用卡片与四维 ROI 卡片
    page.locator("#cpInput").fill("帮我算账：拿货32元售价79元值不值得做？")
    page.locator("#cpPanel .cp-input button").click()
    page.wait_for_function("document.querySelectorAll('[data-emc-roi-card]').length === 1")

    roi_text = page.locator("[data-emc-roi-card]").inner_text()
    assert "售价 ¥79" in roi_text and "拿货 ¥32" in roi_text and "30.99%" in roi_text
    assert page.locator('[data-emc-tool-call="get_player_progress"]').is_visible()

    page.screenshot(path=str(out / "avatar-copilot-roi-open.png"))
    page.get_by_role("button", name="关闭 AI 副驾").click()

    # 5. 在真实经营工作台触发「小商 AI 预审 (L1-L6)」
    page.locator('[data-emc-gate="真实经营"]').click()
    page.locator("#emcWbSubmitVerifyBtn").click()
    page.wait_for_function("document.querySelectorAll('[data-emc-ai-review-btn]').length === 1")

    page.locator("[data-emc-ai-review-btn]").first.click()
    page.wait_for_function("document.querySelectorAll('[data-emc-ai-review-result]').length === 1")
    review_text = page.locator("[data-emc-ai-review-result]").first.inner_text()
    assert "建议通过（待人工复核）" in review_text
    assert "得分 92 / 100" in review_text

    # 校验零本地存储污染与零越界外链
    assert page.evaluate("JSON.stringify([localStorage.length, sessionStorage.length])") == "[0,0]"
    assert not h.foreign
