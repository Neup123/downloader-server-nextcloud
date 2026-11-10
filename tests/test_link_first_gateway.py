"""#138: signed bounded preview and torrent post-download no-seeding safety."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
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
    nc=SimpleNamespace(preferences_ex=Pref(),files=Files(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.org/remote.php/dav"))
    return UserContext("alice",nc)


def test_media_preview_forwards_bounded_extractor_only_under_signed_user():
    routes={route.path:route for route in APP.routes if hasattr(route,'dependant')}
    preview=routes["/user/api/media-preview"]
    assert any(dep.call.__name__=="require_user" for dep in preview.dependant.dependencies)
    request=Request({"type":"http","headers":[]})
    request._json={"url":"https://example.org/watch","max_entries":24}
    async def run():
        with patch("nextcloud_exapp.main.core_json",new=AsyncMock(
                return_value={"kind":"video","title":"Example"})) as core:
            got=await user_media_preview(request, context())
            core.assert_awaited_once_with("POST","preview",payload={
                "url":"https://example.org/watch","max_entries":24})
            assert got["kind"]=="video"
    asyncio.run(run())


@pytest.mark.parametrize("bad",[
    {"url":"https://example.org/watch","max_entries":101},
    {"url":"https://example.org/watch","max_entries":0},
    {"url":"https://example.org/watch","max_entries":True},
    {"url":"https://example.org/watch","max_entries":"24"},
    {"url":"https://example.org/watch"},
    {"url":"https://example.org/watch","max_entries":24,"owner_id":"bob"},
])
def test_invalid_or_unbounded_preview_never_reaches_core(bad):
    request=Request({"type":"http","headers":[]})
    request._json=bad
    async def run():
        with patch("nextcloud_exapp.main.core_json",new=AsyncMock()) as core:
            with pytest.raises(HTTPException) as error:
                await user_media_preview(request,context())
            assert error.value.status_code==422
            core.assert_not_awaited()
    asyncio.run(run())


def test_nextcloud_aria2_job_forces_seed_time_zero_over_user_and_request():
    ctx=context()
    job=asyncio.run(job_submission(ctx,{
        "url":"magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
        "overrides":{"options":{"seed-time":"500","seed-ratio":"0"}},
    }))
    assert job["engine"]=="aria2c"
    assert job["overrides"]["options"]["seed-time"]=="0"
    # aria2 documents seed-ratio=0 as unlimited; seed-time=0 is critical.
    assert job["overrides"]["options"]["seed-ratio"]=="0"


def test_normal_media_still_uses_user_webdav_and_does_not_gain_aria2_options():
    ctx=context()
    job=asyncio.run(job_submission(ctx,{
        "url":"https://example.org/video",
        "engine":"yt-dlp",
    }))
    assert job["engine"]=="yt-dlp"
    assert "options" not in job["overrides"]
    assert job["delivery"]["username"]=="alice"
