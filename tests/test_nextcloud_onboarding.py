"""Real first-run state must be owner-scoped, verified and recoverable."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from starlette.requests import Request

from nextcloud_exapp.main import user_page, user_jobs
from nextcloud_exapp.user import UserContext, read_user_preferences


class Preferences:
    def __init__(self):
        self.data = {}
    async def get_value(self, key, default=""):
        return self.data.get(key, default)
    async def set_value(self, key, value):
        self.data[key] = value


def ctx():
    nc = SimpleNamespace(preferences_ex=Preferences())
    return UserContext("alice", nc)


def job(status, verified, owner="alice"):
    return {
        "id": "example", "owner_id": owner, "status": status,
        "output_files": [{"filename": "example.pdf", "verified": verified}],
    }


def test_verified_completion_is_durable_and_unverified_work_is_not():
    context = ctx()
    async def fetch(result):
        with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[result])), \
             patch("nextcloud_exapp.main.update_index", new=AsyncMock()):
            return await user_jobs(context=context)

    asyncio.run(fetch(job("failed", True)))
    asyncio.run(fetch(job("completed", False)))
    assert context.nc.preferences_ex.data == {}
    asyncio.run(fetch(job("completed", True)))
    assert context.nc.preferences_ex.data == {"first_download_verified": "1"}
    preferences = asyncio.run(read_user_preferences(context))
    assert preferences["first_download_verified"] is True
    assert preferences["app_password_configured"] is False


def test_other_peoples_jobs_cannot_complete_my_onboarding():
    context = ctx()
    async def fetch():
        with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[job("completed", True, "bob")])):
            await user_jobs(context=context)
    try:
        asyncio.run(fetch())
    except HTTPException as error:
        assert error.status_code == 404
    else:
        raise AssertionError("Another owner's job was accepted")
    assert "first_download_verified" not in context.nc.preferences_ex.data


def test_direct_link_explains_non_entitlement_without_a_raw_403():
    request = Request({"type": "http", "headers": [], "username": "alice"})
    async def denied(code):
        with patch("nextcloud_exapp.main.require_user", new=AsyncMock(
            side_effect=HTTPException(status_code=code, detail="Denied")
        )):
            return await user_page(request)
    response = asyncio.run(denied(403))
    assert response.status_code == 200
    assert b"not enabled for your account" in response.body
    assert b"administrator" in response.body
    try:
        asyncio.run(denied(401))
    except HTTPException as error:
        assert error.status_code == 401
    else:
        raise AssertionError("Unsigned identities must remain denied")
