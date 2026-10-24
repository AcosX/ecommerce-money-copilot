"""应用骨架：健康检查、统一错误格式、请求 ID、请求体上限、开发静态文件。"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI, Request
from fastapi.testclient import TestClient

from emc_api.db import Database

from .conftest import TEST_ORIGIN
from .support import router as support_router

REQUEST_ID_RE = re.compile(r"^req_[a-z2-7]{26}$")


@pytest.fixture
def app(app_factory) -> FastAPI:
    return app_factory(support_router)


@pytest.fixture
def logged_in(client: TestClient, make_player, login_as) -> TestClient:
    """非 GET 的 /api/* 需要登录 + CSRF；需要走到路由内部的测试先登录。"""
    login_as(make_player())
    return client


def assert_error(resp, status: int, code: str) -> dict:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"}
    err = body["error"]
    assert set(err) == {"code", "message", "request_id", "details"}
    assert err["code"] == code
    assert isinstance(err["message"], str) and err["message"]
    assert err["request_id"] == resp.headers["X-Request-ID"]
    assert isinstance(err["details"], dict)
    return err


# ---------------------------------------------------------------- 健康检查


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "database": "ok"}
    assert resp.headers["Cache-Control"] == "no-store"


def test_health_database_down(app_factory) -> None:
    broken = Database("mysql+pymysql://nobody:wrong@127.0.0.1:1/none?charset=utf8mb4")
    try:
        with TestClient(app_factory(database_override=broken), base_url=TEST_ORIGIN) as c:
            resp = c.get("/api/health")
        assert resp.status_code == 503
        assert resp.json() == {"status": "unavailable", "database": "unavailable"}
        assert "wrong" not in resp.text
    finally:
        broken.dispose()


# ---------------------------------------------------------------- 错误格式


def test_unknown_api_path_is_404(client: TestClient) -> None:
    assert_error(client.get("/api/does-not-exist"), 404, "not_found")


def test_unknown_root_path_is_404(client: TestClient) -> None:
    assert_error(client.get("/nope"), 404, "not_found")


def test_method_not_allowed_is_405(client: TestClient) -> None:
    resp = client.get("/api/_t/echo")
    assert_error(resp, 405, "method_not_allowed")
    assert "POST" in resp.headers["Allow"]


def test_validation_error_lists_fields(logged_in: TestClient) -> None:
    err = assert_error(
        logged_in.post("/api/_t/echo", json={"name": "", "count": "x"}), 422, "validation_error"
    )
    errors = err["details"]["errors"]
    locs = {tuple(e["loc"]) for e in errors}
    assert ("body", "name") in locs and ("body", "count") in locs
    for e in errors:
        assert set(e) == {"loc", "msg", "type"}  # 不回显 input


def test_malformed_json_is_validation_error(logged_in: TestClient) -> None:
    resp = logged_in.post(
        "/api/_t/echo", content=b"{bad json", headers={"Content-Type": "application/json"}
    )
    assert_error(resp, 422, "validation_error")


def test_unhandled_exception_is_500_without_details(client: TestClient) -> None:
    resp = client.get("/api/_t/boom")
    err = assert_error(resp, 500, "internal_error")
    assert err["details"] == {}
    assert "secret-internal-detail" not in resp.text
    assert "Traceback" not in resp.text


def test_unauthenticated_error(client: TestClient) -> None:
    assert_error(client.get("/api/_t/private"), 401, "unauthenticated")


# ---------------------------------------------------------------- 请求 ID


def test_request_id_generated(client: TestClient) -> None:
    a = client.get("/api/health").headers["X-Request-ID"]
    b = client.get("/api/health").headers["X-Request-ID"]
    assert REQUEST_ID_RE.match(a) and REQUEST_ID_RE.match(b) and a != b


def test_request_id_accepts_safe_incoming_value(client: TestClient) -> None:
    resp = client.get("/api/health", headers={"X-Request-ID": "apache-1234abcd"})
    assert resp.headers["X-Request-ID"] == "apache-1234abcd"


@pytest.mark.parametrize("bad", ["short", "has space here!", "x" * 65, "a中" * 5])
def test_request_id_rejects_unsafe_incoming_value(client: TestClient, bad: str) -> None:
    resp = client.get("/api/health", headers={"X-Request-ID": bad.encode("utf-8")})
    assert REQUEST_ID_RE.match(resp.headers["X-Request-ID"])


def test_error_responses_carry_request_id(client: TestClient) -> None:
    for resp in (client.get("/nope"), client.get("/api/_t/boom")):
        assert REQUEST_ID_RE.match(resp.headers["X-Request-ID"])


# ---------------------------------------------------------------- 请求体上限


def test_body_within_limit(logged_in: TestClient) -> None:
    resp = logged_in.post("/api/_t/raw", content=b"x" * (256 * 1024))
    assert resp.status_code == 200
    assert resp.json() == {"size": 256 * 1024}


def test_body_over_limit_by_content_length(logged_in: TestClient) -> None:
    assert_error(
        logged_in.post("/api/_t/raw", content=b"x" * (256 * 1024 + 1)), 413, "payload_too_large"
    )


def test_anonymous_body_over_limit_is_413_before_auth(client: TestClient) -> None:
    assert_error(
        client.post("/api/_t/raw", content=b"x" * (256 * 1024 + 1)), 413, "payload_too_large"
    )


def test_body_over_limit_chunked(logged_in: TestClient) -> None:
    chunks = iter([b"x" * (200 * 1024), b"x" * (100 * 1024)])
    assert_error(logged_in.post("/api/_t/raw", content=chunks), 413, "payload_too_large")


def test_json_body_over_limit_chunked(logged_in: TestClient) -> None:
    chunks = iter([b'{"name": "', b"x" * (300 * 1024), b'"}'])
    resp = logged_in.post(
        "/api/_t/echo", content=chunks, headers={"Content-Type": "application/json"}
    )
    assert_error(resp, 413, "payload_too_large")


def test_body_limit_is_configurable(app_factory, settings, make_player, login_as) -> None:
    settings.max_body_bytes = 10
    with TestClient(app_factory(support_router), base_url=TEST_ORIGIN) as c:
        login_as(make_player(), test_client=c)
        assert c.post("/api/_t/raw", content=b"x" * 10).status_code == 200
        assert_error(c.post("/api/_t/raw", content=b"x" * 11), 413, "payload_too_large")


def test_evidence_upload_path_uses_upload_limit(
    app_factory, settings, make_player, login_as
) -> None:
    upload = APIRouter()

    @upload.post("/evidence")
    async def fake_upload(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    settings.max_upload_bytes = 1024 * 1024
    with TestClient(app_factory(upload, support_router), base_url=TEST_ORIGIN) as c:
        login_as(make_player(), test_client=c)
        assert c.post("/api/evidence", content=b"x" * (900 * 1024)).status_code == 200
        too_big = b"x" * (1024 * 1024 + 64 * 1024 + 1)
        assert_error(c.post("/api/evidence", content=too_big), 413, "payload_too_large")
        # 其他接口仍是 256 KiB
        assert_error(c.post("/api/_t/raw", content=b"x" * (300 * 1024)), 413, "payload_too_large")


# ---------------------------------------------------------------- 开发静态文件


@pytest.fixture
def static_root(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "assets").mkdir(parents=True)
    (root / "css").mkdir()
    (root / "js").mkdir()
    (root / "tools").mkdir()
    (root / "tools" / "models.html").write_text("<title>模型展示中心</title>", encoding="utf-8")
    (root / "backend").mkdir()
    (root / "docs").mkdir()
    (root / "index.html").write_text("<!doctype html><title>emc</title>", encoding="utf-8")
    (root / "assets" / "npc.png").write_bytes(b"\x89PNG fake")
    (root / "css" / "emc-login.css").write_text("body{}", encoding="utf-8")
    (root / "js" / "emc-api.js").write_text("export {}", encoding="utf-8")
    (root / "backend" / ".env").write_text("EMC_SESSION_SECRET=leak", encoding="utf-8")
    (root / "docs" / "secret.md").write_text("leak", encoding="utf-8")
    (root / "README.md").write_text("leak", encoding="utf-8")
    (root / ".gitignore").write_text("leak", encoding="utf-8")
    return root


def test_dev_serves_allowlisted_static(app_factory, settings, static_root: Path) -> None:
    settings.env = "dev"
    with TestClient(app_factory(static_root=static_root), base_url=TEST_ORIGIN) as c:
        for path in ("/", "/index.html"):
            resp = c.get(path)
            assert resp.status_code == 200 and "<title>emc</title>" in resp.text
            assert resp.headers["content-type"].startswith("text/html")
        assert c.get("/assets/npc.png").content == b"\x89PNG fake"
        assert c.get("/css/emc-login.css").status_code == 200
        assert c.get("/js/emc-api.js").status_code == 200
        assert "模型展示中心" in c.get("/tools/models.html").text
        assert c.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "/backend/.env",
        "/docs/secret.md",
        "/README.md",
        "/.gitignore",
        "/assets/../backend/.env",
        "/assets/%2e%2e/backend/.env",
        "/js/..%2f..%2fbackend/.env",
    ],
)
def test_dev_static_blocks_everything_else(
    app_factory, settings, static_root: Path, path: str
) -> None:
    settings.env = "dev"
    with TestClient(app_factory(static_root=static_root), base_url=TEST_ORIGIN) as c:
        resp = c.get(path)
        assert resp.status_code == 404
        assert "leak" not in resp.text


def test_non_dev_does_not_serve_static(app_factory, static_root: Path) -> None:
    with TestClient(app_factory(static_root=static_root), base_url=TEST_ORIGIN) as c:
        assert c.get("/").status_code == 404
        assert c.get("/assets/npc.png").status_code == 404
        assert c.get("/tools/models.html").status_code == 404


def test_prod_hides_openapi(app_factory, settings) -> None:
    settings_prod = settings.model_copy(
        update={"env": "prod", "public_origin": "https://money.example.com", "cookie_secure": True}
    )
    with TestClient(app_factory(settings_override=settings_prod), base_url=TEST_ORIGIN) as c:
        assert c.get("/api/openapi.json").status_code == 404
        assert c.get("/api/docs").status_code == 404
