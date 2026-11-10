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
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote, urlsplit

from fastapi import HTTPException, Request
from nc_py_api import NextcloudException
from nc_py_api.nextcloud import AsyncNextcloudApp

from nextcloud_exapp.job_state_contract import TERMINAL_STATES

DEFAULT_FOLDER = "Downloads"
# Broad user-facing categories; these are NOT engine names or URL heuristics.
ROUTE_SUBFOLDERS = {
    "video": "Video",
    "audio": "Audio",
    "images": "Images",
    "manga": "Manga",
    "direct": "Direct files",
    "torrent": "Torrents",
}


def default_destination_routes(folder: str) -> dict[str, str]:
    """Implicit routes follow changes to the owner's default Files folder."""
    return {
        kind: validate_folder("/".join(part for part in (folder, suffix) if part))
        for kind, suffix in ROUTE_SUBFOLDERS.items()
    }


def _saved_destination_route_overrides(value: Any) -> dict[str, str]:
    try:
        decoded = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    if not isinstance(decoded, dict):
        return {}
    valid = {}
    for key, path in decoded.items():
        if key not in ROUTE_SUBFOLDERS or not isinstance(path, str):
            continue
        try:
            valid[key] = validate_folder(path)
        except HTTPException:
            continue
    return valid

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
    engines_json = await preferences.get_value("engine_settings", "{}")
    try:
        settings = json.loads(engines_json or "{}")
    except (TypeError, ValueError):
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    route_overrides = _saved_destination_route_overrides(
        await preferences.get_value("destination_routes", "{}")
    )
    return {
        "destination_folder": folder,
        "destination_routes": {**default_destination_routes(folder), **route_overrides},
        "destination_route_overrides": route_overrides,
        "existing_file_behavior": (
            "skip" if await preferences.get_value("existing_file_behavior", "rename") == "skip"
            else "rename"
        ),
        "engine_settings": {name: options for name, options in settings.items()
                            if name in ENGINES and isinstance(options, dict)},
        "app_password_configured": bool(await preferences.get_value("dav_app_password", "")),
        "first_download_verified": await preferences.get_value("first_download_verified", "0") == "1",
        "notify_finished": await preferences.get_value("notify_finished", "1") != "0",
        "notify_failed": await preferences.get_value("notify_failed", "1") != "0",
        "header_indicator_visibility": await preferences.get_value("header_indicator_visibility", "active"),
        "dropdown_content": await preferences.get_value("dropdown_content", "active"),
        "default_video_quality": await preferences.get_value("default_video_quality", "best"),
        "default_audio_quality": await preferences.get_value("default_audio_quality", "best"),
    }


async def write_user_preferences(context: UserContext, patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="Invalid personal settings")
    allowed = {"destination_folder", "engine_settings", "app_password",
               "notify_finished", "notify_failed", "header_indicator_visibility",
               "dropdown_content", "default_video_quality", "default_audio_quality",
               "destination_routes", "existing_file_behavior"}
    if set(patch) - allowed:
        raise HTTPException(status_code=422, detail="Unknown personal setting")
    pref = context.nc.preferences_ex
    if "existing_file_behavior" in patch and patch["existing_file_behavior"] not in ("rename", "skip"):
        raise HTTPException(status_code=422, detail="Choose Rename or Skip; overwrite is never offered")
    if "destination_routes" in patch:
        route_patch = patch["destination_routes"]
        if not isinstance(route_patch, dict) or set(route_patch) - set(ROUTE_SUBFOLDERS):
            raise HTTPException(status_code=422, detail="Invalid content-type destination routes")
        for route_path in route_patch.values():
            if route_path is not None:
                validate_folder(route_path)
    if "destination_folder" in patch:
        folder = validate_folder(patch["destination_folder"])
        await pref.set_value("destination_folder", folder)
    if "destination_routes" in patch:
        overrides = _saved_destination_route_overrides(
            await pref.get_value("destination_routes", "{}")
        )
        for kind, path in patch["destination_routes"].items():
            if path is None:
                overrides.pop(kind, None)
            else:
                overrides[kind] = validate_folder(path)
        await pref.set_value("destination_routes", json.dumps(overrides, separators=(",", ":")))
    if "existing_file_behavior" in patch:
        await pref.set_value("existing_file_behavior", patch["existing_file_behavior"])
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
        ("default_video_quality", {"best", "1080", "720", "480"}),
        ("default_audio_quality", {"best", "192", "128", "small"}),
    ):
        if name in patch:
            if not isinstance(patch[name], str) or patch[name] not in choices:
                raise HTTPException(status_code=422, detail="Invalid downloads display preference")
            await pref.set_value(name, patch[name])
    if "app_password" in patch:
        password = patch["app_password"]
        if not isinstance(password, str) or len(password) > 1024:
            raise HTTPException(status_code=422, detail="Invalid Nextcloud app password")
        if password:
            await pref.set_value("dav_app_password", password, sensitive=True)
        else:
            await pref.delete("dav_app_password")
    return await read_user_preferences(context)




