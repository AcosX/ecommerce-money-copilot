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
        self.roles = ["player"]
        self.sessions = set()
        self.calls = []               # 记录 /api、/auth 调用，供测试断言
        self.artifacts = []
        self.verifications = []
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
                "roles": list(self.state.roles),
                "csrf_token": CSRF_TOKEN,
            })
        if path == "/api/health":
            return self._json(200, {"status": "ok"})
        if path == "/api/projects":
            self.state.record(method="GET", path=path)
            if not self._session_id():
                return self._error(401, "unauthenticated", "请先登录")
            return self._json(200, {"items": [], "next_cursor": None})
        if path == "/api/artifacts":
            self.state.record(method="GET", path=path)
            if not self._session_id():
                return self._error(401, "unauthenticated", "请先登录")
            return self._json(200, {"items": list(self.state.artifacts), "next_cursor": None})
        if path == "/api/verifications":
            self.state.record(method="GET", path=path)
            if not self._session_id():
                return self._error(401, "unauthenticated", "请先登录")
            return self._json(200, {"items": list(self.state.verifications), "next_cursor": None})
        if path == "/api/agent/config":
            self.state.record(method="GET", path=path)
            return self._json(200, {
                "selected_architecture": "xingyun_3d_avatar_plus_custom_fastapi_agent_runtime",
                "default_preset": "yingyi",
                "presets": [
                    {"preset_id": "yingyi", "name": "盈怡 · 电商带教顾问 (3D)", "look_name": "yingyi_250717_clean_294922_loop"},
                    {"preset_id": "xingya", "name": "星芽 · 元气学姐 (3D)", "look_name": "xingya_sitting_clean_250929_loop"},
                    {"preset_id": "huahua", "name": "水獭花花 · 陪伴萌宠 (3D)", "look_name": "shuita_idle_250529_clean_285483_loop"},
                ],
                "xingyun": {"app_id_configured": True, "sdk_session_proxy_path": "/api/agent/xingyun/session"},
            })
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
        if path == "/api/artifacts":
            sid = self._session_id()
            ok_csrf = self._csrf_ok()
            body = self._body()
            self.state.record(method="POST", path=path, csrf=self.headers.get("X-CSRF-Token"),
                              origin=body.get("origin"), authed=bool(sid), csrf_ok=ok_csrf)
            if not sid:
                return self._error(401, "unauthenticated", "请先登录")
            if not ok_csrf:
                return self._error(403, "csrf_failed", "CSRF 校验失败")
            art = {
                "id": f"art_mock{len(self.state.artifacts) + 1:04d}",
                "project_id": body.get("project_id", "prj_mock0001"),
                "artifact_type": body.get("artifact_type", "product_selection"),
                "schema_version": body.get("schema_version", 1),
                "title": body.get("title", "测试成果"),
                "status": "draft",
                "origin": body.get("origin", "formal"),
                "origin_label": "来自教学模拟" if body.get("origin") == "tutorial_copy" else "正式创建",
                "source_level_id": body.get("source_level_id"),
                "current_revision": 1,
                "version": 1,
            }
            self.state.artifacts.insert(0, art)
            return self._json(201, art)
        if path == "/api/evidence":
            sid = self._session_id()
            ok_csrf = self._csrf_ok()
            n = int(self.headers.get("Content-Length") or 0)
            if n > 0:
                self.rfile.read(n)
            self.state.record(method="POST", path=path, csrf=self.headers.get("X-CSRF-Token"),
                              authed=bool(sid), csrf_ok=ok_csrf)
            if not sid:
                return self._error(401, "unauthenticated", "请先登录")
            if not ok_csrf:
                return self._error(403, "csrf_failed", "CSRF 校验失败")
            return self._json(201, {"id": "evd_mock0001", "original_filename": "order-evidence.png"})
        if path == "/api/verifications":
            sid = self._session_id()
            ok_csrf = self._csrf_ok()
            body = self._body()
            self.state.record(method="POST", path=path, csrf=self.headers.get("X-CSRF-Token"),
                              authed=bool(sid), csrf_ok=ok_csrf)
            if not sid:
                return self._error(401, "unauthenticated", "请先登录")
            if not ok_csrf:
                return self._error(403, "csrf_failed", "CSRF 校验失败")
            sub = {
                "id": f"ver_mock{len(self.state.verifications) + 1:04d}",
                "artifact_id": body.get("artifact_id", "art_mock0001"),
                "status": "pending",
                "note": body.get("note", ""),
                "reviews": [],
            }
            self.state.verifications.insert(0, sub)
            return self._json(201, sub)
        if path == "/api/agent/xingyun/session":
            body = self._body()
            preset_id = body.get("preset_id") or "yingyi"
            self.state.record(method="POST", path=path, preset_id=preset_id)
            return self._json(200, {
                "error_code": 0,
                "error_reason": "",
                "data": {
                    "session_id": f"xy_mock_{preset_id}_001",
                    "look_name": f"{preset_id}_3d_loop",
                    "sdk_config": {"pose": "2:3"},
                },
            })
        if path == "/api/agent/chat":
            body = self._body()
            msg = str(body.get("message") or "")
            self.state.record(method="POST", path=path, message=msg, preset_id=body.get("preset_id"))
            roi = {
                "supply_price_yuan": 32.0,
                "retail_price_yuan": 79.0,
                "estimated_net_profit_yuan": 24.48,
                "margin_rate_pct": 30.99,
                "score_4d": {"weighted_total": 81.3},
                "verdict": "净利润率 31.0%（≥25%），符合女装细分类目破零安全线。",
            } if any(k in msg for k in ("算账", "毛利", "79", "32", "值不值得")) else None
            return self._json(200, {
                "reply": f"【小商 3D 参谋】针对「{msg[:24]}」：已结合 {body.get('current_level', 'L1')} 关卡要求完成推演。",
                "ssml": f"<speak>{msg[:24]}</speak>",
                "emotion": "happy",
                "pose": "interactive",
                "mood": int(body.get("mood") or 0) + 2,
                "mood_delta": 2,
                "quality_tier": "high",
                "provider": "ai_gateway",
                "model": "gemini-2.5-flash",
                "tool_calls": [
                    {"tool": "get_player_progress", "status": "ok", "summary": "读取当前关卡进度"},
                    {"tool": "get_level_guide", "status": "ok", "summary": "加载关卡实操指南"},
                ],
                "roi_calculation": roi,
                "saved_artifact": None,
                "suggested_Dynamic_chips": ["选品评估怎么算权重？", "帮我算账：拿货32元售价79元"],
            })
        if path.startswith("/api/agent/reviews/"):
            sid = self._session_id()
            ok_csrf = self._csrf_ok()
            sub_id = path.rsplit("/", 1)[-1]
            self.state.record(method="POST", path=path, submission_id=sub_id, authed=bool(sid), csrf_ok=ok_csrf)
            if not sid:
                return self._error(401, "unauthenticated", "请先登录")
            if not ok_csrf:
                return self._error(403, "csrf_failed", "CSRF 校验失败")
            return self._json(200, {
                "submission_id": sub_id,
                "level_code": "L2",
                "recommendation": "approve_candidate",
                "recommendation_label": "建议通过（待人工复核）",
                "score": 92,
                "summary": "选品单毛利与四维评分完整，凭证 SHA-256 校验通过，建议进入人工复核通过。",
                "passed_checks": ["关联证据物理文件与 SHA-256 指纹核验通过", "L2 选品单包含有效毛利测算"],
                "issues": [],
                "rework_instructions": [],
                "human_audit_focus": ["人工抽检 1688 货源链接有效性"],
            })
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
