"""Built-in presets ship with Nextcloud even before user or admin setup."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import pytest

from nextcloud_exapp.user import built_in_presets, job_submission
from nextcloud_exapp.main import user_presets
from tests.test_shared_preset_gateway import context


def test_builtins_are_read_only_stable_and_safe():
    rows = built_in_presets()
    assert [row["name"] for row in rows] == [
        "Best quality", "Audio only", "Up to 720p", "Small file"
    ]
    assert all(row["id"].startswith("builtin:") and row["is_builtin"]
               and row["engine"] == "yt-dlp" and row["is_shared"] is False
               for row in rows)
    rows[0]["settings"]["format"] = "modified"
    assert built_in_presets()[0]["settings"]["format"] == "bv*+ba/b"


def test_fresh_user_gets_builtins_and_can_submit_without_core_admin_presets():
    alice = context("alice")
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[])):
        rows = asyncio.run(user_presets(alice))
    assert len(rows) == 4
    assert [row["id"] for row in rows] == [row["id"] for row in built_in_presets()]
    for preset in rows:
        payload = asyncio.run(job_submission(alice, {
            "url": "https://example.com/media", "preset_id": preset["id"],
        }))
        assert payload["preset_id"] is None
        assert payload["engine"] == "yt-dlp"
        assert payload["overrides"]["format"] == preset["settings"]["format"]


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
