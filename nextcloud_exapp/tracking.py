"""Durable per-owner Nextcloud notifications for completed/failed core jobs.

Only server-side AppAPI credentials can post native notifications. Pending jobs
are retained in ExApp persistent storage and checked after container restarts.
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import quote, unquote, urlsplit
import re

from nc_py_api.nextcloud import AsyncNextcloudApp

from nextcloud_exapp.user import TERMINAL_STATES, delivery_notification
from nextcloud_exapp.search_index import update_index
from nextcloud_exapp.onboarding import reconcile_first_verified

CoreGet = Callable[[str], Awaitable[dict]]


def notification_link(job: dict, owner_id: str) -> str:
    """Use only verified files in the current owner's DAV tree for native Files links.

    Source URLs and HTTP hosts are never copied into notifications; when the
    exact Files destination is unavailable, link to the owner-checked job view.
    """
    identifier = str(job.get("id") or "")
    fallback = "/apps/downloader_bridge/library"
    if re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", identifier):
        fallback += "?job=" + quote(identifier, safe="")
    if job.get("status") not in ("completed", "skipped"):
        return fallback
    for item in job.get("output_files") or []:
        if not isinstance(item, dict) or item.get("verified") is not True:
            continue
        raw = item.get("path")
        if not isinstance(raw, str):
            continue
        try:
            path = urlsplit(raw).path
            prefix, suffix = path.split("/remote.php/dav/files/", 1)
            parts = suffix.split("/")
            if len(parts) < 2 or unquote(parts[0]) != owner_id:
                continue
            segments = [unquote(part) for part in parts[1:]]
            if any(not part or part in (".", "..") or "/" in part or "\\" in part
                   for part in segments):
                continue
            directory = "/" + "/".join(segments[:-1])
            url = prefix + "/apps/files/files?dir=" + quote(directory, safe="")
            file_id = item.get("file_id")
            if isinstance(file_id, (int, str)) and str(file_id).isdecimal():
                url += "&openfile=" + quote(str(file_id), safe="")
            return url
        except (ValueError, TypeError):
            continue
    return fallback


class JobTracker:
    def __init__(self, path: Path | None = None):
        selected = os.environ.get("DOWNLOADER_TRACKING_DB")
        # Avoid the nc_py_api persistent_storage helper: its default argument
        # eagerly evaluates an unwritable /app/.cache path on non-root ExApps.
        # AppAPI supplies an install-persistent volume via APP_PERSISTENT_STORAGE.
        storage = os.environ.get("APP_PERSISTENT_STORAGE")
        location = Path(storage) if storage else Path(os.environ.get("XDG_STATE_HOME", "/tmp")) / "downloader-exapp"
        self.path = path or (Path(selected) if selected else location / "download-notifications.sqlite")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
                notified INTEGER NOT NULL DEFAULT 0,
                index_synced INTEGER NOT NULL DEFAULT 0
            )""")
            # Additive migration preserves owner and notification state. Old
            # rows get one extra index attempt, not another notification.
            cols = {item[1] for item in db.execute("PRAGMA table_info(jobs)")}
            if "index_synced" not in cols:
                db.execute("ALTER TABLE jobs ADD COLUMN index_synced INTEGER NOT NULL DEFAULT 0")

    def _connect(self):
        return sqlite3.connect(str(self.path), timeout=20.0)

    def add(self, job_id: str, owner_id: str) -> None:
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO jobs (job_id, owner_id) VALUES (?, ?)", (job_id, owner_id))

    def reset(self, job_id: str) -> None:
        with self._connect() as db:
            db.execute("UPDATE jobs SET notified = 0, index_synced = 0 WHERE job_id = ?", (job_id,))

    def pending(self) -> list[tuple[str, str]]:
        with self._connect() as db:
            return list(db.execute("SELECT job_id, owner_id FROM jobs WHERE notified = 0 OR index_synced = 0 ORDER BY rowid LIMIT 300"))

    def mark(self, job_id: str) -> None:
        with self._connect() as db:
            db.execute("UPDATE jobs SET notified = 1 WHERE job_id = ?", (job_id,))

    def mark_indexed(self, job_id: str) -> None:
        with self._connect() as db:
            db.execute("UPDATE jobs SET index_synced = 1 WHERE job_id = ?", (job_id,))

    def flags(self, job_id: str) -> tuple[bool, bool]:
        """A notification and a search-index update are independent states."""
        with self._connect() as db:
            result = db.execute(
                "SELECT notified, index_synced FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
        return (bool(result[0]), bool(result[1])) if result else (True, True)

    async def tick(self, core_get: CoreGet) -> None:
        for job_id, owner_id in self.pending():
            try:
                job = await core_get(job_id)
                if job.get("owner_id") != owner_id or job.get("status") not in TERMINAL_STATES:
                    continue
                notified, indexed = self.flags(job_id)
                if notified and indexed:
                    continue
                nc = AsyncNextcloudApp(user=owner_id)
                if not notified:
                    subject, message = delivery_notification(job)
                    key = "notify_finished" if job["status"] in ("completed", "skipped") else "notify_failed"
                    # Failed preference reads must not bypass an opt-out.
                    choice = await nc.preferences_ex.get_value(key, "1")
                    # A collision skip must never be silent even when normal
                    # finished-download notifications are disabled.
                    skipped = job["status"] == "skipped" or any(
                        isinstance(item, dict) and item.get("skipped") is True
                        for item in job.get("output_files") or []
                    )
                    if choice != "0" or skipped:
                        await nc.notifications.create(
                            subject=subject,
                            message=message,
                            link=notification_link(job, owner_id),
                        )
                    # Notification is durable once published (or opted out).
                    self.mark(job_id)
                if not indexed:
                    # Retry indexing without duplicating native notifications.
                    # A finished download marks onboarding even when the user
                    # has not opened the history page.
                    await update_index(nc, owner_id, [job])
                    await reconcile_first_verified(nc, owner_id, [job])
                    self.mark_indexed(job_id)
            except Exception:
                # Retain only the incomplete state(s) for the next poll/restart.
                continue

    async def monitor(self, core_get: CoreGet, seconds: float = 8.0) -> None:
        while True:
            try:
                await self.tick(core_get)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            await asyncio.sleep(seconds)
