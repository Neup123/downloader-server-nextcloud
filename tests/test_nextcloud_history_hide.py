"""A user's history hide is never a Core job deletion or another user's write."""
from __future__ import annotations
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from nextcloud_exapp.main import hide_user_job, hidden_history_ids
from nextcloud_exapp.user import UserContext


class Pref:
    def __init__(self):
        self.values = {}
    async def get_value(self, key, default):
        return self.values.get(key, default)
    async def set_value(self, key, value):
        self.values[key] = value


def test_owner_only_hide_persists_without_deleting_core_job_or_files():
    alice = UserContext("alice", SimpleNamespace(preferences_ex=Pref()))
    async def core(method, path):
        assert (method, path) == ("GET", "jobs/11111111-1111-4111-8111-111111111111")
        return {"id": "11111111-1111-4111-8111-111111111111", "owner_id": "alice", "status": "completed"}
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(side_effect=core)) as mocked:
        assert asyncio.run(hide_user_job("11111111-1111-4111-8111-111111111111", alice)) == {"hidden": True}
        assert asyncio.run(hidden_history_ids(alice)) == {"11111111-1111-4111-8111-111111111111"}
        assert mocked.await_count == 1
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(
        return_value={"id": "22222222-2222-4222-8222-222222222222", "owner_id": "bob", "status": "completed"}
    )):
        with pytest.raises(HTTPException) as rejected:
            asyncio.run(hide_user_job("22222222-2222-4222-8222-222222222222", alice))
    assert rejected.value.status_code == 404
    assert asyncio.run(hidden_history_ids(alice)) == {"11111111-1111-4111-8111-111111111111"}
