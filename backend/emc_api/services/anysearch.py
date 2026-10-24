"""Public AnySearch results; credentials and upstream error bodies stay server-side."""

from typing import Any
from urllib.parse import urlsplit

import httpx

from ..config import Settings


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
                rows.append(
                    {
                        "title": str(row.get("title") or parts.hostname)[:200],
                        "url": url,
                        "snippet": str(row.get("snippet") or row.get("content") or "")[:1800],
                    }
                )
            return {"status": "ok", "results": rows}
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError):
        return {"status": "unavailable", "reason": "search_failed", "results": []}
