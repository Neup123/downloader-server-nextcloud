"""Owner-scoped Nextcloud gateway: identity, entitlement and personal preferences.

Every authenticated caller is derived from the signed AppAPI identity. The only
download executor is the standalone core. Browser requests never receive the
service API token or another user's WebDAV credentials.
"""
from __future__ import annotations

import hashlib
import asyncio
import os
import json
import re
from uuid import uuid4
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote, urlsplit

from fastapi import HTTPException, Request
from nc_py_api import NextcloudException
from nc_py_api.nextcloud import AsyncNextcloudApp

from nextcloud_exapp.job_state_contract import TERMINAL_STATES

DEFAULT_FOLDER = "Downloads"
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
    return {part.strip() for part in re.split(r"[,\n\r]+", value or "") if part.strip()}


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


async def require_admin(request: Request) -> UserContext:
    """Authorize privileged endpoints independently of AppAPI's ADMIN route ACL.

    AppAPI filters normal proxied requests by the manifest's ADMIN access
    level. This check also denies calls that reach the ExApp directly via its
    container network, without relying on an untrusted HTTP admin header.
    Nextcloud's reserved 'admin' group defines administrator membership.
    """
    user_id = signed_user(request)
    nc = AsyncNextcloudApp(user=user_id)
    try:
        info = await nc.users.get_user(user_id)
        groups = info.groups
    except Exception:
        # Inability to verify admin membership must never become access.
        raise HTTPException(status_code=403, detail="Nextcloud administrator required") from None
    if not isinstance(groups, (list, tuple, set, frozenset)) or "admin" not in groups:
        raise HTTPException(status_code=403, detail="Nextcloud administrator required")
    return UserContext(user_id, nc)


async def admin_files_connection_status(admin: UserContext) -> dict[str, Any]:
    """Admin-only readiness snapshot: explicit grants + entitled group members.

    A Nextcloud administrator may see whether a user connected Files, but
    never receives another user's saved WebDAV credential. Failed preference
    reads are unknown rather than wrongly reported as disconnected. The scan
    of group members is bounded to avoid overwhelming a large Nextcloud.
    """
    allowed_users = parse_entitlements(
        await admin.nc.appconfig_ex.get_value("allowed_users", "")
    )
    allowed_groups = parse_entitlements(
        await admin.nc.appconfig_ex.get_value("allowed_groups", "")
    )
    max_scanned = 250
    discovered: set[str] = set()
    scan_truncated = False
    directory_unavailable = False
    if allowed_groups:
        try:
            directory = await admin.nc.users_list()
            if not isinstance(directory, list) or any(
                not isinstance(uid, str) for uid in directory
            ):
                raise ValueError("Invalid Nextcloud user directory")
            # Even if the list is larger, do not claim all group members
            # were checked; the result carries an explicit partial flag.
            scan_truncated = len(directory) > max_scanned
            discovered = set(directory[:max_scanned])
        except Exception:
            directory_unavailable = True

    candidates = sorted(allowed_users | discovered)
    group_members: dict[str, list[str]] = {gid: [] for gid in allowed_groups}
    ready_users: dict[str, dict[str, Any]] = {}
    gate = asyncio.Semaphore(10)

    async def inspect_user(uid: str) -> None:
        async with gate:
            groups: list[str] = []
            group_known = False
            try:
                info = await admin.nc.users.get_user(uid)
                if isinstance(info.groups, (list, tuple)):
                    groups = [value for value in info.groups if isinstance(value, str)]
                    group_known = True
            except Exception:
                pass
            matching = sorted(allowed_groups.intersection(groups))
            if uid not in allowed_users and not matching:
                return
            # Do not mistake an unavailable membership lookup for a grant.
            if uid not in allowed_users and not group_known:
                return
            status = "unknown"
            try:
                personal = AsyncNextcloudApp(user=uid)
                stored = await personal.preferences_ex.get_value("dav_app_password", "")
                status = "connected" if bool(stored) else "not_connected"
            except Exception:
                pass
            ready_users[uid] = {
                "user_id": uid, "via_groups": matching,
                "explicit": uid in allowed_users, "connection": status,
            }
            for gid in matching:
                group_members[gid].append(uid)

    await asyncio.gather(*(inspect_user(uid) for uid in candidates))
    groups = []
    for name in sorted(allowed_groups):
        members = [ready_users[uid] for uid in group_members[name]]
        groups.append({
            "name": name,
            "members_checked": len(members),
            "connected": sum(item["connection"] == "connected" for item in members),
            "not_connected": sum(item["connection"] == "not_connected" for item in members),
            "unknown": sum(item["connection"] == "unknown" for item in members),
            "partial": scan_truncated or directory_unavailable,
        })
    return {
        "users": [ready_users[uid] for uid in sorted(ready_users)],
        "groups": groups,
        "partial": scan_truncated or directory_unavailable,
        "scan_limit": max_scanned,
    }


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
        "first_download_verified": await preferences.get_value("first_download_verified", "0") == "1",
        "notify_finished": await preferences.get_value("notify_finished", "1") != "0",
        "notify_failed": await preferences.get_value("notify_failed", "1") != "0",
        "header_indicator_visibility": await preferences.get_value("header_indicator_visibility", "active"),
        "dropdown_content": await preferences.get_value("dropdown_content", "active"),
        "preset_hidden": await read_preset_id_list(preferences, "preset_hidden"),
        "preset_order": await read_preset_id_list(preferences, "preset_order"),
    }


