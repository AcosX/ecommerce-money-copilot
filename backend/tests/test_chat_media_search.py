from __future__ import annotations

import base64
import io

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr, ValidationError

from emc_api.routers.agent import CompanionChatIn
from emc_api.services import anysearch
from emc_api.services.agent_runtime import AgentProviderAdapter


def image_data():
    output = io.BytesIO()
    Image.new("RGB", (30, 20), "red").save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def test_image_validation_blocks_remote_urls_invalid_and_too_many():
    valid = image_data()
    assert CompanionChatIn(message="看看", images=[valid]).images == [valid]
    for images in (["https://internal/image"], ["data:image/png;base64,AAAA"], [valid] * 4):
        with pytest.raises(ValidationError):
            CompanionChatIn(message="看看", images=images)


def test_provider_sends_actual_image_content(settings, monkeypatch):
    settings.ai_api_key = SecretStr("test-key")
    captured = []

    def post(self, url, **kwargs):
        captured.append(kwargs["json"])
        return httpx.Response(200, json={"choices": [{"message": {"content": "这是红色图片"}}]})

    monkeypatch.setattr(httpx.Client, "post", post)
    reply, _ = AgentProviderAdapter(settings).complete_json_or_text(
        system_prompt="查看图片", user_prompt="图中是什么", images=[image_data()]
    )
    assert reply == "这是红色图片"
    parts = captured[0]["messages"][-1]["content"]
    assert parts[1] == {"type": "image_url", "image_url": {"url": image_data()}}


def test_anysearch_missing_key_never_calls_network(settings, monkeypatch):
    monkeypatch.setattr(httpx.Client, "post", lambda *a, **k: pytest.fail("unexpected network"))
    assert anysearch.search(settings, "最新政策")["reason"] == "missing_api_key"


def test_anysearch_protocol_and_sources(settings, monkeypatch):
    settings.anysearch_api_key = SecretStr("private-search-key")

    def post(self, url, **kwargs):
        assert url == "https://api.anysearch.com/v1/search"
        assert kwargs["headers"]["Authorization"] == "Bearer private-search-key"
        assert kwargs["json"]["query"] == "平台政策"
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "code": 0,
                "data": {
                    "results": [
                        {
                            "title": "官方说明",
                            "url": "https://example.org/policy",
                            "snippet": "最新说明",
                        },
                        {"title": "恶意链接", "url": "javascript:alert(1)"},
                    ]
                },
            },
        )

    monkeypatch.setattr(httpx.Client, "post", post)
    data = anysearch.search(settings, "平台政策")
    assert data == {
        "status": "ok",
        "results": [
            {
                "title": "官方说明",
                "url": "https://example.org/policy",
                "snippet": "最新说明",
            }
        ],
    }
    assert "private-search-key" not in str(data)


@pytest.mark.parametrize("status", [401, 402, 429, 503])
def test_anysearch_failure_hides_upstream_body(settings, monkeypatch, status):
    settings.anysearch_api_key = SecretStr("private-search-key")
    monkeypatch.setattr(
        httpx.Client,
        "post",
        lambda self, url, **kwargs: httpx.Response(
            status,
            request=httpx.Request("POST", url),
            text="upstream private credentials",
        ),
    )
    result = anysearch.search(settings, "政策")
    assert result == {"status": "unavailable", "reason": "search_failed", "results": []}


def test_search_timeout_and_empty_results(settings, monkeypatch):
    settings.anysearch_api_key = SecretStr("test-key")

    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("private upstream details")

    monkeypatch.setattr(httpx.Client, "post", timeout)
    assert anysearch.search(settings, "政策")["status"] == "unavailable"
    monkeypatch.setattr(
        httpx.Client,
        "post",
        lambda self, url, **kwargs: httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"code": 0, "data": {"results": []}},
        ),
    )
    assert anysearch.search(settings, "没有结果") == {"status": "ok", "results": []}


