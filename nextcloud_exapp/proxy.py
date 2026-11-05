"""Strict server-side API proxy configuration and header isolation.

Never forward the Nextcloud AppAPI authorization secret or browser credentials
to the core service. The core API key exists only in the ExApp container.
"""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote, unquote, urlsplit
import re


@dataclass(frozen=True)
class ProxySettings:
    origin: str
    token: str

    @classmethod
    def validate(
        cls, url: str, token: str, *, allow_http: bool = False
    ) -> "ProxySettings":
        if not isinstance(url, str) or len(url) > 2048:
            raise ValueError("DOWNLOADER_API_URL must be a valid URL")
        if any(ord(c) < 32 or c == "\\" for c in url):
            raise ValueError("Invalid downloader origin URL")
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("Invalid downloader origin port") from exc
        if parsed.scheme not in ({"https", "http"} if allow_http else {"https"}):
            raise ValueError("Downloader origin requires HTTPS (or explicit trusted HTTP opt-in)")
        if (
            not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or parsed.path not in ("", "/") or port == 0
            or parsed.netloc.endswith(":") or "%" in parsed.netloc
        ):
            raise ValueError("Downloader origin must be a plain HTTPS host and optional port")
        if not isinstance(token, str) or not 32 <= len(token) <= 512:
            raise ValueError("DOWNLOADER_API_TOKEN must be a long secret")
        if "\n" in token or "\r" in token:
            raise ValueError("DOWNLOADER_API_TOKEN contains invalid characters")
        return cls(url.rstrip("/"), token)


def safe_upstream_headers(content_type: str | None, token: str) -> dict[str, str]:
    """Allow only needed media types; never forward inbound auth/cookie headers."""
    result = {"X-API-Key": token}
    if content_type:
        normalized = content_type.lower().split(";", 1)[0].strip()
        if normalized in ("application/json", "application/octet-stream"):
            result["Content-Type"] = content_type
    return result


RESPONSE_HEADERS = frozenset({"content-type", "cache-control", "content-disposition"})


def upstream_api_url(origin: str, path: str, query: str = "") -> str:
    """Build a fixed-origin API URL without traversal or alternate-authority paths.

    ASGI already decodes request paths once. Check additional decoding rounds to
    reject encoded separators/traversal before re-encoding path characters.
    """
    if not isinstance(path, str) or not path or len(path) > 4096:
        raise ValueError("Invalid API path")
    for candidate in (path, unquote(path), unquote(unquote(path))):
        if (
            candidate.startswith("/")
            or any(part in ("", ".", "..") for part in candidate.split("/"))
            or any(ch in candidate for ch in ("\\", "?", "#"))
            or any(ord(ch) < 32 or ord(ch) == 127 for ch in candidate)
        ):
            raise ValueError("Invalid API path")
    if not isinstance(query, str) or len(query) > 8192 or any(
        ord(ch) < 32 or ord(ch) == 127 or ch == "#" for ch in query
    ):
        raise ValueError("Invalid API query")
    encoded_path = quote(path, safe="/-._~")
    return f"{origin}/api/v1/{encoded_path}" + (f"?{query}" if query else "")


def is_events_route(path: str) -> bool:
    """SSE subscriptions intentionally outlive normal API read timeouts."""
    return re.fullmatch(r"jobs/[^/]+/events", path) is not None