async def write_user_preferences(context: UserContext, patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="Invalid personal settings")
    allowed = {"destination_folder", "default_preset", "engine_settings", "app_password",
               "notify_finished", "notify_failed", "header_indicator_visibility",
               "dropdown_content", "preset_hidden", "preset_order"}
    if set(patch) - allowed:
        raise HTTPException(status_code=422, detail="Unknown personal setting")
    pref = context.nc.preferences_ex
    if "destination_folder" in patch:
        folder = validate_folder(patch["destination_folder"])
        await pref.set_value("destination_folder", folder)
    if "default_preset" in patch:
        value = patch["default_preset"]
        # Namespaced administrator-shared UUIDs ("shared:" + 36 chars) are
        # selectable, but other unbounded IDs remain invalid.
        if not isinstance(value, str) or len(value) > 64:
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
    for name in ("notify_finished", "notify_failed"):
        if name in patch:
            value = patch[name]
            if not isinstance(value, bool):
                raise HTTPException(status_code=422, detail="Notification preference must be on or off")
            await pref.set_value(name, "1" if value else "0")
    for name, choices in (
        ("header_indicator_visibility", {"active", "always"}),
        ("dropdown_content", {"active", "all"}),
    ):
        if name in patch:
            if not isinstance(patch[name], str) or patch[name] not in choices:
                raise HTTPException(status_code=422, detail="Invalid downloads display preference")
            await pref.set_value(name, patch[name])
    for name in ("preset_hidden", "preset_order"):
        if name in patch:
            ids = validate_preset_id_list(patch[name])
            await pref.set_value(name, json.dumps(ids, separators=(",", ":")))
    if "app_password" in patch:
        password = patch["app_password"]
        if not isinstance(password, str) or len(password) > 1024:
            raise HTTPException(status_code=422, detail="Invalid Nextcloud app password")
        if password:
            await pref.set_value("dav_app_password", password, sensitive=True)
        else:
            await pref.delete("dav_app_password")
    return await read_user_preferences(context)




def validate_preset_id_list(value: Any) -> list[str]:
    """Bound, deduplicate and validate the private ordering and hide list."""
    if (not isinstance(value, list) or len(value) > 300
            or any(not isinstance(item, str) or len(item) > 100 or not item
                   or any(ord(c) < 32 for c in item) for item in value)):
        raise HTTPException(status_code=422, detail="Invalid preset selection")
    return list(dict.fromkeys(value))


async def read_preset_id_list(preferences: Any, key: str) -> list[str]:
    try:
        value = json.loads(await preferences.get_value(key, "[]") or "[]")
        return validate_preset_id_list(value)
    except (ValueError, TypeError, HTTPException):
        return []


async def is_administrator(context: UserContext) -> bool:
    """Fail closed if Nextcloud administrator membership cannot be checked."""
    try:
        info = await context.nc.users.get_user(context.user_id)
        return isinstance(info.groups, (list, tuple, set, frozenset)) and "admin" in info.groups
    except Exception:
        return False


