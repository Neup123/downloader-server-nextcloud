"""Administrator sees only Files readiness, never any user's sensitive app secret."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
import pytest

from nextcloud_exapp.main import APP, admin_read_files_connections
from nextcloud_exapp.user import UserContext, admin_files_connection_status, require_admin


class Config:
    def __init__(self, users="", groups=""):
        self.data = {"allowed_users": users, "allowed_groups": groups}
    async def get_value(self, key, default=""):
        return self.data.get(key, default)


class Directory:
    def __init__(self, groups=None, broken=None):
        self.groups = groups or {}
        self.broken = set(broken or ())
    async def get_user(self, uid):
        if uid in self.broken:
            raise RuntimeError("No directory permission")
        return SimpleNamespace(groups=self.groups.get(uid, []))


class FakeAdmin:
    def __init__(self, explicit="", allowed_groups="", members=(), memberships=None,
                 broken=(), unavailable=False):
        self.appconfig_ex = Config(explicit, allowed_groups)
        self.users = Directory(memberships, broken)
        self.member_ids = list(members)
        self.unavailable = unavailable
        self.list_calls = 0
    async def users_list(self):
        self.list_calls += 1
        if self.unavailable:
            raise RuntimeError("Directory unavailable")
        return self.member_ids


class FakeUser:
    secrets = {}
    def __init__(self, user):
        self.uid = user
        self.preferences_ex = SimpleNamespace(get_value=self.get_secret)
    async def get_secret(self, field, default=""):
        assert field == "dav_app_password"
        if self.uid == "unreadable":
            raise RuntimeError("Personal prefs not readable")
        return self.secrets.get(self.uid, default)


async def check(admin):
    with patch("nextcloud_exapp.user.AsyncNextcloudApp", FakeUser):
        return await admin_files_connection_status(UserContext("admin", admin))


def test_admin_route_does_not_grant_personal_user_access():
    route = next(x for x in APP.routes
                 if getattr(x, "path", "") == "/admin/api/files-connections")
    assert route.methods == {"GET"}
    assert require_admin in {dep.call for dep in route.dependant.dependencies}
    assert all(dep.call is not None for dep in route.dependant.dependencies)


def test_individual_grants_are_scoped_and_never_return_app_password():
    FakeUser.secrets = {"alice": "a-secret", "bob": "bob-secret"}
    admin = FakeAdmin(explicit="alice,unreadable", memberships={
        "alice": [], "unreadable": [],
    })
    result = asyncio.run(check(admin))
    assert admin.list_calls == 0
    assert result["partial"] is False
    assert result["users"] == [
        {"user_id": "alice", "via_groups": [], "explicit": True,
         "connection": "connected"},
        {"user_id": "unreadable", "via_groups": [], "explicit": True,
         "connection": "unknown"},
    ]
    assert "a-secret" not in str(result) and "bob-secret" not in str(result)
    assert "bob" not in str(result)


def test_group_membership_excludes_nonentitled_users_and_counts_status():
    FakeUser.secrets = {"alice": "secret", "bob": "", "carol": "private"}
    admin = FakeAdmin(
        explicit="carol",
        allowed_groups="writers,viewers",
        members=["alice", "bob", "carol", "outsider"],
        memberships={
            "alice": ["writers"], "bob": ["writers", "viewers"],
            "carol": [], "outsider": ["none"],
        },
    )
    result = asyncio.run(check(admin))
    assert [u["user_id"] for u in result["users"]] == ["alice", "bob", "carol"]
    writers = next(g for g in result["groups"] if g["name"] == "writers")
    assert writers == {
        "name": "writers", "members_checked": 2, "connected": 1,
        "not_connected": 1, "unknown": 0, "partial": False,
    }
    assert "outsider" not in str(result)
    assert "private" not in str(result)
    assert not result["partial"]


def test_incomplete_directory_returns_unknown_coverage_not_false_disconnections():
    FakeUser.secrets = {"alice": "secret"}
    admin = FakeAdmin(explicit="alice", allowed_groups="writers",
                      unavailable=True, memberships={"alice": ["writers"]})
    result = asyncio.run(check(admin))
    assert result["partial"] is True
    assert result["groups"][0]["partial"] is True
    assert result["users"][0]["connection"] == "connected"
    assert result["users"][0]["explicit"] is True

    # Scan must be bounded and never imply missing members have disconnected.
    members = [f"member-{i:03d}" for i in range(270)]
    admin = FakeAdmin(allowed_groups="writers", members=members,
                      memberships={uid: ["writers"] for uid in members})
    result = asyncio.run(check(admin))
    assert result["partial"] is True
    assert len(result["users"]) == 250
    assert result["groups"][0]["members_checked"] == 250
    assert result["groups"][0]["partial"] is True


def test_broken_directory_membership_does_not_invent_group_grants():
    FakeUser.secrets = {"alice": "secret"}
    admin = FakeAdmin(allowed_groups="team", members=["alice", "bob"],
                      memberships={"alice": ["team"]}, broken={"bob"})
    result = asyncio.run(check(admin))
    assert [x["user_id"] for x in result["users"]] == ["alice"]
