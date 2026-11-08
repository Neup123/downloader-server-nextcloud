"""Native Library uses signed owner scope; bulk operations never touch Files."""
from __future__ import annotations
import asyncio
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from nextcloud_exapp.main import user_library, retry_owner_failed, clear_owner_history
from nextcloud_exapp.user import UserContext


class Pref:
    def __init__(self):
        self.values = {}
    async def get_value(self, name, default=None):
        return self.values.get(name, default)
    async def set_value(self, name, value):
        self.values[name] = value

def context():
    return UserContext("alice", SimpleNamespace(preferences_ex=Pref()))


def test_paged_library_cursor_is_based_on_core_page_not_hidden_rows():
    ctx = context()
    ctx.nc.preferences_ex.values["hidden_history"] = '["a"]'
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=[
        {"id": "a", "owner_id": "alice"}, {"id": "b", "owner_id": "alice"}
    ])) as upstream:
        page = asyncio.run(user_library(limit=2, offset=4, q="movie", state="failed", context=ctx))
    assert [job["id"] for job in page["jobs"]] == ["b"]
    assert page["next_offset"] == 6
    assert upstream.await_args.kwargs["params"] == {
        "owner_id": "alice", "limit": 2, "offset": 4, "q": "movie", "state": "failed"
    }
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(
        return_value=[{"id": "other", "owner_id": "bob"}]
    )):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(user_library(limit=1, offset=0, q="", state="all", context=ctx))
    assert exc.value.status_code == 404


def test_clear_history_is_explicit_and_only_hides_terminal_owned_records():
    ctx = context()
    request = Request({"type": "http", "headers": []})
    request._json = {"confirm": True}
    async def core(method, path, **kwargs):
        assert method == "GET" and path == "jobs"
        if kwargs["params"]["state"] == "delivered":
            return [{"id":"done","owner_id":"alice","status":"completed"}]
        if kwargs["params"]["state"] == "failed":
            return [{"id":"failed","owner_id":"alice","status":"failed"}]
        raise AssertionError(kwargs)
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(side_effect=core)):
        result = asyncio.run(clear_owner_history(request,ctx))
    assert result == {"hidden":2, "files_retained":True}
    assert set(__import__("json").loads(ctx.nc.preferences_ex.values["hidden_history"])) == {"done","failed"}
    request._json = {"confirm": False}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(clear_owner_history(request,ctx))
    assert exc.value.status_code == 422


def test_retry_all_failed_rechecks_owner_and_resets_each_tracker_id():
    ctx = context()
    reset = []
    tracker = SimpleNamespace(reset=reset.append)
    request = Request({"type":"http","headers":[],"app":SimpleNamespace(state=SimpleNamespace(job_tracker=tracker))})
    async def core(method, path, **kwargs):
        if path == "jobs":
            assert kwargs["params"]["owner_id"] == "alice"
            return [{"id":"failed","owner_id":"alice","status":"failed"}]
        if path == "jobs/failed" and method == "GET":
            return {"id":"failed","owner_id":"alice","status":"failed"}
        if path == "jobs/failed/retry" and method == "POST":
            return {"id":"failed","owner_id":"alice","status":"queued"}
        raise AssertionError((method,path,kwargs))
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(side_effect=core)):
        result = asyncio.run(retry_owner_failed(request,ctx))
    assert result == {"retried":1} and reset == ["failed"]
