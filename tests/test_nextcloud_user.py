"""Owner authorization, personal settings, delivery routing and durable notices."""
from __future__ import annotations

import asyncio
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from nextcloud_exapp.user import (
    UserContext, delivery_notification, entitlement, job_submission,
    own_job, parse_entitlements, read_user_preferences, scoped_cookie_filename,
    signed_user, unscoped_cookie_filename, validate_folder,
    write_user_preferences,
)
from nextcloud_exapp.tracking import JobTracker


class Pref:
    def __init__(self, saved=None):
        self.saved = saved or {}
        self.sensitive = set()

    async def get_value(self, name, default=None):
        return self.saved.get(name, default)

    async def set_value(self, name, value, sensitive=None):
        self.saved[name] = value
        if sensitive:
            self.sensitive.add(name)

    async def delete(self, name):
        self.saved.pop(name, None)


class Files:
    def __init__(self):
        self.paths = {"/", "/Existing"}
        self.created = []

    async def by_path(self, name):
        return SimpleNamespace(is_dir=True) if name in self.paths else None

    async def makedirs(self, name, exist_ok=False):
        self.paths.add(name)
        self.created.append(name)


class FakeNc:
    def __init__(self, uid, users="", groups="", user_groups=()):
        self.uid = uid
        self.appconfig_ex = Pref({"allowed_users": users, "allowed_groups": groups})
        self.preferences_ex = Pref()
        self.files = Files()
        self.app_cfg = SimpleNamespace(dav_endpoint="https://cloud.test/remote.php/dav")
        self.users = SimpleNamespace(get_user=self._get_user)
        self.groups = user_groups

    async def _get_user(self, uid):
        assert uid == self.uid
        return SimpleNamespace(groups=self.groups)


