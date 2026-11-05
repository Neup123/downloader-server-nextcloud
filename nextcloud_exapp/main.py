"""Thin, administrator-only Nextcloud AppAPI gateway for Downloader Server.

The downloader is a separate, independently deployed core service. The
Nextcloud-facing bridge does not run CLI engines, jobs or file transfers.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from nc_py_api.ex_app import AppAPIAuthMiddleware, run_app, set_handlers

from nextcloud_exapp.proxy import (
    ProxySettings, RESPONSE_HEADERS, is_events_route, safe_upstream_headers,
    upstream_api_url,
)


def config() -> ProxySettings:
    try:
        return ProxySettings.validate(
            os.environ.get("DOWNLOADER_API_URL", ""),
            os.environ.get("DOWNLOADER_API_TOKEN", ""),
            allow_http=os.environ.get("DOWNLOADER_ALLOW_TRUSTED_HTTP") == "true",
        )
    except ValueError as exc:
        # Never log the URL/token contents or echo credentials in API responses.
        raise RuntimeError("Downloader Server ExApp origin configuration is invalid") from exc


def enabled_handler(enabled: bool, _nc) -> str:
    """AppAPI lifecycle callback. Never expose the downloader core secret."""
    return ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    config()  # Fail closed before enabling any app-facing routes.
    set_handlers(app, enabled_handler)
    yield


APP = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
APP.add_middleware(AppAPIAuthMiddleware)

DIST = Path(__file__).parent / "dist"
if DIST.is_dir():
    APP.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@APP.get("/")
async def dashboard():
    return FileResponse(DIST / "index.html", media_type="text/html", headers={"Cache-Control": "no-store"})


@APP.get("/api-reference")
async def reference():
    return FileResponse(DIST / "api-reference.html", media_type="text/html", headers={"Cache-Control": "no-store"})


@APP.api_route(
    "/api/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"]
)
async def proxy_api(path: str, request: Request):
    settings = config()
    # Keep the upstream origin fixed, and reject ambiguous decoded paths.
    try:
        url = upstream_api_url(settings.origin, path, request.url.query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid API path or query") from exc
    headers = safe_upstream_headers(request.headers.get("content-type"), settings.token)
    headers["Accept"] = request.headers.get("accept", "application/json")
    headers["Accept-Encoding"] = "identity"
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=10.0, write=60.0, pool=10.0,
            read=None if is_events_route(path) else 60.0,
        ),
        trust_env=False,
        follow_redirects=False,
    )
    # Stream the upload rather than buffering potentially large cookie files.
    outgoing = client.build_request(
        request.method, url, headers=headers, content=request.stream()
    )
    try:
        upstream = await client.send(outgoing, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="Downloader Server is unavailable") from exc
    if upstream.is_redirect:
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail="Unexpected core API redirect")
    reply_headers = {
        name: value for name, value in upstream.headers.items()
        if name.lower() in RESPONSE_HEADERS
    }

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body(), status_code=upstream.status_code, headers=reply_headers,
    )


if __name__ == "__main__":
    run_app("nextcloud_exapp.main:APP")
