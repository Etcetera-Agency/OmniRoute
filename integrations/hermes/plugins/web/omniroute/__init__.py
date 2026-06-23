"""OmniRoute web search + URL fetch plugin."""

from __future__ import annotations

from plugins.web.omniroute.provider import OmniRouteWebProvider


def register(ctx) -> None:
    ctx.register_web_search_provider(OmniRouteWebProvider())
