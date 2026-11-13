"""#138: signed bounded preview and no post-download seeding for Nextcloud jobs."""
from __future__ import annotations

import asyncio
import base64
import httpx
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.requests import Request

from nextcloud_exapp.main import APP, core_json, user_media_preview, user_torrent_manifest
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
                }, preview_reason_code=True)
                self.assertEqual(got["kind"], "video")

        asyncio.run(run())

    def _core_error(self, body, *, path="preview"):
        async def run():
            client = httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(422, json=body),
            ))
            settings = SimpleNamespace(origin="https://core.example.org", token="test-token")
            with (patch("nextcloud_exapp.main.config", return_value=settings),
                  patch("nextcloud_exapp.main.httpx.AsyncClient", return_value=client)):
                with self.assertRaises(HTTPException) as caught:
                    if path == "preview":
                        request = Request({"type": "http", "headers": []})
                        request._json = {"url": "https://example.org/watch", "max_entries": 24}
                        await user_media_preview(request, context())
                    else:
                        await core_json("GET", path)
                return caught.exception
        return asyncio.run(run())

    def test_preview_error_forwards_stable_reason_without_engine_detail(self):
        error = self._core_error({
            "reason_code": "item_not_found",
            "detail": "PRIVATE_RAW_ENGINE_ERROR: internal extractor trace",
        })
        self.assertEqual(error.status_code, 422)
        self.assertEqual(error.detail, {
            "message": "Media preview check failed",
            "reason_code": "item_not_found",
        })
        self.assertNotIn("PRIVATE_RAW_ENGINE_ERROR", str(error.detail))

    def test_preview_error_without_code_keeps_legacy_string_detail(self):
        error = self._core_error({"detail": "Legacy Core preview error"})
        self.assertEqual(error.status_code, 422)
        self.assertEqual(error.detail, "Legacy Core preview error")

    def test_unknown_preview_reason_code_is_not_forwarded(self):
        error = self._core_error({
            "reason_code": "UNKNOWN_ENGINE_DETAIL",
            "detail": "Legacy Core preview error",
        })
        self.assertEqual(error.detail, "Legacy Core preview error")

    def test_other_endpoints_keep_string_detail_even_when_core_has_code(self):
        error = self._core_error({
            "reason_code": "item_not_found",
            "detail": "Existing string error contract",
        }, path="jobs")
        self.assertEqual(error.status_code, 422)
        self.assertEqual(error.detail, "Existing string error contract")

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


    def test_offset_window_is_forwarded_and_invalid_offsets_are_rejected(self):
        request = Request({"type": "http", "headers": []})
        request._json = {"url": "https://example.org/playlist", "max_entries": 100, "offset": 100}

        async def run():
            with patch("nextcloud_exapp.main.core_json", new=AsyncMock(
                return_value={"kind": "playlist", "has_more": False,
                              "next_offset": None, "entries": [{"index": 101}]},
            )) as core:
                data = await user_media_preview(request, context())
                self.assertEqual(data["entries"][0]["index"], 101)
                core.assert_awaited_once_with("POST", "preview", payload={
                    "url": "https://example.org/playlist", "max_entries": 100, "offset": 100,
                }, preview_reason_code=True)

        asyncio.run(run())
        for offset in (-1, 100001, "100", True, None):
            invalid = Request({"type": "http", "headers": []})
            invalid._json = {"url": "https://example.org/list", "max_entries": 24, "offset": offset}

            async def reject():
                with patch("nextcloud_exapp.main.core_json", new=AsyncMock()) as core:
                    with self.assertRaises(HTTPException) as error:
                        await user_media_preview(invalid, context())
                    self.assertEqual(error.exception.status_code, 422)
                    core.assert_not_awaited()

            asyncio.run(reject())

    def test_authenticated_manifest_route_forwards_magnet_or_uploaded_bytes_only(self):
        routes = {route.path: route for route in APP.routes if hasattr(route, "dependant")}
        manifest = routes["/user/api/torrent-manifest"]
        self.assertTrue(any(
            dep.call.__name__ == "require_user" for dep in manifest.dependant.dependencies
        ))
        magnet = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789"
        encoded = base64.b64encode(b"x" * 40).decode("ascii")
        for payload in ({"url": magnet}, {"torrent_base64": encoded}):
            request = Request({"type": "http", "headers": []})
            request._json = payload

            async def run():
                with patch("nextcloud_exapp.main.core_json", new=AsyncMock(
                    return_value={"file_count": 1, "files": [
                        {"index": 1, "path": "Album/a.mp3", "name": "a.mp3", "size_bytes": 50},
                    ]},
                )) as core:
                    received = await user_torrent_manifest(request, context())
                    self.assertEqual(received["files"][0]["path"], "Album/a.mp3")
                    core.assert_awaited_once_with("POST", "torrent/manifest", payload=payload)

            asyncio.run(run())

        for invalid in (
            {"url": "https://example.org/x.torrent"},
            {"url": magnet, "torrent_base64": encoded},
            {"torrent_base64": "not base64!!"},
            {"torrent_base64": base64.b64encode(b"tiny").decode("ascii")},
            {"torrent_base64": base64.b64encode(b"x" * 2_000_001).decode("ascii")},
        ):
            request = Request({"type": "http", "headers": []})
            request._json = invalid

            async def reject():
                with patch("nextcloud_exapp.main.core_json", new=AsyncMock()) as core:
                    with self.assertRaises(HTTPException) as error:
                        await user_torrent_manifest(request, context())
                    self.assertEqual(error.exception.status_code, 422)
                    core.assert_not_awaited()

            asyncio.run(reject())

    def test_torrent_selected_indices_preserve_no_seed_policy_in_gateway(self):
        job = asyncio.run(job_submission(context(), {
            "url": "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
            "engine": "aria2c", "content_type": "torrent",
            "overrides": {"options": {"select-file": "1,3", "seed-time": "999"}},
        }))
        self.assertEqual(job["engine"], "aria2c")
        self.assertEqual(job["overrides"]["options"]["select-file"], "1,3")
        self.assertEqual(job["overrides"]["options"]["seed-time"], "0")


if __name__ == "__main__":
    import unittest
    unittest.main()
