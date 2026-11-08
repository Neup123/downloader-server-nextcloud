"""Durable Nextcloud onboarding/index state, independent of browser GETs."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from nextcloud_exapp.onboarding import is_verified_completed, reconcile_first_verified
from nextcloud_exapp.tracking import JobTracker


class Preferences:
    def __init__(self):
        self.values = {}
        self.writes = []

    async def get_value(self, key, default=""):
        return self.values.get(key, default)

    async def set_value(self, key, value):
        self.writes.append((key, value))
        self.values[key] = value


class Owner:
    def __init__(self, uid, notifications):
        self.preferences_ex = Preferences()
        self.notifications = SimpleNamespace(create=self.create)
        self.uid = uid
        self.sent = notifications

    async def create(self, **data):
        self.sent.append((self.uid, data))


def delivered(uid="alice", verified=True):
    return {
        "id": "job-1", "owner_id": uid, "status": "completed",
        "url": "https://media.example.test/file.mp4?token=secret",
        "engine": "generic", "created_at": "2026-11-08T00:00:00Z",
        "output_files": [{"filename": "file.mp4", "verified": verified}],
    }


def test_first_download_milestone_is_owner_scoped_and_idempotent():
    assert is_verified_completed(delivered(), "alice")
    assert not is_verified_completed(delivered("bob"), "alice")
    assert not is_verified_completed(delivered(verified=False), "alice")
    assert not is_verified_completed({**delivered(), "output_files": []}, "alice")
    assert not is_verified_completed({**delivered(), "status": "failed"}, "alice")
    owner = Owner("alice", [])
    assert asyncio.run(reconcile_first_verified(owner, "alice", [delivered()]))
    assert asyncio.run(reconcile_first_verified(owner, "alice", [delivered()]))
    assert owner.preferences_ex.writes.count(("first_download_verified", "1")) == 1


def test_tracker_marks_first_verified_completion_and_search_without_history_get():
    async def test():
        with tempfile.TemporaryDirectory() as tmp:
            tracker = JobTracker(Path(tmp) / "jobs.db")
            tracker.add("job-1", "alice")
            sent = []
            owner = Owner("alice", sent)
            async def core(job_id):
                assert job_id == "job-1"
                return delivered()
            with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", return_value=owner):
                await tracker.tick(core)
                assert tracker.pending() == []
                assert tracker.flags("job-1") == (True, True)
                assert owner.preferences_ex.values["first_download_verified"] == "1"
                index = json.loads(owner.preferences_ex.values["download_search_index"])
                assert index[0]["id"] == "job-1"
                assert "token=secret" not in str(index)
                await tracker.tick(core)
                assert len(sent) == 1
    asyncio.run(test())


def test_failed_index_retries_after_notification_without_duplicate_delivery():
    async def test():
        with tempfile.TemporaryDirectory() as tmp:
            tracker = JobTracker(Path(tmp) / "jobs.db")
            tracker.add("job-1", "alice")
            sent = []
            owner = Owner("alice", sent)
            async def core(_):
                return delivered()
            attempts = 0
            from nextcloud_exapp.search_index import update_index as real_update
            async def fragile_update(nc, uid, jobs):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise RuntimeError("Preference storage unavailable")
                return await real_update(nc, uid, jobs)
            with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", return_value=owner), \
                 patch("nextcloud_exapp.tracking.update_index", side_effect=fragile_update):
                await tracker.tick(core)
                assert tracker.flags("job-1") == (True, False)
                assert tracker.pending() == [("job-1", "alice")]
                assert len(sent) == 1
                await tracker.tick(core)
                assert tracker.flags("job-1") == (True, True)
                assert tracker.pending() == []
                assert len(sent) == 1
                assert owner.preferences_ex.values["first_download_verified"] == "1"
    asyncio.run(test())


def test_existing_notification_rows_are_additively_migrated_for_index_retry():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "prior.db"
        with sqlite3.connect(path) as db:
            db.execute("""CREATE TABLE jobs (
                job_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
                notified INTEGER NOT NULL DEFAULT 0
            )""")
            db.execute("INSERT INTO jobs (job_id, owner_id, notified) VALUES (?, ?, ?)",
                       ("old", "alice", 1))
        tracker = JobTracker(path)
        assert tracker.flags("old") == (True, False)
        assert tracker.pending() == [("old", "alice")]
        tracker.mark_indexed("old")
        assert tracker.pending() == []
        tracker.reset("old")
        assert tracker.flags("old") == (False, False)
