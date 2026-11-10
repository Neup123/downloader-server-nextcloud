"""Thin Nextcloud AppAPI gateway with separate administrator and user APIs.

The downloader is a separate, independently deployed core service. The
Nextcloud-facing bridge does not run CLI engines, jobs or file transfers.
"""
from __future__ import annotations

import os
import asyncio
import re
import json
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from nc_py_api.ex_app import AppAPIAuthMiddleware, run_app, set_handlers
from nc_py_api.nextcloud import AsyncNextcloudApp

from nextcloud_exapp.user import (
    UserContext, require_user, require_admin, admin_files_connection_status, read_user_preferences,
    write_user_preferences, read_user_presets, save_user_preset, delete_user_preset,
    normalize_shared_presets, SHARED_PRESET_PREFIX, built_in_presets, validate_folder,
    is_administrator, validate_preset_id_list, read_preset_id_list,
    read_admin_presets, save_admin_presets, validate_admin_preset,
    read_admin_preset_config, ADMIN_ORDER_KEY, ADMIN_HIDDEN_KEY, order_presets,
    job_submission, own_job, own_job_provenance, scoped_cookie_filename,
    unscoped_cookie_filename,
)
from nextcloud_exapp.tracking import JobTracker
from nextcloud_exapp.search_index import update_index
from nextcloud_exapp.onboarding import reconcile_first_verified
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


async def enabled_handler(enabled: bool, nc: AsyncNextcloudApp) -> str:
    """Remove obsolete raw personal form; native PHP bridge hosts it instead.

    The administrator-only entitlement form remains declarative. The per-user
    settings API is still authoritative and exclusively signed by AppAPI.
    """
    try:
        await nc.ui.settings.unregister_form("downloader_user_preferences")
    except Exception:
        # The old form may never have been registered on a fresh install.
        pass
    admin_form = {
        "id": "downloader_admin_access", "section_type": "admin",
        "section_id": "declarative_settings", "title": "Downloader access",
        "description": "Assign entitlement by Nextcloud user IDs and/or group IDs; leave blank to deny.",
        "fields": [
            {"id": "allowed_users", "title": "Entitled user IDs (comma separated)",
             "type": "text", "default": ""},
            {"id": "allowed_groups", "title": "Entitled group IDs (comma separated)",
             "type": "text", "default": ""},
        ],
    }
    if enabled:
        await nc.ui.settings.register_form(admin_form)
    else:
        await nc.ui.settings.unregister_form(admin_form["id"])
    return ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    config()  # Fail closed before enabling any app-facing routes.
    set_handlers(app, enabled_handler)
    tracker = JobTracker()
    app.state.job_tracker = tracker

    async def fetch_for_notifications(identifier: str) -> dict:
        return await core_json("GET", "jobs/" + identifier)

    task = asyncio.create_task(tracker.monitor(fetch_for_notifications), name="downloader-notifications")
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


APP = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
APP.add_middleware(AppAPIAuthMiddleware)

DIST = Path(__file__).parent / "dist"
if DIST.is_dir():
    APP.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@APP.get("/")
async def dashboard(_admin: UserContext = Depends(require_admin)):
    # Administer service access in Nextcloud, never a standalone Core UI.
    # Core URL and token are installed in AppAPI configuration server-side.
    return RedirectResponse(
        url="/settings/admin/declarative_settings", status_code=303,
        headers={"Cache-Control": "no-store"},
    )


@APP.get("/api-reference")
async def reference(_admin: UserContext = Depends(require_admin)):
    # Legacy HTML API-reference entry must not open a separate raw UI.
    return RedirectResponse(
        url="/settings/admin/declarative_settings", status_code=303,
        headers={"Cache-Control": "no-store"},
    )


@APP.api_route(
    "/api/v1/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"]
)
async def proxy_api(path: str, request: Request,
                    _admin: UserContext = Depends(require_admin)):
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




# --- Per-user API. Never forward arbitrary /api/v1 paths to normal users. ---

def scoped_core_path(identifier: str) -> str:
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Fa-f0-9-]{36}", identifier):
        raise HTTPException(status_code=404, detail="Download not found")
    return identifier


