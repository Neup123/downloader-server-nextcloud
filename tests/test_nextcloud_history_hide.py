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
        assert (method, path) == ("GET", "jobs/job-1")
        return {"id": "job-1", "owner_id": "alice", "status": "completed"}
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(side_effect=core)) as mocked:
        assert asyncio.run(hide_user_job("job-1", alice)) == {"hidden": True}
        assert asyncio.run(hidden_history_ids(alice)) == {"job-1"}
        assert mocked.await_count == 1
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(
        return_value={"id": "job-2", "owner_id": "bob", "status": "completed"}
    )):
        with pytest.raises(HTTPException) as rejected:
            asyncio.run(hide_user_job("job-2", alice))
    assert rejected.value.status_code == 404
    assert asyncio.run(hidden_history_ids(alice)) == {"job-1"}
