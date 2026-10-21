"""前端联调用的最小 mock 后端（仅测试使用，不随站点发布）。

同源提供仓库根目录静态文件，并按 docs/backend-contract.md 模拟：
  GET  /api/me               匿名 / 已登录（Cookie emc_session）；me_status=500 时返回 500
  GET  /api/health
  GET  /auth/login           写入 mock 会话 Cookie，303 到 return_to（非同源相对路径回退 /）
  POST /auth/logout          校验 X-CSRF-Token 与 Origin，成功 204 并清除 Cookie
  GET/POST /api/projects     用于验证 401 处理、CSRF 头与 Idempotency-Key

手动运行：
  python3 tests/frontend/mock_server.py --port 8000 [--me-500]
"""
import argparse
import json
import mimetypes
import secrets
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

COOKIE_NAME = "emc_session"
CSRF_TOKEN = "mock-csrf-token"
MAX_BODY = 256 * 1024


def safe_return_to(value):
    """与约定一致：以 / 开头且不以 // 开头；另外拒绝反斜杠与控制字符（浏览器会把 /\\ 当作 //）。"""
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    if "\\" in value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        return "/"
    return value


class MockState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.me_status = 200          # 设为 500 模拟后端故障
        self.display_name = "店主"
        self.sessions = set()
        self.calls = []               # 记录 /api、/auth 调用，供测试断言
        self.lock = threading.Lock()

    def new_session(self):
        sid = "s-" + secrets.token_hex(8)
        with self.lock:
            self.sessions.add(sid)
        return sid

    def record(self, **kw):
        with self.lock:
            self.calls.append(kw)


class Handler(BaseHTTPRequestHandler):
    server_version = "EmcMock/1"

    def log_message(self, *args):
        pass

    # ---- helpers ----
    @property
    def state(self):
        return self.server.state

    def _session_id(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get(COOKIE_NAME)
        if morsel and morsel.value in self.state.sessions:
            return morsel.value
        return None

    def _send(self, status, body=b"", ctype=None, headers=()):
        self.send_response(status)
        self.send_header("X-Request-ID", "req_" + secrets.token_hex(6))
        self.send_header("Cache-Control", "no-store")
        if ctype:
            self.send_header("Content-Type", ctype)
        if status != 204:
            self.send_header("Content-Length", str(len(body)))
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD" and status != 204:
            self.wfile.write(body)

    def _json(self, status, obj, headers=()):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", headers)

    def _error(self, status, code, message, details=None):
        self._json(status, {"error": {"code": code, "message": message,
                                      "request_id": "req_" + secrets.token_hex(4), "details": details or {}}})

    def _csrf_ok(self):
        if self.headers.get("X-CSRF-Token") != CSRF_TOKEN:
            return False
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin") or self.headers.get("Referer") or ""
        return origin == "http://" + host or origin.startswith("http://" + host + "/")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    # ---- GET ----
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlsplit(self.path)
        path = url.path
        if path == "/api/me":
            self.state.record(method="GET", path=path)
            if self.state.me_status >= 500:
                return self._error(self.state.me_status, "internal_error", "服务暂时不可用")
            if not self._session_id():
                return self._json(200, {"authenticated": False})
            return self._json(200, {
                "authenticated": True,
                "player": {"id": "ply_mock0001", "display_name": self.state.display_name, "email": "mock@example.com"},
                "roles": ["player"],
                "csrf_token": CSRF_TOKEN,
            })
        if path == "/api/health":
            return self._json(200, {"status": "ok"})
        if path == "/api/projects":
            self.state.record(method="GET", path=path)
            if not self._session_id():
                return self._error(401, "unauthenticated", "请先登录")
            return self._json(200, {"items": [], "next_cursor": None})
        if path == "/auth/login":
            target = safe_return_to((parse_qs(url.query).get("return_to") or [""])[0])
            self.state.record(method="GET", path=path, query=url.query, location=target)
            sid = self.state.new_session()
            return self._send(303, b"", headers=[
                ("Location", target),
                ("Set-Cookie", f"{COOKIE_NAME}={sid}; Path=/; HttpOnly; SameSite=Lax"),
            ])
        if path.startswith("/api/") or path.startswith("/auth/"):
            return self._error(404, "not_found", "不存在")
        return self._static(path)

    # ---- POST ----
    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/auth/logout":
            sid = self._session_id()
            ok_csrf = self._csrf_ok()
            self.state.record(method="POST", path=path, csrf=self.headers.get("X-CSRF-Token"),
                              origin=self.headers.get("Origin"), authed=bool(sid), csrf_ok=ok_csrf)
            if not sid:
                return self._error(401, "unauthenticated", "请先登录")
            if not ok_csrf:
                return self._error(403, "csrf_failed", "CSRF 校验失败")
            self.state.sessions.discard(sid)
            return self._send(204, headers=[("Set-Cookie", f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")])
        if path == "/api/projects":
            sid = self._session_id()
            ok_csrf = self._csrf_ok()
            body = self._body()
            self.state.record(method="POST", path=path, csrf=self.headers.get("X-CSRF-Token"),
                              idempotency_key=self.headers.get("Idempotency-Key"),
                              content_type=self.headers.get("Content-Type"), authed=bool(sid), csrf_ok=ok_csrf)
            if not sid:
                return self._error(401, "unauthenticated", "请先登录")
            if not ok_csrf:
                return self._error(403, "csrf_failed", "CSRF 校验失败", {"hint": "header"})
            return self._json(201, {"id": "prj_mock0001", "name": body.get("name")})
        return self._error(404, "not_found", "不存在")

    # ---- 静态文件 ----
    def _static(self, path):
        root = self.server.root
        target = (root / unquote(path).lstrip("/")).resolve()
        try:
            parts = target.relative_to(root).parts
        except ValueError:
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        if any(p.startswith(".") for p in parts) or (parts and parts[0] == "tests"):
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)


class MockServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, root, port=0):
        super().__init__(("127.0.0.1", port), Handler)
        self.root = Path(root).resolve()
        self.state = MockState()

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.server_address[1]}"


def make_server(root, port=0):
    return MockServer(root, port)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--me-500", action="store_true", help="/api/me 返回 500")
    args = ap.parse_args()
    srv = make_server(args.root, args.port)
    if args.me_500:
        srv.state.me_status = 500
    print("mock server:", srv.base_url, flush=True)
    srv.serve_forever()