class UserUnitTests(TestCase):
    def test_signed_identity_and_missing_user(self):
        scope = {"type": "http", "headers": [], "username": "alice"}
        self.assertEqual(signed_user(Request(scope)), "alice")
        for uid in ("", None):
            with self.assertRaises(HTTPException) as failure:
                signed_user(Request({**scope, "username": uid}))
            self.assertEqual(failure.exception.status_code, 401)

    def test_explicit_admin_entitlement_and_groups(self):
        self.assertEqual(parse_entitlements("bob, alice\nadmin"), {"bob", "alice", "admin"})
        self.assertTrue(asyncio.run(entitlement(FakeNc("alice", users="alice"), "alice")))
        self.assertTrue(asyncio.run(entitlement(FakeNc("alice", groups="staff", user_groups=("staff",)), "alice")))
        self.assertFalse(asyncio.run(entitlement(FakeNc("alice", groups="staff", user_groups=("other",)), "alice")))
        self.assertFalse(asyncio.run(entitlement(FakeNc("alice"), "alice")))

    def test_personal_webdav_password_is_sensitive_and_never_returned(self):
        ctx = UserContext("alice", FakeNc("alice"))
        prefs = asyncio.run(write_user_preferences(ctx, {
            "destination_folder": "Movies/Clips",
            "default_preset": "preset-1",
            "app_password": "secret-file-password",
            "engine_settings": {"yt-dlp": {"format": "best"}},
        }))
        self.assertTrue(prefs["app_password_configured"])
        self.assertNotIn("secret-file-password", str(prefs))
        self.assertIn("dav_app_password", ctx.nc.preferences_ex.sensitive)
        self.assertEqual(prefs["destination_folder"], "Movies/Clips")
        with self.assertRaises(HTTPException):
            validate_folder("Movies/../other")

    def test_submission_ignores_arbitrary_owner_and_rejects_cross_user_folder(self):
        nc = FakeNc("alice")
        nc.preferences_ex.saved["dav_app_password"] = "alice-webdav-secret"
        ctx = UserContext("alice", nc)
        with self.assertRaises(HTTPException):
            asyncio.run(job_submission(ctx, {"url": "https://example.test/a", "owner_id": "bob"}))
        with self.assertRaises(HTTPException):
            asyncio.run(job_submission(ctx, {"url": "https://example.test/a", "folder": "NotHere"}))
        job = asyncio.run(job_submission(ctx, {"url": "https://example.test/video", "engine": "yt-dlp",
                                               "folder": "Existing", "overrides": {"format": "best"}}))
        self.assertEqual(job["owner_id"], "alice")
        self.assertEqual(job["delivery"]["username"], "alice")
        self.assertEqual(job["delivery"]["folder"], "Existing")
        self.assertTrue(job["delivery"]["webdav_url"].endswith("/files/alice"))
        with self.assertRaises(HTTPException) as exc:
            own_job({"id": "someone-elses-job", "owner_id": "bob"}, "alice")
        self.assertEqual(exc.exception.status_code, 404)

    def test_first_user_download_creates_only_own_default_folder(self):
        nc = FakeNc("alice")
        nc.preferences_ex.saved["dav_app_password"] = "password"
        ctx = UserContext("alice", nc)
        payload = asyncio.run(job_submission(ctx, {"url": "https://example.test/a"}))
        self.assertEqual(payload["delivery"]["folder"], "Downloads")
        self.assertEqual(nc.files.created, ["/Downloads"])

    def test_cookie_names_scoped_to_owner(self):
        name = scoped_cookie_filename("alice", "site.txt")
        self.assertEqual(unscoped_cookie_filename("alice", name), "site.txt")
        self.assertIsNone(unscoped_cookie_filename("bob", name))
        for value in ("../site.txt", "bad/name", "..", "-private.txt"):
            with self.assertRaises(HTTPException):
                scoped_cookie_filename("alice", value)

    def test_failed_delivery_has_direct_remedy(self):
        for error, snippet in (
            ("Nextcloud storage quota exceeded", "Free space"),
            ("destination is not writable", "Select a folder"),
            ("Nextcloud destination folder is missing", "Restore it"),
        ):
            subject, message = delivery_notification({"status": "failed", "error": error})
            self.assertEqual(subject, "Download could not be saved")
            self.assertIn(snippet, message)
        subject, _ = delivery_notification({"status": "completed"})
        self.assertEqual(subject, "Download complete")


    def test_personal_presets_are_scoped_and_never_sent_as_core_global_ids(self):
        from nextcloud_exapp.user import save_user_preset, read_user_presets, delete_user_preset
        alice = UserContext("alice", FakeNc("alice"))
        bob = UserContext("bob", FakeNc("bob"))
        saved = asyncio.run(save_user_preset(alice, {
            "name": "My format", "engine": "yt-dlp", "settings": {"format": "best"}
        }))
        self.assertEqual(len(asyncio.run(read_user_presets(alice))), 1)
        self.assertEqual(asyncio.run(read_user_presets(bob)), [])
        alice.nc.preferences_ex.saved["dav_app_password"] = "alice-password"
        job = asyncio.run(job_submission(alice, {
            "url": "https://example.test/media", "engine": "auto", "preset_id": saved["id"]
        }))
        self.assertIsNone(job["preset_id"])
        self.assertEqual(job["engine"], "yt-dlp")
        self.assertEqual(job["overrides"]["format"], "best")
        bob.nc.preferences_ex.saved["dav_app_password"] = "bob-password"
        with self.assertRaises(HTTPException) as failure:
            asyncio.run(job_submission(bob, {
                "url": "https://example.test/media", "preset_id": saved["id"]
            }))
        self.assertEqual(failure.exception.status_code, 404)
        result = asyncio.run(delete_user_preset(alice, saved["id"]))
        self.assertTrue(result["deleted"])
        self.assertEqual(asyncio.run(read_user_presets(alice)), [])


class TrackingTests(TestCase):
    def test_pending_survives_restart_notifies_only_owner_and_retry_resets(self):
        async def run():
            with tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "notices.sqlite"
                tracker = JobTracker(path)
                tracker.add("a", "alice")
                tracker.add("b", "bob")
                tracker = JobTracker(path)
                self.assertEqual(len(tracker.pending()), 2)

                async def core(job_id):
                    return {"id": job_id, "owner_id": "alice" if job_id == "a" else "bob",
                            "status": "failed" if job_id == "a" else "completed",
                            "error": "Nextcloud storage quota exceeded" if job_id == "a" else None}
                created = []
                class FakeNotifications:
                    def __init__(self, uid):
                        self.uid = uid
                    async def create(self, subject, message, link):
                        created.append((self.uid, subject, message, link))
                def fake_nextcloud(user):
                    return SimpleNamespace(notifications=FakeNotifications(user))
                with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", fake_nextcloud):
                    await tracker.tick(core)
                    self.assertEqual({x[0] for x in created}, {"alice", "bob"})
                    self.assertEqual(tracker.pending(), [])
                    await tracker.tick(core)
                    self.assertEqual(len(created), 2)
                    tracker.reset("a")
                    await tracker.tick(core)
                    self.assertEqual(len(created), 3)
                    self.assertEqual(created[-1][0], "alice")
        asyncio.run(run())
