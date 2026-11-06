"""Owner-scoped Nextcloud gateway: identity, entitlement and personal preferences.

Every authenticated caller is derived from the signed AppAPI identity. The only
download executor is the standalone core. Browser requests never receive the
service API token or another user's WebDAV credentials.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, Request
from nc_py_api.nextcloud import AsyncNextcloudApp

DEFAULT_FOLDER = "Downloads"
TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})
ENGINES = frozenset({"yt-dlp", "aria2c", "gallery-dl", "generic", "you-get", "svtplay-dl", "get-sauce"})
PRIVILEGED_CORE_ROUTES = frozenset({"settings", "delivery", "cookies", "engine-rules"})


@dataclass
class UserContext:
    user_id: str
    nc: AsyncNextcloudApp


def signed_user(request: Request) -> str:
    """Only the AppAPI signature middleware may populate the trusted scope."""
    user = request.scope.get("username")
    if not isinstance(user, str) or not user or len(user) > 255:
        raise HTTPException(status_code=401, detail="Signed Nextcloud identity required")
    return user


def validate_folder(folder: str) -> str:
    if not isinstance(folder, str) or len(folder) > 512:
        raise HTTPException(status_code=422, detail="Destination must be a folder path")
    clean = folder.strip().strip("/")
    if not clean:
        return ""
    if (
        "\\" in clean
        or "\x00" in clean
        or any(ord(char) < 32 for char in clean)
        or any(part in ("", ".", "..") for part in clean.split("/"))
    ):
        raise HTTPException(status_code=422, detail="Destination contains invalid path segments")
    return clean


def parse_entitlements(value: str | None) -> set[str]:
    return {token for token in re.split(r"[,\n\r]+", value or "") if (token := token.strip())}


async def entitlement(nc: AsyncNextcloudApp, user_id: str) -> bool:
    """The administrator grants individual IDs or group IDs in AppAPI admin settings."""
    allowed_users = parse_entitlements(await nc.appconfig_ex.get_value("allowed_users", ""))
    if user_id in allowed_users:
        return True
    allowed_groups = parse_entitlements(await nc.appconfig_ex.get_value("allowed_groups", ""))
    if not allowed_groups:
        return False
    try:
        info = await nc.users.get_user(user_id)
    except Exception:
        # Group membership cannot be established; never grant by guess.
        return False
    return bool(allowed_groups.intersection(info.groups))


async def require_user(request: Request) -> UserContext:
    user_id = signed_user(request)
    nc = AsyncNextcloudApp(user=user_id)
    if not await entitlement(nc, user_id):
        raise HTTPException(status_code=403, detail="Downloader is not enabled for your Nextcloud account")
    return UserContext(user_id, nc)


async def read_user_preferences(context: UserContext) -> dict[str, Any]:
    preferences = context.nc.preferences_ex
    folder = validate_folder(await preferences.get_value("destination_folder", DEFAULT_FOLDER))
    preset = await preferences.get_value("default_preset", "")
    engines_json = await preferences.get_value("engine_settings", "{}")
    try:
        settings = json.loads(engines_json or "{}")
    except (TypeError, ValueError):
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    return {
        "destination_folder": folder,
        "default_preset": preset or "",
        "engine_settings": {name: options for name, options in settings.items()
                            if name in ENGINES and isinstance(options, dict)},
        "app_password_configured": bool(await preferences.get_value("dav_app_password", "")),
    }


async def write_user_preferences(context: UserContext, patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="Invalid personal settings")
    allowed = {"destination_folder", "default_preset", "engine_settings", "app_password"}
    if set(patch) - allowed:
        raise HTTPException(status_code=422, detail="Unknown personal setting")
    pref = context.nc.preferences_ex
    if "destination_folder" in patch:
        folder = validate_folder(patch["destination_folder"])
        await pref.set_value("destination_folder", folder)
    if "default_preset" in patch:
        value = patch["default_preset"]
        if not isinstance(value, str) or len(value) > 36:
            raise HTTPException(status_code=422, detail="Invalid preset")
        await pref.set_value("default_preset", value)
    if "engine_settings" in patch:
        settings = patch["engine_settings"]
        if (
            not isinstance(settings, dict)
            or any(name not in ENGINES or not isinstance(values, dict) for name, values in settings.items())
            or len(json.dumps(settings)) > 16000
        ):
            raise HTTPException(status_code=422, detail="Invalid per-engine preferences")
        await pref.set_value("engine_settings", json.dumps(settings, separators=(",", ":")))
    if "app_password" in patch:
        password = patch["app_password"]
        if not isinstance(password, str) or len(password) > 1024:
            raise HTTPException(status_code=422, detail="Invalid Nextcloud app password")
        if password:
            await pref.set_value("dav_app_password", password, sensitive=True)
        else:
            await pref.delete("dav_app_password")
    return await read_user_preferences(context)


async def job_submission(context: UserContext, data: dict[str, Any]) -> dict[str, Any]:
    """Creates a privileged core request; caller-supplied owner/delivery ignored."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Invalid download job")
    allowed = {"url", "engine", "preset_id", "overrides", "folder"}
    if set(data) - allowed:
        raise HTTPException(status_code=422, detail="Unsupported job field")
    source = data.get("url")
    if not isinstance(source, str) or len(source) > 4096 or len(source) < 8:
        raise HTTPException(status_code=422, detail="Paste a valid source URL")
    prefs = await read_user_preferences(context)
    password = await context.nc.preferences_ex.get_value("dav_app_password", "")
    if not password:
        raise HTTPException(status_code=409, detail="Connect your Nextcloud Files app password in personal settings first")
    folder = validate_folder(data.get("folder", prefs["destination_folder"]))
    default_preset = prefs["default_preset"]
    engine = data.get("engine", "auto")
    if engine not in ENGINES and engine != "auto":
        raise HTTPException(status_code=422, detail="Unsupported engine")
    options = data.get("overrides", {})
    if not isinstance(options, dict) or len(json.dumps(options)) > 16000:
        raise HTTPException(status_code=422, detail="Invalid engine overrides")
    chosen = prefs["engine_settings"].get(engine, {})
    overrides = {**chosen, **options}
    # Replace user-visible cookie filenames with the own user's opaque core key.
    for option in ("cookies_file",):
        if overrides.get(option):
            overrides[option] = scoped_cookie_filename(context.user_id, str(overrides[option]))
    try:
        node = await context.nc.files.by_path("/" + folder if folder else "/")
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Cannot open destination folder in Nextcloud Files") from exc
    if node is None or (hasattr(node, "is_dir") and not node.is_dir):
        raise HTTPException(status_code=409, detail="Destination folder is missing; choose an existing folder")
    # Derive the user Files origin from the AppAPI-supplied server URL, never the browser.
    nc_root = context.nc.app_cfg.dav_endpoint.rstrip("/")
    return {
        "url": source,
        "engine": engine,
        "preset_id": data.get("preset_id") or default_preset or None,
        "overrides": overrides,
        "owner_id": context.user_id,
        "delivery": {
            "mode": "webdav",
            "webdav_url": nc_root + "/files/" + quote(context.user_id, safe=""),
            "username": context.user_id,
            "app_password": password,
            "folder": folder,
        },
    }


