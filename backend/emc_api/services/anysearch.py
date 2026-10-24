"""Public AnySearch results; credentials and upstream error bodies stay server-side."""

import re
from typing import Any
from urllib.parse import urlsplit

import httpx

from ..config import Settings

# Conservative exclusions for reading pages, not a blanket ban on the word "小说":
# licensed IP/novel merchandise can be a legitimate commerce topic.
_FICTION_HOSTS = {"qidian.com", "jjwxc.net", "fanqienovel.com", "zongheng.com", "17k.com"}
_READING_MARKERS = ("笔趣阁", "最新章节", "无弹窗", "全文免费阅读", "小说在线阅读", "章节目录")
_QUERY_NOISE = (
    "帮我",
    "请问",
    "请",
    "查一下",
    "搜索",
    "联网",
    "最新",
    "实时",
    "市场",
    "信息",
    "相关",
    "资料",
    "报告",
    "分析",
    "生意规划",
    "平台",
    "政策",
    "趋势",
    "竞争",
    "赛道",
)


def _topic_terms(query: str) -> set[str]:
    text = query.lower()
    for word in _QUERY_NOISE:
        text = text.replace(word, " ")
    terms = set(re.findall(r"[a-z0-9]{3,}", text))
    for chunk in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        terms.update(chunk[i : i + 2] for i in range(len(chunk) - 1))
    return terms


def _relevant_result(host: str, title: str, snippet: str, terms: set[str]) -> bool:
    host = host.lower()
    if any(host == domain or host.endswith("." + domain) for domain in _FICTION_HOSTS):
        return False
    if any(marker in title for marker in _READING_MARKERS):
        return False
    text = (title + " " + snippet).lower()
    return not terms or any(term in text for term in terms)


def search(settings: Settings, query: str) -> dict[str, Any]:
    if not settings.anysearch_api_key.get_secret_value():
        return {"status": "unavailable", "reason": "missing_api_key", "results": []}
    try:
        with httpx.Client(timeout=settings.anysearch_timeout_seconds) as client:
            response = client.post(
                settings.anysearch_base_url.rstrip("/") + "/v1/search",
                headers={
                    "Authorization": "Bearer " + settings.anysearch_api_key.get_secret_value()
                },
                json={
                    "query": query[:1000],
                    "max_results": 5,
                    "language": "zh-CN",
                    "format": "json",
                },
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("code") != 0:
                raise ValueError("search_failed")
            results = payload["data"]["results"]
            if not isinstance(results, list):
                raise ValueError("invalid_results")
            rows = []
            seen = set()
            terms = _topic_terms(query)
            for row in results[:5]:
                if not isinstance(row, dict):
                    continue
                url = str(row.get("url") or "")[:2000]
                parts = urlsplit(url)
                if (
                    parts.scheme not in {"https", "http"}
                    or not parts.hostname
                    or parts.username
                    or parts.password
                ):
                    continue
                title = str(row.get("title") or parts.hostname)[:200]
                snippet = str(row.get("snippet") or row.get("content") or "")[:1800]
                if url in seen or not _relevant_result(parts.hostname, title, snippet, terms):
                    continue
                seen.add(url)
                rows.append(
                    {
                        "title": title,
                        "url": url,
                        "snippet": snippet,
                    }
                )
            return {"status": "ok", "results": rows}
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError):
        return {"status": "unavailable", "reason": "search_failed", "results": []}
