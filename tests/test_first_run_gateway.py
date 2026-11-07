"""A signed user's first verified job completes onboarding, never a queued/foreign job."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from nextcloud_exapp.main import user_jobs
from nextcloud_exapp.user import UserContext


class Preferences:
    def __init__(self):
        self.values = {}
    async def get_value(self, name, default=""):
        return self.values.get(name, default)
    async def set_value(self, name, value, **_):
        self.values[name] = value


def owner(uid):
    prefs = Preferences()
    nc = SimpleNamespace(preferences_ex=prefs)
    return UserContext(uid, nc), prefs


def job(status, files, *, owner_id="alice"):
    return {
        "id": "verified-job", "owner_id": owner_id, "status": status,
        "engine": "generic", "url": "https://example.org/dummy.pdf",
        "progress": {}, "output_files": files,
    }


def listing(ctx, rows):
    with patch("nextcloud_exapp.main.core_json", new=AsyncMock(return_value=rows)) as core, \
         patch("nextcloud_exapp.main.update_index", new=AsyncMock()):
        answer = asyncio.run(user_jobs(context=ctx))
        core.assert_awaited_once_with("GET", "jobs", params={
            "owner_id": ctx.user_id, "limit": 50,
        })
    return answer


@pytest.mark.parametrize("status,files", [
    ("queued", []), ("downloading", []), ("failed", [{"verified": True}]),
    ("completed", []), ("completed", [{"verified": False}]),
    ("completed", [{"verified": True}, {"verified": False}]),
])
def test_only_fully_verified_completed_delivery_advances_first_run(status, files):
    ctx, prefs = owner("alice")
    assert listing(ctx, [job(status, files)])[0]["status"] == status
    assert prefs.values.get("first_download_verified") is None


def test_verified_completed_delivery_persists_across_empty_later_history():
    ctx, prefs = owner("alice")
    verified = [{"verified": True, "filename": "dummy.pdf", "size_bytes": 13264}]
    listing(ctx, [job("completed", verified)])
    assert prefs.values["first_download_verified"] == "1"
    listing(ctx, [])
    assert prefs.values["first_download_verified"] == "1"


def test_foreign_job_never_marks_onboarding_or_reaches_the_owner():
    ctx, prefs = owner("alice")
    with pytest.raises(HTTPException) as err:
        listing(ctx, [job("completed", [{"verified": True}], owner_id="bob")])
    assert err.value.status_code == 404
    assert prefs.values.get("first_download_verified") is None

    bob, bob_prefs = owner("bob")
    assert listing(bob, [job("queued", [], owner_id="bob")])
    assert bob_prefs.values.get("first_download_verified") is None
