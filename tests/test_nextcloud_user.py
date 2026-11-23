"""Owner authorization, personal settings, delivery routing and durable notices."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from nc_py_api import NextcloudException
from starlette.requests import Request

from nextcloud_exapp.user import (
    UserContext, delivery_notification, entitlement, job_submission, require_admin,
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

    def test_admin_backend_authorization_is_independent_of_proxy_manifest(self):
        """A normal user cannot bypass AppAPI ADMIN routes by reaching ExApp directly."""
        scope = {"type": "http", "headers": [], "username": "alice"}
        async def check(groups, user_id="alice"):
            with patch("nextcloud_exapp.user.AsyncNextcloudApp",
                       side_effect=lambda user: FakeNc(user, user_groups=groups)):
                return await require_admin(Request({**scope, "username": user_id}))
        admin = asyncio.run(check(("staff", "admin")))
        self.assertEqual(admin.user_id, "alice")
        for groups in (("staff",), (), ("administrators",), None):
            with self.subTest(groups=groups), self.assertRaises(HTTPException) as failure:
                asyncio.run(check(groups))
            self.assertEqual(failure.exception.status_code, 403)
        with self.assertRaises(HTTPException) as missing:
            asyncio.run(check(("admin",), ""))
        self.assertEqual(missing.exception.status_code, 401)

        class BrokenNc(FakeNc):
            async def _get_user(self, uid):
                raise RuntimeError("Nextcloud groups unavailable")
        with patch("nextcloud_exapp.user.AsyncNextcloudApp", side_effect=lambda user: BrokenNc(user)):
            with self.assertRaises(HTTPException) as unavailable:
                asyncio.run(require_admin(Request(scope)))
        self.assertEqual(unavailable.exception.status_code, 403)

    def test_all_privileged_exapp_handlers_require_admin_in_backend(self):
        from nextcloud_exapp.main import APP
        protected = {"/", "/api-reference", "/api/v1/{path:path}",
                     "/admin/api/entitlements", "/admin/api/tracker-health"}
        matches = [route for route in APP.routes if getattr(route, "path", None) in protected]
        self.assertEqual({route.path for route in matches}, protected)
        self.assertTrue(all(
            any(dep.call is require_admin for dep in route.dependant.dependencies)
            for route in matches
        ))
        self.assertFalse(any(
            dep.call is require_admin for route in APP.routes
            if getattr(route, "path", "").startswith("/user/")
            for dep in route.dependant.dependencies
        ))

    def test_admin_entitlement_patch_is_validated_before_any_write(self):
        from nextcloud_exapp.main import admin_write_entitlements
        from unittest.mock import AsyncMock
        nc = FakeNc("alice", user_groups=("admin",))
        nc.appconfig_ex.set_value = AsyncMock(wraps=nc.appconfig_ex.set_value)
        request = Request({"type": "http", "headers": [], "username": "alice"})
        request._json = {"allowed_users": "alice", "allowed_groups": ["not a string"]}
        with self.assertRaises(HTTPException) as rejected:
            asyncio.run(admin_write_entitlements(request, UserContext("alice", nc)))
        self.assertEqual(rejected.exception.status_code, 422)
        nc.appconfig_ex.set_value.assert_not_awaited()

    def test_personal_webdav_password_is_sensitive_and_never_returned(self):
        ctx = UserContext("alice", FakeNc("alice"))
        prefs = asyncio.run(write_user_preferences(ctx, {
            "destination_folder": "Movies/Clips",
            "app_password": "secret-file-password",
            "engine_settings": {"yt-dlp": {"format": "best"}},
        }))
        self.assertTrue(prefs["app_password_configured"])
        self.assertNotIn("secret-file-password", str(prefs))
        self.assertIn("dav_app_password", ctx.nc.preferences_ex.sensitive)
        self.assertEqual(prefs["destination_folder"], "Movies/Clips")
        with self.assertRaises(HTTPException):
            validate_folder("Movies/../other")

    def test_combined_patch_valid_early_and_invalid_late_is_untouched(self):
        """No field may be saved until all settings, even late ones, validate."""
        from unittest.mock import AsyncMock
        nc = FakeNc("alice")
        nc.preferences_ex.saved.update({
            "destination_folder": "Original",
            "existing_file_behavior": "rename",
            "notify_failed": "1",
            "engine_settings": '{"yt-dlp":{"format":"best"}}',
            "dav_app_password": "old-secret",
        })
        original = dict(nc.preferences_ex.saved)
        nc.preferences_ex.set_value = AsyncMock(wraps=nc.preferences_ex.set_value)
        nc.preferences_ex.delete = AsyncMock(wraps=nc.preferences_ex.delete)
        for late in (
            {"engine_settings": {"unknown-engine": {}}},
            {"notify_failed": "false"},
            {"default_audio_quality": "lossless"},
            {"app_password": 123},
        ):
            with self.subTest(late=late), self.assertRaises(HTTPException) as failure:
                asyncio.run(write_user_preferences(UserContext("alice", nc), {
                    "destination_folder": "Updated",
                    "existing_file_behavior": "skip",
                    **late,
                }))
            self.assertEqual(failure.exception.status_code, 422)
            self.assertEqual(nc.preferences_ex.saved, original)
        nc.preferences_ex.set_value.assert_not_awaited()
        nc.preferences_ex.delete.assert_not_awaited()

    def test_partial_nextcloud_write_is_compensated_even_if_failing_key_changed(self):
        """A lost write response must roll back the failing key as well."""
        nc = FakeNc("alice")
        nc.preferences_ex.saved.update({
            "destination_folder": "Original", "notify_failed": "1",
            "dav_app_password": "original-secret",
        })
        original = dict(nc.preferences_ex.saved)
        pref = nc.preferences_ex
        normal_set = pref.set_value
        attempts = []
        async def fail_after_writing(name, value, sensitive=None):
            attempts.append(name)
            await normal_set(name, value, sensitive=sensitive)
            if name == "notify_failed" and attempts.count(name) == 1:
                raise OSError("lost response after persisting")
        pref.set_value = fail_after_writing
        with self.assertRaises(HTTPException) as failure:
            asyncio.run(write_user_preferences(UserContext("alice", nc), {
                "destination_folder": "Updated", "notify_failed": False,
            }))
        self.assertEqual(failure.exception.status_code, 409)
        self.assertEqual(pref.saved, original)
        self.assertEqual(attempts, ["destination_folder", "notify_failed",
                                    "notify_failed", "destination_folder"])

    def test_rollback_failure_reports_uncertain_saved_state(self):
        """Never claim atomic rollback if Nextcloud also refuses compensation."""
        nc = FakeNc("alice")
        pref = nc.preferences_ex
        pref.saved.update({"destination_folder": "Original", "notify_failed": "1"})
        original_set = pref.set_value
        async def fail_and_block_restoration(name, value, sensitive=None):
            if name == "notify_failed":
                raise OSError("write unavailable")
            if name == "destination_folder" and value == "Original":
                raise OSError("rollback unavailable")
            await original_set(name, value, sensitive=sensitive)
        pref.set_value = fail_and_block_restoration
        with self.assertRaises(HTTPException) as failure:
            asyncio.run(write_user_preferences(UserContext("alice", nc), {
                "destination_folder": "Updated", "notify_failed": False,
            }))
        self.assertEqual(failure.exception.status_code, 503)
        self.assertIn("could not be restored", failure.exception.detail)
        self.assertEqual(asyncio.run(read_user_preferences(UserContext("alice", nc)))["destination_folder"], "Updated")

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

    def test_public_https_origin_override_keeps_webdav_out_of_private_appapi(self):
        import os
        from nextcloud_exapp.user import nextcloud_webdav_base
        from unittest.mock import patch
        nc = FakeNc("alice")
        for invalid in ("http://nextcloud", "https://alice:secret@example.org",
                        "https://example.org/remote.php/dav", "https://example.org?token=bad"):
            with self.subTest(invalid=invalid), patch.dict(
                os.environ, {"DOWNLOADER_WEBDAV_ORIGIN": invalid}
            ), self.assertRaises(HTTPException):
                nextcloud_webdav_base(nc)
        with patch.dict(os.environ, {"DOWNLOADER_WEBDAV_ORIGIN": "https://cloud.example.org"}):
            self.assertEqual(nextcloud_webdav_base(nc), "https://cloud.example.org/remote.php/dav")
            nc.preferences_ex.saved["dav_app_password"] = "secret"
            payload = asyncio.run(job_submission(UserContext("alice", nc),
                {"url": "https://example.test/video"}))
            self.assertEqual(payload["delivery"]["webdav_url"],
                "https://cloud.example.org/remote.php/dav/files/alice")

    def test_nextcloud_never_injects_core_managed_aria2_policy_options(self):
        nc = FakeNc("alice")
        nc.preferences_ex.saved["dav_app_password"] = "test-secret"
        request = asyncio.run(job_submission(UserContext("alice", nc), {
            "url": "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
            "engine": "aria2c", "overrides": {"options": {"max-connection-per-server": "4"}},
        }))
        self.assertEqual(request["engine"], "aria2c")
        self.assertEqual(request["overrides"]["options"], {"max-connection-per-server": "4"})
        self.assertNotIn("seed-time", request["overrides"]["options"])
        nc.preferences_ex.saved["engine_settings"] = json.dumps({
            "aria2c": {"options": {
                "seed-time": "300", "seed-ratio": "0", "check-integrity": "false",
                "max-connection-per-server": "3",
            }},
        })
        legacy = asyncio.run(job_submission(UserContext("alice", nc), {
            "url": "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
            "engine": "aria2c",
        }))
        self.assertEqual(legacy["overrides"]["options"], {"max-connection-per-server":"3"})
        # Core's adapter remains the authority for zero seed time;
        # the plugin must not send its own duplicate policy override.

    def test_first_user_download_creates_only_own_default_folder(self):
        nc = FakeNc("alice")
        nc.preferences_ex.saved["dav_app_password"] = "password"
        ctx = UserContext("alice", nc)
        payload = asyncio.run(job_submission(ctx, {"url": "https://example.test/a"}))
        self.assertEqual(payload["delivery"]["folder"], "Downloads")
        self.assertEqual(nc.files.created, ["/Downloads"])

    def test_first_use_default_folder_handles_real_nc_py_api_dav_404(self):
        """nc_py_api raises a 404 on PROPFIND; it never returns None."""
        class WebDAVFiles(Files):
            async def by_path(self, name):
                if name not in self.paths:
                    raise NextcloudException(404, reason="Not Found")
                return SimpleNamespace(is_dir=True)
        nc = FakeNc("alice")
        nc.files = WebDAVFiles()
        nc.preferences_ex.saved["dav_app_password"] = "secret"
        job = asyncio.run(job_submission(UserContext("alice", nc), {
            "url": "https://example.test/dummy.pdf",
        }))
        self.assertEqual(job["delivery"]["folder"], "Downloads")
        self.assertEqual(job["delivery"]["username"], "alice")
        self.assertEqual(nc.files.created, ["/Downloads"])
        # A second submission reuses the existing folder without recreating.
        asyncio.run(job_submission(UserContext("alice", nc), {
            "url": "https://example.test/dummy.pdf",
        }))
        self.assertEqual(nc.files.created, ["/Downloads"])

    def test_missing_selected_folder_never_autocreated_even_on_dav_404(self):
        class MissingFiles(Files):
            async def by_path(self, name):
                raise NextcloudException(404, reason="Not Found")
        nc = FakeNc("alice")
        nc.files = MissingFiles()
        nc.preferences_ex.saved["dav_app_password"] = "secret"
        for data in ({"folder": "Downloads"}, {"folder": "Private"}):
            with self.subTest(data=data), self.assertRaises(HTTPException) as e:
                asyncio.run(job_submission(UserContext("alice", nc), {
                    "url": "https://example.test/dummy.pdf", **data,
                }))
            self.assertEqual(e.exception.status_code, 409)
            self.assertIn("missing", e.exception.detail)
        self.assertEqual(nc.files.created, [])

    def test_unauthorized_and_server_dav_errors_do_not_create_folder(self):
        class BrokenFiles(Files):
            error = 403
            async def by_path(self, name):
                raise NextcloudException(self.error, reason="DAV failed")
        nc = FakeNc("alice")
        nc.files = BrokenFiles()
        nc.preferences_ex.saved["dav_app_password"] = "secret"
        for status in (401, 403, 429, 500, 503):
            with self.subTest(status=status):
                nc.files.error = status
                with self.assertRaises(HTTPException) as e:
                    asyncio.run(job_submission(UserContext("alice", nc), {
                        "url": "https://example.test/dummy.pdf",
                    }))
                self.assertEqual(e.exception.status_code, 409)
                self.assertIn("Cannot open", e.exception.detail)
        self.assertEqual(nc.files.created, [])

    def test_first_use_mkdir_failure_has_actionable_message(self):
        class UnwritableFiles(Files):
            async def by_path(self, name):
                raise NextcloudException(404)
            async def makedirs(self, name, exist_ok=False):
                raise NextcloudException(403, reason="Forbidden")
        nc = FakeNc("alice")
        nc.files = UnwritableFiles()
        nc.preferences_ex.saved["dav_app_password"] = "secret"
        with self.assertRaises(HTTPException) as e:
            asyncio.run(job_submission(UserContext("alice", nc), {
                "url": "https://example.test/dummy.pdf",
            }))
        self.assertEqual(e.exception.status_code, 409)
        self.assertIn("Could not create", e.exception.detail)

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
        subject, detail = delivery_notification({"status": "skipped", "output_files": [
            {"filename": "existing.mp4", "skipped": True, "skip_reason": "exists"}]})
        self.assertEqual(subject, "Download skipped")
        self.assertIn("already exists", detail)
        self.assertIn("left unchanged", detail)


    def test_old_personal_preset_data_is_readable_but_not_applied(self):
        from nextcloud_exapp.user import read_legacy_personal_presets
        alice = UserContext("alice", FakeNc("alice"))
        alice.nc.preferences_ex.saved.update({
            "user_presets": '[{"id":"legacy-one","name":"Old option","engine":"generic","settings":{}}]',
            "default_preset": "legacy-one",
            "dav_app_password": "owner-only-secret",
        })
        rows = asyncio.run(read_legacy_personal_presets(alice))
        self.assertEqual(rows[0]["id"], "legacy-one")
        self.assertNotIn("default_preset", asyncio.run(read_user_preferences(alice)))
        job = asyncio.run(job_submission(alice, {"url": "https://example.test/media"}))
        self.assertEqual(job["engine"], "auto")
        self.assertNotIn("preset_id", job)
        with self.assertRaises(HTTPException) as failure:
            asyncio.run(job_submission(alice, {
                "url": "https://example.test/media", "preset_id": "legacy-one",
            }))
        self.assertEqual(failure.exception.status_code, 422)


class TrackingTests(TestCase):
    def test_tracker_uses_nextcloud_persistent_volume_without_unwritable_home(self):
        import os
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict(os.environ, {"APP_PERSISTENT_STORAGE": temp}):
                tracker = JobTracker()
                self.assertEqual(tracker.path.parent, Path(temp))
                tracker.add("tracked", "alice")
                self.assertEqual(JobTracker().pending(), [("tracked", "alice")])

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
                    return SimpleNamespace(
                        notifications=FakeNotifications(user),
                        preferences_ex=Pref(),
                    )
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


    def test_tracker_failure_health_is_redacted_rate_limited_and_recovers_after_restart(self):
        import logging
        async def scenario():
            with tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "notifications.sqlite"
                tracker = JobTracker(path)
                tracker.add("failed-first", "alice")
                fake = FakeNc("alice")
                attempted = []

                class BrokenNotifications:
                    async def create(self, **kwargs):
                        attempted.append(kwargs)
                        raise RuntimeError("private credential failure must not enter log or health")

                fake.notifications = BrokenNotifications()
                with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", return_value=fake), \
                     patch("nextcloud_exapp.tracking.LOGGER.warning") as warning:
                    async def core(job_id):
                        return {"id": job_id, "owner_id": "alice", "status": "failed"}
                    for _ in range(4):
                        await tracker.tick(core)
                    status = tracker.health()
                    self.assertEqual(status["status"], "degraded")
                    self.assertEqual(status["pending_notifications"]["count"], 1)
                    self.assertIsNotNone(status["pending_notifications"]["oldest_pending_seconds"])
                    self.assertEqual(status["consecutive_failures"]["notification"], 4)
                    self.assertEqual(status["consecutive_failures"]["index"], 0)
                    self.assertEqual(warning.call_count, 1)
                    self.assertNotIn("private credential", str(warning.call_args))
                    self.assertNotIn("alice", str(status))
                    self.assertNotIn("failed-first", str(status))
                # Restart preserves outstanding rows; notifications remain incomplete.
                tracker = JobTracker(path)
                self.assertEqual(tracker.pending(), [("failed-first", "alice")])
                delivered = []
                class WorkingNotifications:
                    async def create(self, **kwargs):
                        delivered.append(kwargs)
                fake.notifications = WorkingNotifications()
                with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", return_value=fake), \
                     patch("nextcloud_exapp.tracking.update_index", side_effect=RuntimeError("index offline")):
                    await tracker.tick(core)
                    await tracker.tick(core)
                self.assertEqual(len(delivered), 1, "Indexing failures must not duplicate native notifications")
                self.assertEqual(tracker.flags("failed-first"), (True, False))
                self.assertEqual(tracker.health()["consecutive_failures"]["index"], 2)
                with patch("nextcloud_exapp.tracking.AsyncNextcloudApp", return_value=fake), \
                     patch("nextcloud_exapp.tracking.update_index", return_value=None), \
                     patch("nextcloud_exapp.tracking.reconcile_first_verified", return_value=None):
                    await tracker.tick(core)
                self.assertEqual(tracker.pending(), [])
                self.assertEqual(len(delivered), 1)
                self.assertEqual(tracker.health()["status"], "ready")
        asyncio.run(scenario())

    def test_tracker_health_is_admin_only(self):
        from nextcloud_exapp.main import admin_tracker_health
        tracker = JobTracker(Path(tempfile.mkdtemp()) / "notices.sqlite")
        try:
            request = Request({
                "type": "http", "headers": [], "username": "alice",
                "app": SimpleNamespace(state=SimpleNamespace(job_tracker=tracker)),
            })
            state = asyncio.run(admin_tracker_health(request, UserContext("alice", FakeNc("alice"))))
            self.assertEqual(state["pending_notifications"]["count"], 0)
            self.assertEqual(state["status"], "ready")
        finally:
            import shutil
            shutil.rmtree(tracker.path.parent)


class ProvenanceContractTests(TestCase):
    def test_provenance_owner_isolation(self):
        from nextcloud_exapp.user import own_job_provenance
        good = {"owner_id": "alice", "file_id": "55", "source_url": "https://example.test/owned"}
        self.assertEqual(own_job_provenance(good, "alice"), good)
        for other in ("bob", "", None):
            with self.assertRaises(HTTPException) as err:
                own_job_provenance(good, other)
            self.assertEqual(err.exception.status_code, 404)

    def test_redownload_uses_own_core_record(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parents[1] / "nextcloud_exapp/main.py").read_text()
        self.assertIn('params={"owner_id": context.user_id, "file_id": file_id}', source)
        self.assertIn('request_data = {"url": provenance["source_url"]}', source)
        self.assertIn('submitted = await job_submission(context, request_data)', source)
        self.assertIn('await job_submission(', source)
        # Redownload still resolves exclusively from the signed owner's provenance.
        self.assertIn('own_job_provenance(', source)


class BulkRetryVisibilityTests(TestCase):
    def test_bulk_retry_excludes_hidden_and_cancelled_jobs(self):
        """A removed or deliberately cancelled job must never restart in bulk."""
        import json
        from nextcloud_exapp.main import retry_owner_failed
        from unittest.mock import MagicMock

        nc = FakeNc("alice")
        nc.preferences_ex.saved["hidden_history"] = json.dumps(["22222222-2222-4222-8222-222222222222"])
        context = UserContext("alice", nc)
        tracker = MagicMock()
        request = Request({
            "type": "http", "headers": [],
            "app": SimpleNamespace(state=SimpleNamespace(job_tracker=tracker)),
        })
        jobs = [
            {"id": "11111111-1111-4111-8111-111111111111", "owner_id": "alice", "status": "failed"},
            {"id": "22222222-2222-4222-8222-222222222222", "owner_id": "alice", "status": "failed"},
            {"id": "33333333-3333-4333-8333-333333333333", "owner_id": "alice", "status": "cancelled"},
        ]
        calls = []

        async def mock_core(method, path, **kwargs):
            calls.append((method, path))
            if method == "GET" and path == "jobs":
                return jobs
            if method == "GET" and path.startswith("jobs/"):
                return next(row for row in jobs if row["id"] == path.split("/")[1])
            if method == "POST" and path == "jobs/11111111-1111-4111-8111-111111111111/retry":
                return {"id": "11111111-1111-4111-8111-111111111111", "owner_id": "alice", "status": "queued"}
            raise AssertionError((method, path))

        with patch("nextcloud_exapp.main.core_json", side_effect=mock_core):
            result = asyncio.run(retry_owner_failed(request, context))
        self.assertEqual(result, {"retried": 1})
        self.assertEqual([p for method, p in calls if method == "POST"],
                         ["jobs/11111111-1111-4111-8111-111111111111/retry"])
        tracker.reset.assert_called_once_with("11111111-1111-4111-8111-111111111111")

    def test_visible_owner_snapshot_excludes_hidden_history(self):
        import json
        from nextcloud_exapp.main import _visible_owner_jobs
        nc = FakeNc("alice")
        nc.preferences_ex.saved["hidden_history"] = json.dumps(["44444444-4444-4444-8444-444444444444"])
        context = UserContext("alice", nc)
        async def fake_core(method, path, **kwargs):
            return [
                {"id": "44444444-4444-4444-8444-444444444444", "owner_id": "alice", "status": "failed"},
                {"id": "55555555-5555-4555-8555-555555555555", "owner_id": "alice", "status": "failed"},
            ]
        with patch("nextcloud_exapp.main.core_json", side_effect=fake_core):
            visible = asyncio.run(_visible_owner_jobs(context, "failed"))
        self.assertEqual([job["id"] for job in visible], ["55555555-5555-4555-8555-555555555555"])
