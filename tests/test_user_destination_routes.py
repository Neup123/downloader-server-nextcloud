"""Issue #139: owner-scoped per-type routing, defaults and context precedence."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException
from nextcloud_exapp.user import (
    ROUTE_SUBFOLDERS, UserContext, default_destination_routes, job_submission,
    read_user_preferences, write_user_preferences, delivery_notification,
)


class Preferences:
    def __init__(self):
        self.values = {"dav_app_password": "secret"}

    async def get_value(self, key, default=None):
        return self.values.get(key, default)

    async def set_value(self, key, value, sensitive=False):
        self.values[key] = value


class Files:
    def __init__(self):
        self.paths = {"/", "/Projects/Review", "/Custom", "/Custom/Podcasts"}
        self.created = []

    async def by_path(self, path):
        return SimpleNamespace(is_dir=True) if path in self.paths else None

    async def makedirs(self, path, exist_ok=False):
        self.paths.add(path)
        self.created.append(path)


def context():
    nc = SimpleNamespace(
        preferences_ex=Preferences(), files=Files(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.org/remote.php/dav"),
    )
    return UserContext("alice", nc)


def run(coro):
    return asyncio.run(coro)


class DestinationRouteTests(TestCase):
    def test_six_defaults_follow_base_folder(self):
        ctx = context()
        prefs = run(read_user_preferences(ctx))
        self.assertEqual(set(prefs["destination_routes"]), set(ROUTE_SUBFOLDERS))
        self.assertEqual(prefs["existing_file_behavior"], "rename")
        self.assertEqual(prefs["destination_routes"]["video"], "Downloads/Video")
        self.assertEqual(prefs["destination_routes"]["audio"], "Downloads/Audio")
        self.assertEqual(prefs["destination_routes"]["images"], "Downloads/Images")
        self.assertEqual(prefs["destination_routes"]["manga"], "Downloads/Manga")
        self.assertEqual(prefs["destination_routes"]["direct"], "Downloads/Direct files")
        self.assertEqual(prefs["destination_routes"]["torrent"], "Downloads/Torrents")
        run(write_user_preferences(ctx, {"destination_folder": "Custom"}))
        self.assertEqual(run(read_user_preferences(ctx))["destination_routes"],
                         default_destination_routes("Custom"))

    def test_every_typed_submission_uses_own_folder_and_creates_default_only(self):
        for kind, subfolder in ROUTE_SUBFOLDERS.items():
            with self.subTest(kind=kind):
                ctx = context()
                job = run(job_submission(ctx, {
                    "url": "https://media.example.org/item",
                    "content_type": kind,
                }))
                self.assertEqual(job["delivery"]["folder"], "Downloads/" + subfolder)
                self.assertEqual(ctx.nc.files.created, ["/Downloads", "/Downloads/" + subfolder])
                self.assertEqual(job["delivery"]["existing_file_behavior"], "rename")
                self.assertEqual(job["delivery"]["username"], "alice")

    def test_explicit_context_folder_overrides_every_type_even_with_custom_route(self):
        ctx = context()
        run(write_user_preferences(ctx, {
            "destination_routes": {"video": "Custom", "audio": "Custom/Podcasts"},
        }))
        for kind in ROUTE_SUBFOLDERS:
            job = run(job_submission(ctx, {
                "url": "https://media.example.org/item", "content_type": kind,
                "folder": "Projects/Review",
            }))
            self.assertEqual(job["delivery"]["folder"], "Projects/Review")
        self.assertEqual(ctx.nc.files.created, [])

    def test_custom_route_skip_preference_and_reset_are_owner_local(self):
        alice, bob = context(), context()
        run(write_user_preferences(alice, {
            "destination_routes": {"audio": "Custom/Podcasts"},
            "existing_file_behavior": "skip",
        }))
        audio = run(job_submission(alice, {
            "url": "https://example.org/song", "content_type": "audio",
        }))
        self.assertEqual(audio["delivery"]["folder"], "Custom/Podcasts")
        self.assertEqual(audio["delivery"]["existing_file_behavior"], "skip")
        self.assertEqual(alice.nc.files.created, [])
        self.assertEqual(run(read_user_preferences(bob))["existing_file_behavior"], "rename")
        run(write_user_preferences(alice, {"destination_routes": {"audio": None}}))
        self.assertEqual(run(read_user_preferences(alice))["destination_routes"]["audio"],
                         "Downloads/Audio")


    def test_skip_generates_durable_native_notification_even_with_finished_opt_out(self):
        subject, message = delivery_notification({
            "status": "completed",
            "output_files": [{"filename": "film.mp4", "skipped": True, "verified": False}],
        })
        self.assertEqual(subject, "Download skipped")
        self.assertIn("left unchanged", message)
        from pathlib import Path
        tracking = (Path(__file__).resolve().parents[1] /
                    "nextcloud_exapp/tracking.py").read_text()
        self.assertIn('if choice != "0" or skipped:', tracking)

    def test_bad_modes_types_and_paths_rejected_without_downgrade(self):
        for bad in ("overwrite", "", "SKIP", None):
            with self.subTest(mode=bad):
                ctx = context()
                with self.assertRaises(HTTPException):
                    run(write_user_preferences(ctx, {"existing_file_behavior": bad}))
        for bad in ({"unknown": "X"}, {"video": "../unsafe"}, {"audio": 42}, []):
            with self.subTest(route=bad):
                ctx = context()
                with self.assertRaises(HTTPException):
                    run(write_user_preferences(ctx, {"destination_routes": bad}))
        with self.assertRaises(HTTPException):
            run(job_submission(context(), {
                "url": "https://example.org/file", "content_type": "not-a-type",
            }))
        with self.assertRaises(HTTPException):
            run(job_submission(context(), {
                "url": "https://example.org/file", "content_type": "video",
                "folder": "Other-Users/Private",
            }))


if __name__ == "__main__":
    import unittest
    unittest.main()