ADMIN_PRESETS_KEY = "admin_presets"
ADMIN_ORDER_KEY = "admin_preset_order"
ADMIN_HIDDEN_KEY = "admin_preset_hidden"


async def read_admin_preset_config(nc: AsyncNextcloudApp, key: str) -> list[Any]:
    try:
        value = json.loads(await nc.appconfig_ex.get_value(key, "[]") or "[]")
        return value if isinstance(value, list) else []
    except (TypeError, ValueError):
        return []


def validate_admin_preset(body: Any) -> dict[str, Any]:
    """Limit all custom options to safe predefined form selections."""
    if not isinstance(body, dict) or set(body) - {"name", "description", "engine", "format"}:
        raise HTTPException(status_code=422, detail="Invalid shared preset")
    name, description = body.get("name"), body.get("description", "")
    engine, fmt = body.get("engine"), body.get("format", "")
    allowed_formats = {
        "", "bv*+ba/b", "bv*[height<=1080]+ba/b[height<=1080]",
        "bv*[height<=720]+ba/b[height<=720]",
        "bv*[height<=480]+ba/b[height<=480]", "bestaudio/best",
        "bestaudio[ext=m4a]/bestaudio/best",
        "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
    }
    if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 120
            or not isinstance(description, str) or len(description) > 500
            or engine not in {"yt-dlp", "aria2c", "generic", "gallery-dl"}
            or not isinstance(fmt, str) or fmt not in allowed_formats
            or (engine != "yt-dlp" and fmt)):
        raise HTTPException(status_code=422, detail="Invalid shared preset fields")
    return {"name": name.strip(), "description": description.strip(),
            "engine": engine, "settings": {"format": fmt} if fmt else {}}


async def read_admin_presets(nc: AsyncNextcloudApp) -> list[dict[str, Any]]:
    rows = await read_admin_preset_config(nc, ADMIN_PRESETS_KEY)
    return [row for row in rows if isinstance(row, dict)
            and isinstance(row.get("id"), str) and row["id"].startswith("admin:")
            and isinstance(row.get("name"), str)
            and row.get("engine") in {"yt-dlp", "aria2c", "generic", "gallery-dl"}
            and isinstance(row.get("settings"), dict)][:100]


async def save_admin_presets(nc: AsyncNextcloudApp, rows: list[dict[str, Any]]) -> None:
    if len(rows) > 100:
        raise HTTPException(status_code=422, detail="Shared preset limit reached")
    await nc.appconfig_ex.set_value(ADMIN_PRESETS_KEY, json.dumps(rows, separators=(",", ":")))


def order_presets(rows: list[dict[str, Any]], order: list[str], hidden: list[str]) -> list[dict[str, Any]]:
    """Preserve the built-in order for catalogue entries not yet reordered."""
    positions = {identifier: index for index, identifier in enumerate(order)}
    visible = [row for row in rows if row["id"] not in hidden]
    return [row for _, row in sorted(enumerate(visible),
        key=lambda pair: (positions.get(pair[1]["id"], len(order) + pair[0]), pair[0]))]


