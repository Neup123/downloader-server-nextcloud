"""#138: signed bounded preview and no post-download seeding for Nextcloud jobs."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.requests import Request

from nextcloud_exapp.main import APP, user_media_preview
from nextcloud_exapp.user import UserContext, job_submission


class Pref:
    def __init__(self):
        self.data = {"dav_app_password": "secret",
                     "engine_settings": '{"aria2c":{"options":{"seed-time":"15","seed-ratio":"0"}}}'}

    async def get_value(self, key, default=None):
        return self.data.get(key, default)


class Files:
    async def by_path(self, path):
        return SimpleNamespace(is_dir=True)


def context():
    nc = SimpleNamespace(
        preferences_ex=Pref(), files=Files(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.org/remote.php/dav"),
    )
    return UserContext("alice", nc)


class LinkFirstGatewayTests(TestCase):
    def test_media_preview_is_signed_and_bounded_by_core(self):
        routes = {route.path: route for route in APP.routes if hasattr(route, "dependant")}
        preview = routes["/user/api/media-preview"]
        self.assertTrue(any(
            dep.call.__name__ == "require_user" for dep in preview.dependant.dependencies
        ))
        request = Request({"type": "http", "headers": []})
        request._json = {"url": "https://example.org/watch", "max_entries": 24}

        async def run():
            with patch("nextcloud_exapp.main.core_json", new=AsyncMock(
                return_value={"kind": "video", "title": "Example"},
            )) as core:
                got = await user_media_preview(request, context())
                core.assert_awaited_once_with("POST", "preview", payload={
                    "url": "https://example.org/watch", "max_entries": 24,
                })
                self.assertEqual(got["kind"], "video")

        asyncio.run(run())

    def test_invalid_or_unbounded_preview_never_reaches_core(self):
        invalid = (
            {"url": "https://example.org/watch", "max_entries": 101},
            {"url": "https://example.org/watch", "max_entries": 0},
            {"url": "https://example.org/watch", "max_entries": True},
            {"url": "https://example.org/watch", "max_entries": "24"},
            {"url": "https://example.org/watch"},
            {"url": "https://example.org/watch", "max_entries": 24, "owner_id": "bob"},
        )
        for bad in invalid:
            with self.subTest(bad=bad):
                request = Request({"type": "http", "headers": []})
                request._json = bad

                async def run():
                    with patch("nextcloud_exapp.main.core_json", new=AsyncMock()) as core:
                        with self.assertRaises(HTTPException) as rejected:
                            await user_media_preview(request, context())
                        self.assertEqual(rejected.exception.status_code, 422)
                        core.assert_not_awaited()

                asyncio.run(run())

    def test_aria2_seed_time_is_zero_even_after_user_override(self):
        job = asyncio.run(job_submission(context(), {
            "url": "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
            "overrides": {"options": {"seed-time": "500", "seed-ratio": "0"}},
        }))
        self.assertEqual(job["engine"], "aria2c")
        self.assertEqual(job["overrides"]["options"]["seed-time"], "0")
        # seed-ratio=0 is unlimited, but seed-time=0 disables post-completion seeding.
        self.assertEqual(job["overrides"]["options"]["seed-ratio"], "0")

    def test_media_preserves_webdav_without_aria2_overrides(self):
        job = asyncio.run(job_submission(context(), {
            "url": "https://example.org/video", "engine": "yt-dlp",
        }))
        self.assertEqual(job["engine"], "yt-dlp")
        self.assertNotIn("options", job["overrides"])
        self.assertEqual(job["delivery"]["username"], "alice")


if __name__ == "__main__":
    import unittest
    unittest.main()