def test_chat_and_native_keep_images_and_search_in_the_trusted_turn(client, settings, monkeypatch):
    from emc_api.models import XingyunWebSession
    from emc_api.services import agent_runtime

    from .test_xingyun_web import ROOT, callback

    captured = []

    def complete(self, **kwargs):
        captured.append(kwargs)
        return "图片中的颜色是红色。", {"provider": "ai_gateway_live"}

    monkeypatch.setattr(agent_runtime.AgentProviderAdapter, "complete_json_or_text", complete)
    monkeypatch.setattr(
        anysearch,
        "search",
        lambda settings, query: {
            "status": "ok",
            "results": [
                {
                    "title": "官方来源",
                    "url": "https://example.org/source",
                    "snippet": "外部参考",
                }
            ],
        },
    )
    body = {"message": "请看看图片并查一下最新市场信息", "images": [image_data()]}
    ordinary = client.post("/api/agent/chat", json=body)
    assert ordinary.status_code == 200, ordinary.text
    assert "https://example.org/source" in ordinary.json()["reply"]
    grant = client.post(ROOT).json()["id"]
    turn = client.post(f"{ROOT}/{grant}/turns", json=body).json()
    native = callback(client, settings, grant, body["message"] + "\n[" + turn["ticket"] + "]")
    assert native.status_code == 200, native.text
    assert len(captured) == 2
    for kwargs in captured:
        assert kwargs["images"] == body["images"]
        assert kwargs["context"]["web_search"]["results"][0]["title"] == "官方来源"
        assert "不为用户提供利润和财务建议" in kwargs["system_prompt"]
        assert "是不是你的机会" in kwargs["system_prompt"]
    with client.app.state.db.sessionmaker() as db:
        assert "data:image" not in str(db.get(XingyunWebSession, grant).turn)


def test_missing_visual_provider_and_search_are_honest(client):
    response = client.post(
        "/api/agent/chat",
        json={
            "message": "这张图片是什么",
            "images": [image_data()],
            "web_search": True,
        },
    )
    assert response.status_code == 200
    assert "无法看清图片内容" in response.json()["reply"]
    assert "联网搜索暂不可用" in response.json()["reply"]


def test_search_filters_fiction_unrelated_and_duplicate_results(settings, monkeypatch):
    settings.anysearch_api_key = SecretStr("test-key")
    rows = [
        {"title": "潮玩最新章节", "url": "https://reader.example/book/1"},
        {"title": "潮玩市场", "url": "https://book.qidian.com/1"},
        {"title": "今日天气", "url": "https://weather.example/1"},
        {"title": "潮玩趋势报告", "url": "https://research.example/1", "snippet": "授权IP商品"},
        {"title": "潮玩趋势报告", "url": "https://research.example/1"},
    ]
    monkeypatch.setattr(
        httpx.Client,
        "post",
        lambda self, url, **kwargs: httpx.Response(
            200, request=httpx.Request("POST", url), json={"code": 0, "data": {"results": rows}}
        ),
    )
    result = anysearch.search(settings, "帮我查一下潮玩市场趋势")
    assert [r["url"] for r in result["results"]] == ["https://research.example/1"]
    # A spoofed suffix must not be confused with the actual reading host.
    assert anysearch._relevant_result("qidian.com.example.org", "潮玩研究", "", {"潮玩"})
    assert anysearch._relevant_result("research.example", "网络小说IP周边商品", "", {"小说"})


@pytest.mark.parametrize(
    ("platform", "expected", "excluded"),
    [
        ("xiaohongshu", "name: xhs-product-scout", "name: pdd-product-scout"),
        ("pinduoduo", "name: pdd-product-scout", "name: xhs-product-scout"),
    ],
)
def test_l2_loads_platform_specific_selection_method(
    client, monkeypatch, platform, expected, excluded
):
    captured = []

    def complete(self, **kwargs):
        captured.append(kwargs["system_prompt"])
        return "先确认商品需求，再整理选品判断书。", {"provider": "ai_gateway_live"}

    monkeypatch.setattr(AgentProviderAdapter, "complete_json_or_text", complete)
    response = client.post(
        "/api/agent/chat",
        json={"message": "帮我选品", "level_id": "L2", "client_context": {"platform": platform}},
    )
    assert response.status_code == 200, response.text
    assert expected in captured[0]
    assert excluded not in captured[0]
    assert "不声称访问了未配置的平台数据工具" in captured[0]