# Stable, read-only options are shipped by this Nextcloud ExApp, not seeded
# in the administrator's Core database or another user's private preferences.
BUILTIN_PRESETS = (
    {"id": "builtin:best", "name": "Best available video", "engine": "yt-dlp",
     "description": "Highest video and audio quality.", "settings": {"format": "bv*+ba/b"}, "is_builtin": True},
    {"id": "builtin:balanced", "name": "Balanced MP4 video", "engine": "yt-dlp",
     "description": "Prefer MP4 for everyday sharing.", "settings": {"format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"}, "is_builtin": True},
    {"id": "builtin:1080", "name": "Full HD · up to 1080p", "engine": "yt-dlp",
     "description": "High-definition video up to 1080p.", "settings": {"format": "bv*[height<=1080]+ba/b[height<=1080]"}, "is_builtin": True},
    {"id": "builtin:720", "name": "HD · up to 720p", "engine": "yt-dlp",
     "description": "High-definition video in a smaller file.", "settings": {"format": "bv*[height<=720]+ba/b[height<=720]"}, "is_builtin": True},
    {"id": "builtin:480", "name": "SD · up to 480p", "engine": "yt-dlp",
     "description": "Standard-definition video.", "settings": {"format": "bv*[height<=480]+ba/b[height<=480]"}, "is_builtin": True},
    {"id": "builtin:360", "name": "Mobile · up to 360p", "engine": "yt-dlp",
     "description": "Small video for limited bandwidth.", "settings": {"format": "bv*[height<=360]+ba/b[height<=360]"}, "is_builtin": True},
    {"id": "builtin:audio", "name": "Audio only · best", "engine": "yt-dlp",
     "description": "Best available audio stream.", "settings": {"format": "bestaudio/best"}, "is_builtin": True},
    {"id": "builtin:m4a", "name": "Audio only · M4A", "engine": "yt-dlp",
     "description": "Prefer a compatible M4A audio stream.", "settings": {"format": "bestaudio[ext=m4a]/bestaudio/best"}, "is_builtin": True},
    {"id": "builtin:opus", "name": "Audio only · Opus", "engine": "yt-dlp",
     "description": "Prefer an Opus audio stream.", "settings": {"format": "bestaudio[acodec=opus]/bestaudio/best"}, "is_builtin": True},
    {"id": "builtin:small", "name": "Smallest video", "engine": "yt-dlp",
     "description": "Minimum-size video for quick sharing.", "settings": {"format": "worst[height<=480]/worst"}, "is_builtin": True},
    {"id": "builtin:webm", "name": "WebM video", "engine": "yt-dlp",
     "description": "Prefer WebM video and audio streams.", "settings": {"format": "bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/b"}, "is_builtin": True},
    {"id": "builtin:mp4", "name": "MP4 video", "engine": "yt-dlp",
     "description": "Prefer an MP4-compatible video.", "settings": {"format": "b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b"}, "is_builtin": True},
    {"id": "builtin:social", "name": "Social-media clip", "engine": "yt-dlp",
     "description": "Compact social video at 720p.", "settings": {"format": "bv*[height<=720]+ba/b[height<=720]"}, "is_builtin": True},
    {"id": "builtin:lecture", "name": "Lecture recording", "engine": "yt-dlp",
     "description": "Clear lecture video up to 720p.", "settings": {"format": "bv*[height<=720]+ba/b[height<=720]"}, "is_builtin": True},
    {"id": "builtin:music", "name": "Music audio", "engine": "yt-dlp",
     "description": "High-quality music audio stream.", "settings": {"format": "bestaudio/best"}, "is_builtin": True},
    {"id": "builtin:direct", "name": "Direct file", "engine": "generic",
     "description": "Download a direct file URL.", "settings": {}, "is_builtin": True},
    {"id": "builtin:large", "name": "Large direct file", "engine": "aria2c",
     "description": "Direct download using aria2c.", "settings": {}, "is_builtin": True},
    {"id": "builtin:gallery", "name": "Image gallery", "engine": "gallery-dl",
     "description": "Download a supported image gallery.", "settings": {}, "is_builtin": True},
    {"id": "builtin:collection", "name": "Image collection", "engine": "gallery-dl",
     "description": "Collect supported source images.", "settings": {}, "is_builtin": True},
)


def built_in_presets() -> list[dict[str, Any]]:
    """Return copies so no consumer mutates the shared definitions."""
    return [{**item, "settings": dict(item["settings"]), "is_shared": False}
            for item in BUILTIN_PRESETS]


SHARED_PRESET_PREFIX = "shared:"


