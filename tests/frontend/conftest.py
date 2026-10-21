"""前端测试夹具：mock 后端 + Playwright（系统 Chromium）。

运行（仓库根目录）：
  uv run --with pytest --with playwright python -m pytest tests/frontend -q -p no:cacheprovider
可选环境变量：
  EMC_CHROMIUM   浏览器路径，默认 /usr/bin/chromium
  EMC_SHOTS_DIR  截图目录，默认系统临时目录下的 emc-shots
"""
import os
import re
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import sync_playwright

from mock_server import COOKIE_NAME, make_server

ROOT = Path(__file__).resolve().parents[2]
FONT_HOST = "miaoda.feishu.cn"  # 页面已有的像素字体样式表，测试里替换为空 CSS
# 这些资源加载失败只会让浏览器记一条 "Failed to load resource"，不是脚本错误
TOLERATED_RESOURCE_PATHS = re.compile(r"^/(assets/town\.png|api/.*|auth/.*)$")


def shots_dir():
    d = Path(os.environ.get("EMC_SHOTS_DIR") or Path(tempfile.gettempdir()) / "emc-shots")
    d.mkdir(parents=True, exist_ok=True)
    return d


class Harness:
    def __init__(self, page, base):
        self.page = page
        self.base = base
        self.page_errors = []
        self.console_errors = []
        self.resource_errors = []
        self.requests = []
        self.external = []

    @property
    def foreign(self):
        """除页面自带字体样式表外，请求过的其他站点。"""
        return [u for u in self.external if urlsplit(u).hostname != FONT_HOST]

    def urls(self, needle):
        return [u for _, u in self.requests if needle in u]

    def check_clean(self):
        assert not self.page_errors, f"未捕获的页面异常: {self.page_errors}"
        assert not self.console_errors, f"console.error: {self.console_errors}"
        for url in self.resource_errors:
            assert TOLERATED_RESOURCE_PATHS.match(urlsplit(url).path), f"意外的资源加载失败: {url}"
        hosts = {urlsplit(u).hostname for u in self.external}
        assert hosts <= {FONT_HOST}, f"请求了外部站点: {self.external}"


@pytest.fixture(scope="session")
def server():
    srv = make_server(ROOT)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv
    srv.shutdown()
    srv.server_close()


@pytest.fixture(autouse=True)
def state(server):
    server.state.reset()
    return server.state


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            executable_path=os.environ.get("EMC_CHROMIUM", "/usr/bin/chromium"),
            args=["--no-sandbox"],
        )
        yield b
        b.close()


@pytest.fixture
def open_page(browser, server, state):
    created = []

    def _open(width=1000, height=800, session=False):
        ctx = browser.new_context(viewport={"width": width, "height": height}, locale="zh-CN")
        if session:
            ctx.add_cookies([{"name": COOKIE_NAME, "value": state.new_session(), "url": server.base_url}])
        page = ctx.new_page()
        h = Harness(page, server.base_url)

        def on_route(route):
            url = route.request.url
            if url.startswith(server.base_url):
                return route.continue_()
            h.external.append(url)
            if urlsplit(url).hostname == FONT_HOST:
                return route.fulfill(status=200, content_type="text/css", body="")
            return route.fulfill(status=200, content_type="text/html", body="<h1>external</h1>")

        ctx.route("**/*", on_route)
        page.on("pageerror", lambda e: h.page_errors.append(str(e)))
        page.on("request", lambda r: h.requests.append((r.method, r.url)))

        def on_console(m):
            if m.type != "error":
                return
            if m.text.startswith("Failed to load resource"):
                h.resource_errors.append(m.location.get("url", ""))
            else:
                h.console_errors.append(m.text)

        page.on("console", on_console)
        created.append((ctx, h))
        return h

    yield _open
    for ctx, h in created:
        try:
            h.check_clean()
        finally:
            ctx.close()
