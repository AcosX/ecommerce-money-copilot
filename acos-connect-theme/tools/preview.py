"""仅供本机布局验收的主题预览，不提供认证或提交接口。"""
import argparse
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("theme_branding", root / "theme_branding.py")
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)


class PreviewHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        routes = {
            "/": lambda: theme.pixel_auth_page("login"),
            "/login": lambda: theme.pixel_auth_page("login"),
            "/register": lambda: theme.pixel_auth_page("register"),
            "/forgot-password": lambda: theme.pixel_email_form_page("forgot"),
            "/resend-verification": lambda: theme.pixel_email_form_page("resend"),
            "/reset-password": lambda: theme.pixel_reset_form("preview-token"),
            "/preview/consent": lambda: theme.pixel_consent_page("电商搞钱参谋", "player@example.com"),
            "/preview/error": lambda: theme.pixel_auth_page("login", "邮箱或密码不正确，请重试。"),
            "/preview/message": lambda: theme.pixel_message_page("邮件已发送", "请前往邮箱查收验证邮件。", [("/login", "返回登录")]),
        }
        renderer = routes.get(urlsplit(self.path).path)
        if renderer is None:
            self.send_error(404)
            return
        response = renderer()
        self.send_response(response.status_code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(response.body)))
        self.end_headers()
        self.wfile.write(response.body)

    def do_POST(self):
        self.send_error(405, "Local layout preview only")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5194)
    args = parser.parse_args()
    print(f"主题预览：http://127.0.0.1:{args.port}/login", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler).serve_forever()