async def read_legacy_personal_presets(context: UserContext) -> list[dict[str, Any]]:
    """Read old profile records without re-enabling preset selection or mutation.

    Existing data is never modified or migrated during settings and job reads.
    This helper supports safe read-only inspection of existing profiles.
    """
    try:
        raw = await context.nc.preferences_ex.get_value("user_presets", "[]")
        records = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(records, list):
        return []
    return [record for record in records if isinstance(record, dict)][:100]



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
) -> dict[str, Any]:
    """Creates a privileged core request; caller-supplied owner/delivery ignored."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Invalid download job")
    allowed = {"url", "engine", "overrides", "folder", "audio_only", "quality", "content_type"}
    if set(data) - allowed:
        raise HTTPException(status_code=422, detail="Unsupported job field")
    source = data.get("url")
    if not isinstance(source, str) or len(source) > 4096 or len(source) < 8:
        raise HTTPException(status_code=422, detail="Paste a valid source URL")
    prefs = await read_user_preferences(context)
    password = await context.nc.preferences_ex.get_value("dav_app_password", "")
    if not password:
        raise HTTPException(status_code=409, detail="Connect your Nextcloud Files app password in personal settings first")
    content_type = data.get("content_type")
    if content_type is not None and (not isinstance(content_type, str) or content_type not in ROUTE_SUBFOLDERS):
        raise HTTPException(status_code=422, detail="Unsupported detected content type")
    explicit_folder = "folder" in data
    # Older untyped submissions continue to use the prior default destination.
    # The #138 dialog always provides content_type from extractor classification.
    target_folder = (data["folder"] if explicit_folder else
                     prefs["destination_routes"][content_type] if content_type
                     else prefs["destination_folder"])
    folder = validate_folder(target_folder)
    engine = data.get("engine", "auto")
    if engine not in ENGINES and engine != "auto":
        raise HTTPException(status_code=422, detail="Unsupported engine")
    options = data.get("overrides", {})
    if not isinstance(options, dict) or len(json.dumps(options)) > 16000:
        raise HTTPException(status_code=422, detail="Invalid engine overrides")
    # The dialog's explicit mode/quality must be represented by the actual
    # yt-dlp format sent to Core, not cosmetic client-only controls. The
    # signed ExApp accepts mode metadata and validates it before stripping
    # those UI-only fields from the Core request.
    if "audio_only" in data or "quality" in data:
        audio_only = data.get("audio_only")
        quality = data.get("quality")
        choices = {"best", "192", "128", "small"} if audio_only else {"best", "1080", "720", "480"}
        if not isinstance(audio_only, bool) or not isinstance(quality, str) or quality not in choices:
            raise HTTPException(status_code=422, detail="Invalid audio/video quality selection")
        fmt = options.get("format")
        if engine != "yt-dlp" or not isinstance(fmt, str) or not fmt:
            raise HTTPException(status_code=422, detail="Quality selection requires yt-dlp format overrides")
        if audio_only and not (fmt.startswith("bestaudio") or fmt.startswith("worstaudio")):
            raise HTTPException(status_code=422, detail="Audio-only choice must submit an audio-only format")
        if not audio_only and (fmt.startswith("bestaudio") or fmt.startswith("worstaudio")):
            raise HTTPException(status_code=422, detail="Video quality must submit a video format")
    # Signed Nextcloud torrent submissions must never seed after completion.
    # aria2 documents seed-time=0 as the disable switch. seed-ratio=0 is
    # NOT a disable switch (it means unlimited seeding), so do not use it.
    if engine == "auto" and source.lower().startswith("magnet:"):
        engine = "aria2c"
    chosen = prefs["engine_settings"].get(engine, {})
    overrides = {**chosen, **options}
    if engine == "aria2c":
        saved_options = chosen.get("options", {})
        request_options = options.get("options", {})
        if not isinstance(saved_options, dict) or not isinstance(request_options, dict):
            raise HTTPException(status_code=422, detail="Invalid aria2 options")
        overrides["options"] = {**saved_options, **request_options, "seed-time": "0"}
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
    default_implicit_route = (not explicit_folder and content_type is not None
                              and content_type not in prefs["destination_route_overrides"])
    if node is None and not explicit_folder and (default_implicit_route or folder == DEFAULT_FOLDER):
        # Only generate the user's own implicit destination. A custom route
        # or an explicit folder must already exist and be writable.
        if default_implicit_route:
            base_folder = prefs["destination_folder"]
            if base_folder:
                try:
                    parent = await context.nc.files.by_path("/" + base_folder)
                except (FileNotFoundError, NextcloudException) as exc:
                    if not isinstance(exc, FileNotFoundError) and exc.status_code != 404:
                        raise HTTPException(status_code=409, detail="Cannot open base Downloads folder") from exc
                    parent = None
                if parent is None:
                    if base_folder != DEFAULT_FOLDER:
                        raise HTTPException(status_code=409, detail="Configured base Downloads folder is missing")
                    try:
                        await context.nc.files.makedirs("/" + base_folder, exist_ok=True)
                        parent = await context.nc.files.by_path("/" + base_folder)
                    except Exception as exc:
                        raise HTTPException(status_code=409, detail="Could not create Downloads folder") from exc
                if not parent or (hasattr(parent, "is_dir") and not parent.is_dir):
                    raise HTTPException(status_code=409, detail="Configured base Downloads folder is not a directory")
        try:
            await context.nc.files.makedirs(folder_path, exist_ok=True)
            node = await context.nc.files.by_path(folder_path)
        except Exception as exc:
            raise HTTPException(status_code=409, detail="Could not create your default download folder; check Files permissions") from exc
    if node is None or (hasattr(node, "is_dir") and not bool(node.is_dir)):
        raise HTTPException(status_code=409, detail="Destination folder is missing; choose an existing folder")
    # Derive the user Files origin from the AppAPI-supplied server URL, never the browser.
    nc_root = nextcloud_webdav_base(context.nc)
    return {
        "url": source,
        "engine": engine,
        "overrides": overrides,
        "owner_id": context.user_id,
        "delivery": {
            "mode": "webdav",
            "webdav_url": nc_root + "/files/" + quote(context.user_id, safe=""),
            "username": context.user_id,
            "app_password": password,
            "folder": folder,
            "existing_file_behavior": prefs["existing_file_behavior"],
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
        skipped = [item for item in (job.get("output_files") or [])
                   if isinstance(item, dict) and item.get("skipped") is True]
        if skipped:
            return ("Download skipped", "A file or folder already exists in your Nextcloud Files. "
                    "The existing item was left unchanged.")
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