def own_job(data: Any, owner_id: str) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("owner_id") != owner_id:
        raise HTTPException(status_code=404, detail="Download not found")
    return data


def scoped_cookie_filename(user_id: str, visible_filename: str) -> str:
    basename = PurePosixPath(visible_filename).name
    if (
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}", basename)
        or ".." in basename
        or visible_filename != basename
    ):
        raise HTTPException(status_code=422, detail="Invalid cookie file name")
    digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]
    return f"nc-{digest}-{basename}"


def unscoped_cookie_filename(user_id: str, stored_filename: str) -> str | None:
    prefix = "nc-" + hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24] + "-"
    return stored_filename[len(prefix):] if stored_filename.startswith(prefix) else None


def delivery_notification(job: dict[str, Any]) -> tuple[str, str]:
    """The user sees a direct remedy, not an opaque error buried in logs."""
    if job.get("status") == "completed":
        return "Download complete", "Your download is available in Nextcloud Files."
    error = str(job.get("error") or "")
    lowered = error.lower()
    if "quota" in lowered or "507" in lowered:
        return "Download could not be saved", "Nextcloud Files quota exceeded. Free space or request more storage, then retry the download."
    if "not writable" in lowered or "403" in lowered or "permission" in lowered:
        return "Download could not be saved", "Destination folder is not writable. Select a folder you can edit or request permission, then retry."
    if "missing" in lowered or "404" in lowered or "not found" in lowered:
        return "Download could not be saved", "Destination folder is missing. Restore it or choose another folder in Files, then retry."
    if job.get("status") == "cancelled":
        return "Download cancelled", "The download was cancelled."
    return "Download failed", (error[:300] or "Check your Downloader history for the reason and retry.")
