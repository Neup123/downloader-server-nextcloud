"""Issue #137: old profile records remain readable but never govern new jobs."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from nextcloud_exapp.main import APP
from nextcloud_exapp.user import (
    UserContext, job_submission, own_job, read_legacy_personal_presets,
    read_user_preferences,
)


class Preferences:
    def __init__(self):
        self.values = {
            "dav_app_password": "owner-password",
            "default_preset": "legacy-1",
            "preset_hidden": '["legacy-1"]',
            "preset_order": '["legacy-1"]',
            "user_presets": json.dumps([
                {"id": "legacy-1", "name": "Old direct file", "engine": "generic",
                 "settings": {}},
            ]),
        }

    async def get_value(self, name, default=None):
        return self.values.get(name, default)


class Files:
    async def by_path(self, path):
        assert path == "/Downloads"
        return SimpleNamespace(is_dir=True)


def profile():
    nc = SimpleNamespace(
        preferences_ex=Preferences(), files=Files(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.org/remote.php/dav"),
    )
    return UserContext("alice", nc)


def test_legacy_profile_and_history_are_readable_without_preset_api():
    context = profile()
    records = asyncio.run(read_legacy_personal_presets(context))
    assert records[0]["name"] == "Old direct file"
    prefs = asyncio.run(read_user_preferences(context))
    assert prefs["default_video_quality"] == "best"
    assert "default_preset" not in prefs
    historical = own_job({"id": "old-job", "owner_id": "alice",
                          "preset_id": "legacy-1", "status": "completed"}, "alice")
    assert historical["preset_id"] == "legacy-1"
    route_paths = [route.path for route in APP.routes if hasattr(route, "path")]
    assert not any("preset" in path for path in route_paths)


def test_submission_ignores_saved_legacy_default_and_never_forwards_preset_id():
    context = profile()
    payload = asyncio.run(job_submission(context, {
        "url": "https://example.com/file.zip",
    }))
    assert payload["engine"] == "auto"
    assert "preset_id" not in payload
    assert payload["owner_id"] == "alice"
    audio = asyncio.run(job_submission(context, {
        "url": "https://example.com/watch?v=1", "engine": "yt-dlp",
        "audio_only": True, "quality": "128",
        "overrides": {"format": "bestaudio[abr<=128]"},
    }))
    assert audio["overrides"]["format"] == "bestaudio[abr<=128]"
    assert "preset_id" not in audio
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(job_submission(context, {
            "url": "https://example.com/file.zip", "preset_id": "legacy-1",
        }))
    assert rejected.value.status_code == 422


def test_malformed_stored_legacy_records_do_not_break_settings_or_submission():
    context = profile()
    context.nc.preferences_ex.values["user_presets"] = "{invalid"
    assert asyncio.run(read_legacy_personal_presets(context)) == []
    assert asyncio.run(read_user_preferences(context))["destination_folder"] == "Downloads"
    assert "preset_id" not in asyncio.run(job_submission(context, {
        "url": "https://example.com/file.zip",
    }))