async def core_json(method: str, path: str, *, payload: dict | None = None,
                    params: dict[str, str | int] | None = None):
    settings = config()
    try:
        url = upstream_api_url(settings.origin, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid core API route") from exc
    try:
        async with httpx.AsyncClient(timeout=45.0, follow_redirects=False, trust_env=False) as client:
            response = await client.request(
                method, url, headers=safe_upstream_headers("application/json", settings.token),
                json=payload, params=params,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Downloader service is unavailable") from exc
    if response.is_redirect:
        raise HTTPException(status_code=502, detail="Unexpected downloader redirect")
    try:
        body = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Invalid downloader response")
    if response.status_code >= 400:
        detail = body.get("detail", "Downloader request failed") if isinstance(body, dict) else "Downloader request failed"
        # These errors originate from the core, which never returns the ExApp secret.
        raise HTTPException(status_code=response.status_code, detail=str(detail)[:500])
    return body


@APP.get("/user/")
async def user_page(request: Request):
    # Preserve the AppAPI signed-identity check, while sending permitted and
    # not-entitled users into Nextcloud's own chrome for the correct access UI.
    # An unsigned request still fails authentication (never a public redirect
    # bypass to user API data).
    try:
        await require_user(request)
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
    # AppAPI supplies NEXTCLOUD_URL for this installation. An absolute
    # Location is essential: relative redirects get rewritten into the ExApp
    # proxy prefix and never reach Nextcloud's native PHP Library route.
    base_url = os.environ.get("NEXTCLOUD_URL", "").strip().rstrip("/")
    try:
        parsed = urlsplit(base_url)
        valid = (parsed.scheme in ("https", "http") and bool(parsed.hostname)
                 and not parsed.username and not parsed.password
                 and not parsed.query and not parsed.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=503, detail="Nextcloud base URL unavailable")
    return RedirectResponse(
        url=base_url + "/apps/downloader_bridge/library", status_code=303,
        headers={"Cache-Control": "no-store"},
    )


@APP.get("/user/api/me")
async def user_me(context: UserContext = Depends(require_user)):
    return {"user_id": context.user_id, "entitled": True}


@APP.get("/user/api/preset-permissions")
async def user_preset_permissions(context: UserContext = Depends(require_user)):
    """Separate capability route preserves the established /me contract."""
    return {"can_manage_presets": await is_administrator(context)}


@APP.get("/user/api/folders")
async def user_folders(path: str = "", offset: int = 0,
                       context: UserContext = Depends(require_user)):
    """Browse existing folders in the signed Nextcloud user's own Files.

    No arbitrary user ID, local path or Core credential is accepted. This is a
    read-only picker, not a Files-wide listing or folder creation endpoint.
    """
    folder = validate_folder(path)
    if not 0 <= offset <= 10000:
        raise HTTPException(status_code=422, detail="Invalid folder page")
    try:
        nodes = await context.nc.files.listdir("/" + folder if folder else "/")
    except Exception as exc:
        raise HTTPException(
            status_code=409, detail="Cannot browse this folder in your Nextcloud Files"
        ) from exc
    expected_prefix = folder + "/" if folder else ""
    choices: dict[str, dict[str, str]] = {}
    for node in nodes:
        if not getattr(node, "is_dir", False):
            continue
        raw = getattr(node, "user_path", None)
        if not isinstance(raw, str):
            continue
        try:
            child = validate_folder(raw)
        except HTTPException:
            continue
        if not child.startswith(expected_prefix):
            continue
        name = child[len(expected_prefix):]
        if not name or "/" in name:
            continue
        choices[child] = {"name": name, "path": child}
    rows = sorted(choices.values(), key=lambda item: item["name"].casefold())
    page = rows[offset:offset + 100]
    return {
        "path": folder, "folders": page, "offset": offset,
        "has_more": len(rows) > offset + len(page),
    }


@APP.get("/user/api/settings")
async def user_settings(context: UserContext = Depends(require_user)):
    return await read_user_preferences(context)


@APP.put("/user/api/settings")
async def update_user_settings(request: Request, context: UserContext = Depends(require_user)):
    return await write_user_preferences(context, await request.json())


@APP.get("/user/api/engines")
async def user_engines(context: UserContext = Depends(require_user)):
    return await core_json("GET", "engines")


async def read_shared_presets() -> list[dict]:
    """Fetch only the administrator-approved Core collection, never all presets.

    A still-deployed v0.3.1 Core lacks this endpoint; personal presets must
    keep functioning during a staged upgrade. Other upstream errors propagate.
    """
    try:
        approved = await core_json("GET", "presets/shared")
    except HTTPException as exc:
        if exc.status_code == 404:
            return []
        raise
    return normalize_shared_presets(approved)


async def selected_shared_presets(context: UserContext, data: dict) -> list[dict]:
    if not isinstance(data, dict):
        return []
    requested = data.get("preset_id")
    if not requested:
        requested = await context.nc.preferences_ex.get_value("default_preset", "")
    if isinstance(requested, str) and requested.startswith(SHARED_PRESET_PREFIX):
        return await read_shared_presets()
    return []



async def complete_preset_catalog(context: UserContext) -> list[dict]:
    """Shared administrator catalogue first, plus read-only legacy personal entries."""
    global_order = validate_preset_id_list(
        await read_admin_preset_config(context.nc, ADMIN_ORDER_KEY))
    global_hidden = validate_preset_id_list(
        await read_admin_preset_config(context.nc, ADMIN_HIDDEN_KEY))
    personal = [{**item, "is_shared": False, "is_legacy_personal": True}
                for item in await read_user_presets(context)]
    rows = built_in_presets() + await read_admin_presets(context.nc) + await read_shared_presets() + personal
    return order_presets(rows, global_order, global_hidden)


@APP.get("/user/api/presets")
async def user_presets(include_hidden: bool = False,
                       context: UserContext = Depends(require_user)):
    """One catalogue for Files actions, default selector, and individual widgets."""
    rows = await complete_preset_catalog(context)
    prefs = context.nc.preferences_ex
    own_order = await read_preset_id_list(prefs, "preset_order")
    own_hidden = await read_preset_id_list(prefs, "preset_hidden")
    rows = order_presets(rows, own_order, [] if include_hidden else own_hidden)
    return [{**row, "is_hidden": row["id"] in own_hidden} for row in rows]


# Old personal preset mutation paths are deliberately denied. A regular user
# may change only their own order/hidden preferences, not preset definitions.
@APP.post("/user/api/presets", status_code=403)
async def create_user_preset(context: UserContext = Depends(require_user)):
    raise HTTPException(status_code=403, detail="Only Nextcloud administrators manage presets")


@APP.put("/user/api/presets/{preset_id}", status_code=403)
async def update_user_preset(preset_id: str, context: UserContext = Depends(require_user)):
    raise HTTPException(status_code=403, detail="Only Nextcloud administrators manage presets")


@APP.delete("/user/api/presets/{preset_id}", status_code=403)
async def remove_user_preset(preset_id: str, context: UserContext = Depends(require_user)):
    raise HTTPException(status_code=403, detail="Only Nextcloud administrators manage presets")


@APP.get("/admin/api/preset-catalog")
async def admin_preset_catalog(admin: UserContext = Depends(require_admin)):
    """Admin-only global order and exclusion controls; no user-private data."""
    return {
        "presets": built_in_presets() + await read_admin_presets(admin.nc) + await read_shared_presets(),
        "order": await read_admin_preset_config(admin.nc, ADMIN_ORDER_KEY),
        "hidden": await read_admin_preset_config(admin.nc, ADMIN_HIDDEN_KEY),
    }


@APP.put("/admin/api/preset-catalog")
async def update_admin_preset_catalog(request: Request,
                                      admin: UserContext = Depends(require_admin)):
    body = await request.json()
    if not isinstance(body, dict) or set(body) != {"order", "hidden"}:
        raise HTTPException(status_code=422, detail="Invalid preset catalogue layout")
    order = validate_preset_id_list(body["order"])
    hidden = validate_preset_id_list(body["hidden"])
    available = {row["id"] for row in (built_in_presets()
                 + await read_admin_presets(admin.nc) + await read_shared_presets())}
    if (set(order) | set(hidden)) - available:
        raise HTTPException(status_code=422, detail="Unknown shared preset")
    await admin.nc.appconfig_ex.set_value(ADMIN_ORDER_KEY, json.dumps(order))
    await admin.nc.appconfig_ex.set_value(ADMIN_HIDDEN_KEY, json.dumps(hidden))
    return await admin_preset_catalog(admin)


@APP.post("/admin/api/presets", status_code=201)
async def create_admin_preset(request: Request,
                              admin: UserContext = Depends(require_admin)):
    from uuid import uuid4
    item = validate_admin_preset(await request.json())
    item.update({"id": "admin:" + str(uuid4()), "is_shared": True, "is_admin_managed": True})
    rows = await read_admin_presets(admin.nc)
    rows.append(item)
    await save_admin_presets(admin.nc, rows)
    return item


@APP.put("/admin/api/presets/{preset_id}")
async def update_admin_preset(preset_id: str, request: Request,
                              admin: UserContext = Depends(require_admin)):
    rows = await read_admin_presets(admin.nc)
    if not any(item["id"] == preset_id for item in rows):
        raise HTTPException(status_code=404, detail="Managed preset not found")
    item = {**validate_admin_preset(await request.json()), "id": preset_id,
            "is_shared": True, "is_admin_managed": True}
    await save_admin_presets(admin.nc, [item if old["id"] == preset_id else old for old in rows])
    return item


@APP.delete("/admin/api/presets/{preset_id}")
async def delete_admin_preset(preset_id: str,
                              admin: UserContext = Depends(require_admin)):
    rows = await read_admin_presets(admin.nc)
    if not any(item["id"] == preset_id for item in rows):
        raise HTTPException(status_code=404, detail="Managed preset not found")
    await save_admin_presets(admin.nc, [item for item in rows if item["id"] != preset_id])
    return {"deleted": True}


@APP.get("/user/api/provenance")
async def user_file_provenance(file_id: str, context: UserContext = Depends(require_user)):
    if not file_id.isdecimal() or len(file_id) > 32:
        raise HTTPException(status_code=422, detail="Invalid Nextcloud file ID")
    result = await core_json("GET", "provenance",
                             params={"owner_id": context.user_id, "file_id": file_id})
    return own_job_provenance(result, context.user_id)


@APP.post("/user/api/provenance/{file_id}/redownload", status_code=202)
async def user_redownload_source(file_id: str, request: Request,
                                context: UserContext = Depends(require_user)):
    if not file_id.isdecimal() or len(file_id) > 32:
        raise HTTPException(status_code=422, detail="Invalid Nextcloud file ID")
    provenance = own_job_provenance(
        await core_json("GET", "provenance",
                        params={"owner_id": context.user_id, "file_id": file_id}),
        context.user_id,
    )
    request_data = {"url": provenance["source_url"]}
    submitted = await job_submission(
        context, request_data,
        shared_presets=await selected_shared_presets(context, request_data),
    )
    job = await core_json("POST", "jobs", payload=submitted)
    own_job(job, context.user_id)
    request.app.state.job_tracker.add(job["id"], context.user_id)
    try:
        await update_index(context.nc, context.user_id, [job])
    except Exception:
        pass
    return job


async def hidden_history_ids(context: UserContext) -> set[str]:
    """A user's hidden history affects display only, never delivery or provenance."""
    try:
        ids = json.loads(await context.nc.preferences_ex.get_value("hidden_history", "[]"))
    except (TypeError, ValueError):
        return set()
    if not isinstance(ids, list):
        return set()
    return {value for value in ids if isinstance(value, str) and len(value) <= 100}


@APP.post("/user/api/jobs/{job_id}/hide")
async def hide_user_job(job_id: str, context: UserContext = Depends(require_user)):
    identifier = scoped_core_path(job_id)
    own_job(await core_json("GET", "jobs/" + identifier), context.user_id)
    hidden = await hidden_history_ids(context)
    hidden.add(identifier)
    if len(hidden) > 2000:
        raise HTTPException(status_code=422, detail="History limit reached")
    await context.nc.preferences_ex.set_value("hidden_history", json.dumps(sorted(hidden)))
    return {"hidden": True}


@APP.get("/user/api/jobs")
async def user_jobs(limit: int = 50, status: str | None = None,
                    offset: int = 0, q: str = "", state: str = "all",
                    context: UserContext = Depends(require_user)):
    if not 1 <= limit <= 200 or not 0 <= offset <= 10000:
        raise HTTPException(status_code=422, detail="Invalid downloads page")
    if state not in {"all", "active", "delivered", "failed"} or len(q) > 128:
        raise HTTPException(status_code=422, detail="Invalid Library filter")
    params = {"owner_id": context.user_id, "limit": limit, "offset": offset,
              "state": state, "q": q}
    if status:
        params["status"] = status
    rows = await core_json("GET", "jobs", params=params)
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="Invalid download list")
    hidden = await hidden_history_ids(context)
    owned = [own_job(row, context.user_id) for row in rows if row.get('id') not in hidden]
    # Reconcile legacy/paginated history; the durable tracker also marks
    # first completion without requiring a history GET or an open browser.
    try:
        await reconcile_first_verified(context.nc, context.user_id, owned)
    except Exception:
        pass  # Onboarding preferences cannot prevent history retrieval.
    try:
        await update_index(context.nc, context.user_id, owned)
    except Exception:
        # Search indexing must never block jobs or their delivery.
        pass
    return owned


async def _visible_owner_jobs(context: UserContext, state: str) -> list[dict]:
    """Retrieve a bounded snapshot of own jobs; no cross-user bulk operations."""
    owned: list[dict] = []
    for offset in range(0, 2000, 200):
        rows = await core_json("GET", "jobs", params={
            "owner_id": context.user_id, "limit": 200, "offset": offset,
            "state": state,
        })
        if not isinstance(rows, list):
            raise HTTPException(status_code=502, detail="Invalid download history")
        owned.extend(own_job(job, context.user_id) for job in rows)
        if len(rows) < 200:
            break
    else:
        raise HTTPException(status_code=422, detail="Too many downloads to update together")
    return owned


@APP.get("/user/api/library")
async def user_library(limit: int = 50, offset: int = 0, q: str = "",
                       state: str = "all",
                       context: UserContext = Depends(require_user)):
    """Cursored own-job Library for native Nextcloud page.

    The cursor counts underlying owned jobs rather than visible/hidden jobs,
    ensuring a page full of hidden records never conceals later results.
    """
    if not 1 <= limit <= 200 or not 0 <= offset <= 10000 or len(q) > 128:
        raise HTTPException(status_code=422, detail="Invalid Library page")
    if state not in {"all", "active", "delivered", "failed"}:
        raise HTTPException(status_code=422, detail="Invalid status filter")
    params = {"owner_id": context.user_id, "limit": limit, "offset": offset,
              "q": q, "state": state}
    rows = await core_json("GET", "jobs", params=params)
    if not isinstance(rows, list):
        raise HTTPException(status_code=502, detail="Invalid downloads list")
    hidden = await hidden_history_ids(context)
    owned = [own_job(job, context.user_id) for job in rows if job.get("id") not in hidden]
    return {"jobs": owned, "next_offset": offset + len(rows) if len(rows) == limit else None}


@APP.post("/user/api/jobs/retry-failed")
async def retry_owner_failed(request: Request, context: UserContext = Depends(require_user)):
    failed = await _visible_owner_jobs(context, "failed")
    results = []
    for job in failed:
        identifier = scoped_core_path(job["id"])
        # Current owner/status is rechecked to prevent stale bulk retries.
        current = own_job(await core_json("GET", "jobs/" + identifier), context.user_id)
        if current.get("status") not in {"failed", "cancelled"}:
            continue
        response = await core_json("POST", "jobs/" + identifier + "/retry")
        own_job(response, context.user_id)
        request.app.state.job_tracker.reset(identifier)
        results.append(identifier)
    return {"retried": len(results)}


@APP.post("/user/api/jobs/clear-history")
async def clear_owner_history(request: Request, context: UserContext = Depends(require_user)):
    data = await request.json()
    if not isinstance(data, dict) or data.get("confirm") is not True:
        raise HTTPException(status_code=422, detail="Confirm clearing history explicitly")
    completed = await _visible_owner_jobs(context, "delivered")
    failures = await _visible_owner_jobs(context, "failed")
    hidden = await hidden_history_ids(context)
    hidden.update(job["id"] for job in completed + failures)
    if len(hidden) > 2000:
        raise HTTPException(status_code=422, detail="Too many history entries to clear")
    await context.nc.preferences_ex.set_value("hidden_history", json.dumps(sorted(hidden)))
    return {"hidden": len(completed) + len(failures), "files_retained": True}


@APP.post("/user/api/jobs", status_code=202)
async def user_submit(request: Request, context: UserContext = Depends(require_user)):
    data = await request.json()
    request_body = await job_submission(
        context, data, shared_presets=await selected_shared_presets(context, data),
    )
    job = await core_json("POST", "jobs", payload=request_body)
    own_job(job, context.user_id)
    request.app.state.job_tracker.add(job["id"], context.user_id)
    try:
        await update_index(context.nc, context.user_id, [job])
    except Exception:
        pass
    return job


@APP.get("/user/api/jobs/{job_id}")
async def user_get_job(job_id: str, context: UserContext = Depends(require_user)):
    job = await core_json("GET", "jobs/" + scoped_core_path(job_id))
    return own_job(job, context.user_id)


@APP.post("/user/api/jobs/{job_id}/{action}", status_code=202)
async def user_job_action(job_id: str, action: str, request: Request,
                          context: UserContext = Depends(require_user)):
    if action not in {"cancel", "retry", "redeliver", "pause", "resume"}:
        raise HTTPException(status_code=404, detail="Unknown action")
    identifier = scoped_core_path(job_id)
    own_job(await core_json("GET", "jobs/" + identifier), context.user_id)
    response = await core_json("POST", "jobs/" + identifier + "/" + action)
    own_job(response, context.user_id)
    if action in ("retry", "redeliver"):
        request.app.state.job_tracker.reset(identifier)
    return response


@APP.get("/user/api/cookies")
async def user_cookies(context: UserContext = Depends(require_user)):
    files = await core_json("GET", "cookies")
    return [
        {**cookie, "filename": visible}
        for cookie in files if isinstance(cookie, dict)
        if (visible := unscoped_cookie_filename(context.user_id, str(cookie.get("filename", "")))) is not None
    ]


@APP.put("/user/api/cookies/{filename}")
async def user_cookie_upload(filename: str, request: Request,
                             context: UserContext = Depends(require_user)):
    name = scoped_cookie_filename(context.user_id, filename)
    data = await request.json()
    if not isinstance(data, dict) or not isinstance(data.get("content_base64"), str):
        raise HTTPException(status_code=422, detail="Invalid cookie file content")
    if len(data["content_base64"]) > 1_400_000:
        raise HTTPException(status_code=413, detail="Cookie file is too large")
    response = await core_json("PUT", "cookies/" + name, payload={"content_base64": data["content_base64"]})
    return {**response, "filename": filename}


@APP.delete("/user/api/cookies/{filename}")
async def user_cookie_delete(filename: str, context: UserContext = Depends(require_user)):
    name = scoped_cookie_filename(context.user_id, filename)
    return await core_json("DELETE", "cookies/" + name)


@APP.get("/admin/api/connection")
async def admin_connection_status(admin: UserContext = Depends(require_admin)):
    """Verify the actual core connection without ever sending its key to the browser."""
    settings = config()
    try:
        engines = await core_json("GET", "engines")
        if not isinstance(engines, list):
            raise HTTPException(status_code=502, detail="Invalid core engine response")
        ready = sum(1 for item in engines if isinstance(item, dict) and item.get("installed") is True)
        return {
            "connected": True, "core_origin": settings.origin,
            "token_configured": True, "engines_ready": ready,
            "message": "Connected to Downloader Server",
        }
    except HTTPException:
        # Preserve admin-only visibility of the configured origin, but do not
        # return upstream error bodies, token contents, or internal traces.
        return {
            "connected": False, "core_origin": settings.origin,
            "token_configured": True, "engines_ready": 0,
            "message": "Cannot reach Downloader Server with the configured credentials",
        }


@APP.get("/admin/api/files-connections")
async def admin_read_files_connections(admin: UserContext = Depends(require_admin)):
    """Read-only administrator visibility, with no app password returned."""
    return await admin_files_connection_status(admin)


@APP.get("/admin/api/entitlements")
async def admin_read_entitlements(admin: UserContext = Depends(require_admin)):
    nc = admin.nc
    return {
        "allowed_users": await nc.appconfig_ex.get_value("allowed_users", ""),
        "allowed_groups": await nc.appconfig_ex.get_value("allowed_groups", ""),
    }


@APP.put("/admin/api/entitlements")
async def admin_write_entitlements(request: Request,
                                   admin: UserContext = Depends(require_admin)):
    body = await request.json()
    if not isinstance(body, dict) or set(body) - {"allowed_users", "allowed_groups"}:
        raise HTTPException(status_code=422, detail="Invalid entitlement list")
    # Validate the entire patch before modifying any administrator settings.
    if any(not isinstance(value, str) or len(value) > 10000 for value in body.values()):
        raise HTTPException(status_code=422, detail="Invalid entitlement list")
    for key in ("allowed_users", "allowed_groups"):
        if key in body:
            await admin.nc.appconfig_ex.set_value(key, body[key])
    return await admin_read_entitlements(admin)

if __name__ == "__main__":
    # Routes are registered at import time before the ASGI server is started.
    run_app("nextcloud_exapp.main:APP")
