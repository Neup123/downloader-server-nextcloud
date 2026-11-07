"""Native notification preference isolation and verified Files links."""
from __future__ import annotations
import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException

from nextcloud_exapp.tracking import JobTracker, notification_link
from nextcloud_exapp.user import UserContext, read_user_preferences, write_user_preferences


class Pref:
    def __init__(self, values=None):
        self.values = dict(values or {})
    async def get_value(self, name, default=None):
        return self.values.get(name, default)
    async def set_value(self, name, value):
        self.values[name] = value


def test_notification_options_are_owner_private_and_boolean_only():
    alice = UserContext("alice", SimpleNamespace(preferences_ex=Pref()))
    bob = UserContext("bob", SimpleNamespace(preferences_ex=Pref()))
    saved = asyncio.run(write_user_preferences(alice, {"notify_finished": False, "notify_failed": True}))
    assert saved["notify_finished"] is False
    assert saved["notify_failed"] is True
    assert (asyncio.run(read_user_preferences(bob)))["notify_finished"] is True
    for invalid in ("false", 0, 1, None):
        try:
            asyncio.run(write_user_preferences(bob, {"notify_finished": invalid}))
        except HTTPException as error:
            assert error.status_code == 422
        else:
            raise AssertionError(f"Invalid preference accepted: {invalid!r}")


def test_notification_link_never_leaks_remote_dav_host_or_another_user():
    completed = {
        "id": "job_1", "status": "completed",
        "output_files": [{
            "path": "https://private-nextcloud.example/remote.php/dav/files/alice/Downloads/job1/movie.mp4",
            "filename": "movie.mp4", "verified": True, "file_id": "123",
        }],
    }
    link = notification_link(completed, "alice")
    assert link.startswith("/apps/files/files?dir=")
    assert "openfile=123" in link
    assert "private-nextcloud.example" not in link
    assert notification_link(completed, "bob").startswith("/apps/app_api/proxy/")
    completed["output_files"][0]["verified"] = False
    assert notification_link(completed, "alice").startswith("/apps/app_api/proxy/")


def test_disabled_notification_is_suppressed_but_job_is_marked_and_kept_in_history():
    async def run():
        with TemporaryDirectory() as temp:
            tracker = JobTracker(Path(temp) / "notice.sqlite")
            tracker.add("completed", "alice")
            tracker.add("failed", "bob")
            sent = []
            class Notifier:
                async def create(self, subject, message, link):
                    sent.append(subject)
            def fake_nextcloud(user):
                opts = {"notify_finished": "0"} if user == "alice" else {"notify_failed": "1"}
                return SimpleNamespace(preferences_ex=Pref(opts), notifications=Notifier())
            async def fetch(job_id):
                return {"id": job_id, "owner_id": "alice" if job_id == "completed" else "bob",
                        "status": "completed" if job_id == "completed" else "failed",
                        "output_files": [{"verified": True, "filename": "x"}], "error": "Download failed"}
            with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", fake_nextcloud):
                await tracker.tick(fetch)
            assert len(sent) == 1
            assert tracker.pending() == []
    asyncio.run(run())