def normalize_shared_presets(records: Any) -> list[dict[str, Any]]:
    """Allow only the Core administrator's explicitly approved public collection.

    The ExApp fetches this collection server-side with its own Core token;
    a browser never sends a raw Core preset ID and personal IDs cannot collide.
    """
    if not isinstance(records, list) or len(records) > 1000:
        raise HTTPException(status_code=502, detail="Invalid shared preset list")
    from uuid import UUID

    result = []
    for row in records:
        if not isinstance(row, dict) or row.get("is_shared") is not True:
            raise HTTPException(status_code=502, detail="Invalid shared preset record")
        source_id = row.get("id")
        engine = row.get("engine")
        settings = row.get("settings")
        name = row.get("name")
        description = row.get("description", "")
        try:
            if not isinstance(source_id, str) or str(UUID(source_id)) != source_id:
                raise ValueError("Invalid source ID")
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="Invalid shared preset ID") from exc
        if (
            engine not in ENGINES
            or not isinstance(settings, dict) or len(json.dumps(settings)) > 16000
            or not isinstance(name, str) or not 1 <= len(name.strip()) <= 120
            or not isinstance(description, str) or len(description) > 1000
        ):
            raise HTTPException(status_code=502, detail="Invalid shared preset fields")
        # Treat the Core shared collection as a separately authenticated trust
        # boundary. A malformed or unsafe record must not become a user option.
        if any(settings.get(key) for key in ("cookies_file", "proxy", "extra_args")):
            raise HTTPException(status_code=502, detail="Unsafe shared preset fields")
        opts = settings.get("options")
        if isinstance(opts, dict) and any(
            marker in str(key).lower()
            for key in opts
            for marker in ("auth", "cookie", "token", "secret", "password", "header", "referer", "proxy")
        ):
            raise HTTPException(status_code=502, detail="Unsafe shared preset options")
        result.append({
            "id": SHARED_PRESET_PREFIX + source_id,
            "name": name.strip(), "engine": engine,
            "settings": settings, "description": description,
            "is_shared": True,
        })
    return result


async def read_user_presets(context: UserContext) -> list[dict[str, Any]]:
    """Each user's presets live in Nextcloud preferences, never core's global table."""
    source = await context.nc.preferences_ex.get_value("user_presets", "[]")
    try:
        items = json.loads(source or "[]")
    except (ValueError, TypeError):
        items = []
    if not isinstance(items, list):
        return []
    return [
        item for item in items if isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and isinstance(item.get("name"), str)
        and item.get("engine") in ENGINES
        and isinstance(item.get("settings"), dict)
    ][:100]


async def save_user_preset(context: UserContext, body: dict[str, Any], identifier: str | None = None) -> dict[str, Any]:
    if not isinstance(body, dict) or set(body) - {"name", "engine", "settings", "description"}:
        raise HTTPException(status_code=422, detail="Invalid preset")
    name = body.get("name")
    engine = body.get("engine")
    settings = body.get("settings")
    description = body.get("description", "")
    if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 120
            or engine not in ENGINES or not isinstance(settings, dict)
            or len(json.dumps(settings)) > 16000 or not isinstance(description, str)
            or len(description) > 1000):
        raise HTTPException(status_code=422, detail="Invalid per-user preset")
    items = await read_user_presets(context)
    if identifier is not None and not any(item["id"] == identifier for item in items):
        raise HTTPException(status_code=404, detail="Preset not found")
    if identifier is None:
        if len(items) >= 100:
            raise HTTPException(status_code=422, detail="Maximum 100 personal presets")
        identifier = str(uuid4())
    item = {"id": identifier, "name": name.strip(), "engine": engine,
            "settings": settings, "description": description}
    items = [old for old in items if old["id"] != identifier] + [item]
    if len(json.dumps(items)) > 100000:
        raise HTTPException(status_code=422, detail="Personal preset library is too large")
    await context.nc.preferences_ex.set_value("user_presets", json.dumps(items, separators=(",", ":")))
    return item


async def delete_user_preset(context: UserContext, identifier: str) -> dict[str, bool]:
    items = await read_user_presets(context)
    if not any(item["id"] == identifier for item in items):
        raise HTTPException(status_code=404, detail="Preset not found")
    await context.nc.preferences_ex.set_value(
        "user_presets", json.dumps([item for item in items if item["id"] != identifier], separators=(",", ":"))
    )
    if await context.nc.preferences_ex.get_value("default_preset", "") == identifier:
        await context.nc.preferences_ex.set_value("default_preset", "")
    return {"deleted": True}


def nextcloud_webdav_base(nc: AsyncNextcloudApp) -> str:
    """Resolve a server-configured public HTTPS Files origin when AppAPI is internal.

    AppAPI may use http://nextcloud/ as its own internal URL. The isolated core
    cannot deliver to a private/insecure origin, so an operator-provided public
    HTTPS origin overrides only the WebDAV destination, never AppAPI requests.
    """
    origin = os.environ.get("DOWNLOADER_WEBDAV_ORIGIN", "").strip()
    if not origin:
        return nc.app_cfg.dav_endpoint.rstrip("/")
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Administrator WebDAV origin is invalid") from exc
    if (
        len(origin) > 2048 or parsed.scheme != "https"
        or not parsed.hostname or port == 0
        or parsed.username is not None or parsed.password is not None
        or parsed.path not in ("", "/") or parsed.query or parsed.fragment
        or parsed.netloc.endswith(":")
        or any(ord(char) < 33 or char == "\\" for char in origin)
    ):
        raise HTTPException(status_code=503, detail="Administrator WebDAV origin must be a plain HTTPS origin")
    return origin.rstrip("/") + "/remote.php/dav"


