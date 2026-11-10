"""Built-in presets ship with Nextcloud even before user or admin setup."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import pytest

from nextcloud_exapp.user import built_in_presets, job_submission
from nextcloud_exapp.main import user_presets
from types import SimpleNamespace

class Preferences:
    def __init__(self):
        self.values = {"dav_app_password": "user-secret"}
    async def get_value(self, name, default=None):
        return self.values.get(name, default)
    async def set_value(self, name, value, sensitive=False):
        self.values[name] = value

class AppConfig:
    async def get_value(self, key, default="[]"):
        return default


class Files:
    async def by_path(self, path):
        return SimpleNamespace(is_dir=True)
    async def makedirs(self, path, exist_ok=False):
        return None

def context(user_id):
    from nextcloud_exapp.user import UserContext
    return UserContext(user_id, SimpleNamespace(
        preferences_ex=Preferences(), files=Files(), appconfig_ex=AppConfig(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.org/remote.php/dav"),
    ))



def test_builtins_are_read_only_stable_and_safe():
    rows = built_in_presets()
    assert len(rows) == 19
    assert rows[0]["id"] == "builtin:best"
    assert {row["engine"] for row in rows} == {"yt-dlp", "aria2c", "generic", "gallery-dl"}
    assert all(row["id"].startswith("builtin:") and row["is_builtin"]
               and row["is_shared"] is False and isinstance(row["settings"], dict)
               for row in rows)
    assert len({row["id"] for row in rows}) == len(rows)
    rows[0]["settings"]["format"] = "modified"
    assert built_in_presets()[0]["settings"]["format"] == "bv*+ba/b"


def test_fresh_user_gets_builtins_and_can_submit_without_core_admin_presets():
    alice = context("alice")
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[])):
        rows = asyncio.run(user_presets(context=alice))
    assert len(rows) == len(built_in_presets())
    assert [row["id"] for row in rows] == [row["id"] for row in built_in_presets()]
    for preset in rows:
        payload = asyncio.run(job_submission(alice, {
            "url": "https://example.com/media", "preset_id": preset["id"],
        }))
        assert payload["preset_id"] is None
        assert payload["engine"] == preset["engine"]
        assert payload["overrides"] == preset["settings"]


def test_builtins_cannot_be_forged_or_modified_as_personal_presets():
    from nextcloud_exapp.user import save_user_preset, delete_user_preset
    alice = context("alice")
    with pytest.raises(HTTPException) as error:
        asyncio.run(job_submission(alice, {
            "url": "https://example.com/media", "preset_id": "builtin:unknown",
        }))
    assert error.value.status_code == 404
    with pytest.raises(HTTPException):
        asyncio.run(save_user_preset(alice, {
            "name": "Changed", "engine": "yt-dlp", "settings": {},
        }, "builtin:best"))
    with pytest.raises(HTTPException):
        asyncio.run(delete_user_preset(alice, "builtin:best"))
