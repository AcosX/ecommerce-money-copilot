"""归档后 HTTP 缓存策略回归：API JSON GET 的 ETag 条件缓存与 no-store 边界。

缓存语义：/api/ 的 200 JSON GET 响应携带 ETag 与
`Cache-Control: private, max-age=0, must-revalidate`，浏览器可以存储并逐次
回源校验（304 复用）。`private` 阻止共享缓存存储会话数据；ETag 按请求
实际响应逐次计算，304 只在内容逐字节一致时命中，因此跨会话不会泄露或
复用过期数据。其余面（认证流、错误、健康探针、写操作）保持 no-store。
"""

from __future__ import annotations

import re

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.testclient import TestClient

from .conftest import TEST_ORIGIN
from .support import router as support_router

ETAG_RE = re.compile(r'^"[0-9a-f]{64}"$')
CONDITIONAL_CACHE_CONTROL = "private, max-age=0, must-revalidate"


@pytest.fixture
def app(app_factory) -> FastAPI:
    return app_factory(support_router)


@pytest.fixture
def make_stream_client(app_factory):
    """挂载流式 JSON 路由的客户端工厂：多段 body 与中途崩溃两种路径。"""

    def factory() -> TestClient:
        stream_router = APIRouter(prefix="/_stream")

        @stream_router.get("/multi-chunk")
        async def multi_chunk() -> StreamingResponse:
            async def gen():
                for piece in (b'{"parts":', b'"two"', b"}"):
                    yield piece

            return StreamingResponse(gen(), media_type="application/json")

        @stream_router.get("/crash-mid-stream")
        async def crash_mid_stream() -> StreamingResponse:
            async def gen():
                yield b'{"partial":'
                raise RuntimeError("boom mid-stream")

            return StreamingResponse(gen(), media_type="application/json")

        app = app_factory(stream_router)
        return TestClient(app, base_url=TEST_ORIGIN)

    return factory


def test_api_json_get_carries_conditional_cache_headers(
    client: TestClient, make_player, login_as
) -> None:
    login_as(make_player())
    resp = client.get("/api/_t/private")
    assert resp.status_code == 200, resp.text
    assert resp.headers["Cache-Control"] == CONDITIONAL_CACHE_CONTROL
    assert ETAG_RE.match(resp.headers["ETag"])


def test_api_json_get_revalidates_with_304(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    first = client.get("/api/_t/private")
    etag = first.headers["ETag"]

    revalidated = client.get("/api/_t/private", headers={"If-None-Match": etag})
    assert revalidated.status_code == 304
    assert revalidated.content == b""
    assert revalidated.headers["ETag"] == etag
    assert revalidated.headers["Cache-Control"] == CONDITIONAL_CACHE_CONTROL
    assert revalidated.headers["X-Request-ID"]

    mismatch = client.get("/api/_t/private", headers={"If-None-Match": '"deadbeef"'})
    assert mismatch.status_code == 200
    assert mismatch.headers["ETag"] == etag


@pytest.mark.parametrize(
    "header",
    [
        'W/"match-me"',  # 弱比较：忽略 W/ 前缀
        '"other", "match-me"',  # 列表命中
        "*",  # 通配
    ],
)
def test_api_json_get_304_accepts_if_none_match_forms(
    client: TestClient, make_player, login_as, header: str
) -> None:
    login_as(make_player())
    etag = client.get("/api/_t/private").headers["ETag"]
    bare = etag.strip('"')
    presented = header.replace("match-me", bare)
    resp = client.get("/api/_t/private", headers={"If-None-Match": presented})
    assert resp.status_code == 304
    assert resp.content == b""


def test_api_json_get_200_when_representation_changes(
    client: TestClient, make_player, login_as
) -> None:
    """跨会话安全：另一账号命中同一 URL 时，内容不同则必须回完整 200。"""
    login_as(make_player(display_name="店主A", email="a@example.com"))
    first = client.get("/api/_t/private")
    assert first.status_code == 200
    etag_a = first.headers["ETag"]

    login_as(make_player(display_name="店主B", email="b@example.com"))
    resp = client.get("/api/_t/private", headers={"If-None-Match": etag_a})
    assert resp.status_code == 200
    assert resp.headers["ETag"] != etag_a
    assert resp.json()["id"] != first.json()["id"]


def test_api_health_stays_no_store(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "no-store"
    assert "ETag" not in resp.headers


def test_api_error_responses_stay_no_store(client: TestClient) -> None:
    unauthenticated = client.get("/api/_t/private")
    assert unauthenticated.status_code == 401
    assert unauthenticated.headers["Cache-Control"] == "no-store"
    assert "ETag" not in unauthenticated.headers

    boom = client.get("/api/_t/boom")
    assert boom.status_code == 500
    assert boom.headers["Cache-Control"] == "no-store"
    assert "ETag" not in boom.headers


def test_api_post_response_stays_no_store(client: TestClient, make_player, login_as) -> None:
    login_as(make_player())
    resp = client.post("/api/_t/echo", json={"name": "小店"})
    assert resp.status_code == 200
    assert resp.headers["Cache-Control"] == "no-store"
    assert "ETag" not in resp.headers


def test_admin_ui_shell_is_long_cached(app_factory) -> None:
    from emc_api.routers import admin as admin_router

    app = app_factory()
    app.include_router(admin_router.ui_router)
    with TestClient(app, base_url=TEST_ORIGIN) as test_client:
        resp = test_client.get("/admin/")
        assert resp.status_code == 200
        assert resp.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_streaming_json_multi_chunk_gets_etag_and_304(make_stream_client) -> None:
    """多段 body 的 JSON GET：ETag 覆盖完整响应体，304 语义不变。"""
    with make_stream_client() as client:
        first = client.get("/api/_stream/multi-chunk")
        assert first.status_code == 200
        assert first.json() == {"parts": "two"}
        etag = first.headers["ETag"]
        assert ETAG_RE.match(etag)
        assert first.headers["Cache-Control"] == CONDITIONAL_CACHE_CONTROL

        revalidated = client.get("/api/_stream/multi-chunk", headers={"If-None-Match": etag})
        assert revalidated.status_code == 304
        assert revalidated.content == b""


def test_mid_stream_failure_returns_complete_500(make_stream_client) -> None:
    """暂扣 start 后 app 崩溃：兜底 500 必须完整送达，不得重放旧 200 start。"""
    with make_stream_client() as client:
        resp = client.get("/api/_stream/crash-mid-stream")
        assert resp.status_code == 500
        assert resp.json()["error"]["code"] == "internal_error"
        assert resp.headers["Cache-Control"] == "no-store"


def test_set_cookie_response_stays_no_store(app: FastAPI, client: TestClient) -> None:
    """带 Set-Cookie 的 API 响应不得进入条件缓存。"""

    @app.get("/api/_t/with-cookie")
    def with_cookie() -> JSONResponse:
        resp = JSONResponse({"ok": True})
        resp.set_cookie("emc_probe", "1")
        return resp

    resp = client.get("/api/_t/with-cookie")
    assert resp.status_code == 200
    assert "emc_probe" in resp.headers.get("set-cookie", "")
    assert resp.headers["Cache-Control"] == "no-store"
    assert "ETag" not in resp.headers
