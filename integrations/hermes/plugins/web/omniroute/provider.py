"""OmniRoute web search and URL fetch backend for Hermes web tools."""

from __future__ import annotations

import os
from typing import Any, Dict, List

from agent.web_search_provider import WebSearchProvider


MAX_SEARCH_RESULTS = 100
SEARCH_TIMEOUT_SECONDS = 60
FETCH_TIMEOUT_SECONDS = 90


class OmniRouteWebProvider(WebSearchProvider):
    @property
    def name(self) -> str:
        return "omniroute"

    @property
    def display_name(self) -> str:
        return "OmniRoute"

    def is_available(self) -> bool:
        return bool(_api_key()) and bool(_base_url())

    def supports_search(self) -> bool:
        return True

    def supports_extract(self) -> bool:
        return True

    def search(self, query: str, limit: int = 5) -> Dict[str, Any]:
        try:
            import httpx

            response = httpx.post(
                _url("/v1/search"),
                headers=_omniroute_headers(),
                json={"query": query, "max_results": _clamp_search_limit(limit)},
                timeout=SEARCH_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            return {"success": True, "data": {"web": _search_results(response.json())}}
        except Exception as exc:  # noqa: BLE001
            return {"success": False, "error": f"OmniRoute search failed: {exc}"}

    def extract(self, urls: List[str], **kwargs: Any) -> List[Dict[str, Any]]:
        return [_extract_url(url, kwargs) for url in urls]

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": "OmniRoute",
            "badge": "local",
            "tag": "Uses OmniRoute /v1/search and /v1/web/fetch.",
            "env_vars": [
                {"key": "OMNIROUTE_BASE_URL", "prompt": "OmniRoute base URL"},
                {"key": "OMNIROUTE_API_KEY", "prompt": "OmniRoute API key"},
            ],
        }


def _extract_url(url: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import httpx

        response = httpx.post(
            _url("/v1/web/fetch"),
            headers=_omniroute_headers(),
            json={
                "url": url,
                "format": kwargs.get("format") or "markdown",
                "include_metadata": True,
                "fallback": True,
            },
            timeout=FETCH_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return _fetch_result(url, response.json())
    except Exception as exc:  # noqa: BLE001
        return {
            "url": url,
            "title": "",
            "content": "",
            "raw_content": "",
            "error": f"OmniRoute fetch failed: {exc}",
            "metadata": {"sourceURL": url},
        }


def _search_results(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for index, item in enumerate(body.get("results") or [], start=1):
        results.append(
            {
                "title": item.get("title") or "",
                "url": item.get("url") or "",
                "description": item.get("snippet") or item.get("description") or "",
                "position": item.get("position") or index,
            }
        )
    return results


def _fetch_result(url: str, body: Dict[str, Any]) -> Dict[str, Any]:
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    content = body.get("content") or body.get("markdown") or body.get("html") or ""
    title = metadata.get("title") or body.get("title") or ""
    return {
        "url": body.get("url") or url,
        "title": title,
        "content": content,
        "raw_content": content,
        "metadata": metadata,
    }


def _clamp_search_limit(limit: int) -> int:
    return min(max(int(limit), 1), MAX_SEARCH_RESULTS)


def _base_url() -> str:
    return os.getenv("OMNIROUTE_BASE_URL", "").strip().rstrip("/")


def _api_key() -> str:
    return os.getenv("OMNIROUTE_API_KEY", "").strip()


def _url(path: str) -> str:
    return _base_url() + path


def _omniroute_headers() -> Dict[str, str]:
    # AICODE-NOTE: OmniRoute reads x-api-key only for Anthropic-style requests.
    return {
        "x-api-key": _api_key(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
