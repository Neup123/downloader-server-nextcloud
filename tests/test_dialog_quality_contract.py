"""Owner-scoped default quality and the ExApp-to-Core media-format contract."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from nextcloud_exapp.user import (
    UserContext, job_submission, read_user_preferences, write_user_preferences,
)


class Preferences:
    def __init__(self, values=None):
        self.values = dict(values or {})

    async def get_value(self, key, default=None):
        return self.values.get(key, default)

    async def set_value(self, key, value):
        self.values[key] = value


class Files:
    async def by_path(self, path):
        assert path == "/Music"
        return SimpleNamespace(is_dir=True)


def context(user_id, values=None):
    return UserContext(user_id, SimpleNamespace(
        preferences_ex=Preferences(values), files=Files(),
    ))


def test_user_quality_defaults_are_private_and_validated():
    alice, bob = context("alice"), context("bob")
    first = asyncio.run(read_user_preferences(alice))
    assert first["default_video_quality"] == "best"
    assert first["default_audio_quality"] == "best"
    updated = asyncio.run(write_user_preferences(alice, {
        "default_video_quality": "720", "default_audio_quality": "128",
    }))
    assert updated["default_video_quality"] == "720"
    assert updated["default_audio_quality"] == "128"
    assert asyncio.run(read_user_preferences(bob))["default_audio_quality"] == "best"
    with pytest.raises(HTTPException) as error:
        asyncio.run(write_user_preferences(alice, {"default_audio_quality": "720"}))
    assert error.value.status_code == 422


def test_audio_only_mode_reaches_core_as_audio_only_format():
    ctx = context("alice", {"dav_app_password": "test-secret"})
    payload = {
        "url": "https://example.org/watch?id=1",
        "engine": "yt-dlp", "folder": "Music",
        "audio_only": True, "quality": "128",
        "overrides": {"format": "bestaudio[abr<=128]"},
    }
    with patch("nextcloud_exapp.user.nextcloud_webdav_base",
               return_value="https://cloud.example/remote.php/dav"):
        submitted = asyncio.run(job_submission(ctx, payload))
    assert submitted["owner_id"] == "alice"
    assert submitted["engine"] == "yt-dlp"
    assert submitted["overrides"]["format"] == "bestaudio[abr<=128]"
    assert "audio_only" not in submitted  # Core supports the equivalent format.
    assert "quality" not in submitted
    assert submitted["delivery"]["folder"] == "Music"


@pytest.mark.parametrize("mode,quality,fmt", [
    (False, "720", "bestvideo[height<=720]+bestaudio/best[height<=720]"),
    (True, "best", "bestaudio"),
])
def test_both_modes_preserve_format_through_signed_gateway(mode, quality, fmt):
    ctx = context("alice", {"dav_app_password": "test-secret"})
    with patch("nextcloud_exapp.user.nextcloud_webdav_base",
               return_value="https://cloud.example/remote.php/dav"):
        submitted = asyncio.run(job_submission(ctx, {
            "url": "https://example.org/watch?id=2",
            "engine": "yt-dlp", "folder": "Music",
            "audio_only": mode, "quality": quality, "overrides": {"format": fmt},
        }))
    assert submitted["overrides"]["format"] == fmt


def test_inconsistent_or_malformed_mode_is_rejected_before_core_submission():
    ctx = context("alice", {"dav_app_password": "test-secret"})
    for payload in (
        {"audio_only": True, "quality": "720", "overrides": {"format": "bestaudio"}},
        {"audio_only": True, "quality": "128", "overrides": {"format": "bv*+ba/b"}},
        {"audio_only": False, "quality": "720", "overrides": {"format": "bestaudio"}},
    ):
        with pytest.raises(HTTPException) as error:
            asyncio.run(job_submission(ctx, {
                "url": "https://example.org/watch?id=2",
                "engine": "yt-dlp", "folder": "Music", **payload,
            }))
        assert error.value.status_code == 422
