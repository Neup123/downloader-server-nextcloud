"""Entitled Nextcloud users can consume only Core-admin-approved shared presets.

The ExApp never forwards a raw Core preset ID or another user's preset.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from nextcloud_exapp.main import read_shared_presets, user_presets, user_submit
from nextcloud_exapp.user import (
    UserContext, job_submission, normalize_shared_presets, read_user_presets, built_in_presets,
    save_user_preset, write_user_preferences,
)

GLOBAL_ID = "a24667a0-a792-48db-a1a9-ebdc4fdbfb44"
G_ID = "shared:" + GLOBAL_ID


class Preferences:
    def __init__(self):
        self.values = {"dav_app_password": "owner-secret"}
    async def get_value(self, name, default=None):
        return self.values.get(name, default)
    async def set_value(self, name, value, sensitive=None):
        self.values[name] = value


class Files:
    def __init__(self):
        self.existing = {"/", "/Existing", "/Downloads"}
    async def by_path(self, path):
        return SimpleNamespace(is_dir=True) if path in self.existing else None
    async def makedirs(self, path, exist_ok=False):
        self.existing.add(path)


def context(uid):
    nc = SimpleNamespace(
        preferences_ex=Preferences(), files=Files(),
        app_cfg=SimpleNamespace(dav_endpoint="https://cloud.example.org/remote.php/dav"),
    )
    return UserContext(uid, nc)


def public_record():
    return {
        "id": GLOBAL_ID, "name": "Shared 720p", "engine": "yt-dlp",
        "description": "Approved by administrator",
        "settings": {"format": "best[height<=720]/best"},
        "is_shared": True,
    }


def test_shared_collection_is_namespaced_and_rejects_unsafe_records():
    approved = normalize_shared_presets([public_record()])
    assert approved[0]["id"] == G_ID
    assert approved[0]["is_shared"] is True
    assert approved[0]["settings"]["format"] == "best[height<=720]/best"
    for invalid in [
        {**public_record(), "is_shared": False},
        {**public_record(), "id": "guess"},
        {**public_record(), "settings": {"cookies_file": "alice-private.txt"}},
        {**public_record(), "settings": {"options": {"extractor.pixiv.refresh-token": "secret"}}},
        {**public_record(), "settings": []},
        "bad",
    ]:
        with pytest.raises(HTTPException) as err:
            normalize_shared_presets([invalid])
        assert err.value.status_code == 502


def test_only_core_shared_collection_is_queried_and_older_core_is_compatible():
    async def run():
        with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[public_record()])) as core:
            rows = await read_shared_presets()
            assert rows[0]["id"] == G_ID
            core.assert_awaited_once_with("GET", "presets/shared")
        with patch("nextcloud_exapp.main.core_json",
                   new=AsyncMock(side_effect=HTTPException(status_code=404))):
            assert await read_shared_presets() == []
        with patch("nextcloud_exapp.main.core_json",
                   new=AsyncMock(side_effect=HTTPException(status_code=401))):
            with pytest.raises(HTTPException) as err:
                await read_shared_presets()
            assert err.value.status_code == 401
    asyncio.run(run())


def test_personal_list_stays_owner_scoped_and_shared_is_read_only():
    alice, bob = context("alice"), context("bob")
    private = asyncio.run(save_user_preset(alice, {
        "name": "Alice secret", "engine": "yt-dlp",
        "settings": {"format": "best"},
    }))
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[public_record()])):
        alice_list = asyncio.run(user_presets(alice))
        bob_list = asyncio.run(user_presets(bob))
    assert len(alice_list) == 2 + len(built_in_presets())
    assert len(bob_list) == 1 + len(built_in_presets())
    assert alice_list[0]["id"] == "builtin:best"
    assert alice_list[-2]["id"] == private["id"]
    assert alice_list[-2]["is_shared"] is False
    assert bob_list[-1]["id"] == G_ID and bob_list[-1]["is_shared"] is True
    assert private["id"] not in str(bob_list)
    assert asyncio.run(read_user_presets(bob)) == []


def test_shared_job_merges_settings_without_forwarding_core_preset_id():
    alice, bob = context("alice"), context("bob")
    approved = normalize_shared_presets([public_record()])
    request = {"url": "https://example.org/video", "preset_id": G_ID, "engine": "auto"}
    one = asyncio.run(job_submission(alice, request, shared_presets=approved))
    two = asyncio.run(job_submission(bob, request, shared_presets=approved))
    assert one["owner_id"] == "alice" and two["owner_id"] == "bob"
    assert one["preset_id"] is None and two["preset_id"] is None
    assert one["engine"] == "yt-dlp"
    assert one["overrides"]["format"] == "best[height<=720]/best"
    assert one["delivery"]["app_password"] == "owner-secret"
    assert one["delivery"]["webdav_url"].endswith("/files/alice")
    assert two["delivery"]["webdav_url"].endswith("/files/bob")
    for forbidden in ({"preset_id": "shared:" + str(uuid4())},
                      {"preset_id": G_ID, "engine": "aria2c"}):
        with pytest.raises(HTTPException) as err:
            asyncio.run(job_submission(alice, {"url": "https://example.org/video", **forbidden},
                                       shared_presets=approved))
        assert err.value.status_code in (404, 422)


def test_default_shared_preset_works_and_revoked_id_fails_closed():
    alice = context("alice")
    saved = asyncio.run(write_user_preferences(alice, {"default_preset": G_ID}))
    assert saved["default_preset"] == G_ID
    approved = normalize_shared_presets([public_record()])
    job = asyncio.run(job_submission(alice, {"url": "https://example.org/video"},
                                     shared_presets=approved))
    assert job["overrides"]["format"] == "best[height<=720]/best"
    with pytest.raises(HTTPException) as err:
        asyncio.run(job_submission(alice, {"url": "https://example.org/video"},
                                   shared_presets=[]))
    assert err.value.status_code == 404


def test_signed_user_submit_resolves_fresh_approval_on_each_request():
    alice = context("alice")
    sent = []
    class Tracker:
        def add(self, job_id, owner):
            assert owner == "alice"
    app = SimpleNamespace(state=SimpleNamespace(job_tracker=Tracker()))
    scope = {"type": "http", "headers": [], "app": app}
    request = Request(scope)
    request._json = {"url": "https://example.org/video", "preset_id": G_ID}
    async def core(method, path, **kwargs):
        sent.append((method, path, kwargs))
        if (method, path) == ("GET", "presets/shared"):
            return [public_record()]
        if (method, path) == ("POST", "jobs"):
            assert kwargs["payload"]["preset_id"] is None
            assert kwargs["payload"]["owner_id"] == "alice"
            return {"id": "job-1", "owner_id": "alice", "status": "queued"}
        raise AssertionError((method, path))
    async def run():
        with patch("nextcloud_exapp.main.core_json", side_effect=core), patch(
            "nextcloud_exapp.main.update_index", new=AsyncMock()
        ):
            return await user_submit(request, alice)
    job = asyncio.run(run())
    assert job["id"] == "job-1"
    assert [entry[:2] for entry in sent] == [
        ("GET", "presets/shared"), ("POST", "jobs")
    ]