async def job_submission(
    context: UserContext, data: dict[str, Any],
    shared_presets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
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
    engine = data.get("engine", "auto")
    if engine not in ENGINES and engine != "auto":
        raise HTTPException(status_code=422, detail="Unsupported engine")
    preset_id = data.get("preset_id") or prefs["default_preset"]
    selected = None
    if preset_id:
        if isinstance(preset_id, str) and preset_id.startswith(SHARED_PRESET_PREFIX):
            selected = next(
                (preset for preset in (shared_presets or []) if preset["id"] == preset_id),
                None,
            )
        elif isinstance(preset_id, str) and preset_id.startswith("admin:"):
            selected = next(
                (preset for preset in await read_admin_presets(context.nc)
                 if preset["id"] == preset_id), None,
            )
        elif isinstance(preset_id, str) and preset_id.startswith("builtin:"):
            selected = next(
                (preset for preset in built_in_presets() if preset["id"] == preset_id), None,
            )
        else:
            selected = next(
                (preset for preset in await read_user_presets(context) if preset["id"] == preset_id),
                None,
            )
        if selected is None:
            # Revoked or guessed shared IDs fail just like another user's
            # private IDs, without disclosing the existence of either.
            raise HTTPException(status_code=404, detail="Your preset was not found")
        if engine != "auto" and engine != selected["engine"]:
            raise HTTPException(status_code=422, detail="Preset engine does not match selected engine")
        if engine == "auto":
            engine = selected["engine"]
    options = data.get("overrides", {})
    if not isinstance(options, dict) or len(json.dumps(options)) > 16000:
        raise HTTPException(status_code=422, detail="Invalid engine overrides")
    chosen = prefs["engine_settings"].get(engine, {})
    overrides = {**(selected["settings"] if selected else {}), **chosen, **options}
    # Replace user-visible cookie filenames with the own user's opaque core key.
    for option in ("cookies_file",):
        if overrides.get(option):
            overrides[option] = scoped_cookie_filename(context.user_id, str(overrides[option]))
    folder_path = "/" + folder if folder else "/"
    try:
        node = await context.nc.files.by_path(folder_path)
    except NextcloudException as exc:
        # nc_py_api's WebDAV PROPFIND raises NextcloudException(404) when
        # the path does not exist (rather than returning None). Only that
        # exact status permits first-use creation; 401/403/5xx never do.
        if exc.status_code != 404:
            raise HTTPException(status_code=409, detail="Cannot open destination folder in Nextcloud Files") from exc
        node = None
    except FileNotFoundError:
        node = None
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Cannot open destination folder in Nextcloud Files") from exc
    if node is None and "folder" not in data and folder == DEFAULT_FOLDER:
        # First-use default: make the Downloads folder in the signed user's
        # own Files. Explicit folder choices are never auto-created.
        try:
            await context.nc.files.makedirs(folder_path, exist_ok=True)
            node = await context.nc.files.by_path(folder_path)
        except Exception as exc:
            raise HTTPException(status_code=409, detail="Could not create your Downloads folder; check Files permissions") from exc
    if node is None or (hasattr(node, "is_dir") and not bool(node.is_dir)):
        raise HTTPException(status_code=409, detail="Destination folder is missing; choose an existing folder")
    # Derive the user Files origin from the AppAPI-supplied server URL, never the browser.
    nc_root = nextcloud_webdav_base(context.nc)
    return {
        "url": source,
        "engine": engine,
        "preset_id": None,  # Never reference another user's core/global preset.
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


def own_job_provenance(record: Any, owner_id: str) -> dict[str, Any]:
    if (not isinstance(record, dict) or record.get("owner_id") != owner_id
            or not isinstance(record.get("source_url"), str)):
        raise HTTPException(status_code=404, detail="File provenance not found")
    return record


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
