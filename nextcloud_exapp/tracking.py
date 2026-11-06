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

from nc_py_api.nextcloud import AsyncNextcloudApp

from nextcloud_exapp.user import TERMINAL_STATES, delivery_notification

CoreGet = Callable[[str], Awaitable[dict]]


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
                notified INTEGER NOT NULL DEFAULT 0
            )""")

    def _connect(self):
        return sqlite3.connect(str(self.path), timeout=20.0)

    def add(self, job_id: str, owner_id: str) -> None:
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO jobs (job_id, owner_id) VALUES (?, ?)", (job_id, owner_id))

    def reset(self, job_id: str) -> None:
        with self._connect() as db:
            db.execute("UPDATE jobs SET notified = 0 WHERE job_id = ?", (job_id,))

    def pending(self) -> list[tuple[str, str]]:
        with self._connect() as db:
            return list(db.execute("SELECT job_id, owner_id FROM jobs WHERE notified = 0 ORDER BY rowid LIMIT 300"))

    def mark(self, job_id: str) -> None:
        with self._connect() as db:
            db.execute("UPDATE jobs SET notified = 1 WHERE job_id = ?", (job_id,))

    async def tick(self, core_get: CoreGet) -> None:
        for job_id, owner_id in self.pending():
            try:
                job = await core_get(job_id)
                if job.get("owner_id") != owner_id or job.get("status") not in TERMINAL_STATES:
                    continue
                subject, message = delivery_notification(job)
                await AsyncNextcloudApp(user=owner_id).notifications.create(
                    subject=subject,
                    message=message,
                    link="/apps/app_api/proxy/downloader-server-nextcloud/user/",
                )
                self.mark(job_id)
            except Exception:
                # Remain in durable pending state; retry on next tick or restart.
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
