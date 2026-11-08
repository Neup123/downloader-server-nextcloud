"""Execute both real entitlement implementations on one security fixture set."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import shutil
import subprocess
import unittest
from types import SimpleNamespace

from nextcloud_exapp.user import entitlement


ROOT = Path(__file__).resolve().parents[1]

FIXTURES = [
    {"user_id": "alice", "allowed_users": "", "allowed_groups": "", "user_groups": []},
    {"user_id": "alice", "allowed_users": "alice", "allowed_groups": "", "user_groups": []},
    {"user_id": "bob", "allowed_users": " alice, bob\n charlie ", "allowed_groups": "", "user_groups": []},
    {"user_id": "alice", "allowed_users": "alice2", "allowed_groups": "", "user_groups": []},
    {"user_id": "alice", "allowed_users": "", "allowed_groups": " staff ", "user_groups": ["staff"]},
    {"user_id": "alice", "allowed_users": "", "allowed_groups": "staff", "user_groups": ["admin"]},
    {"user_id": "alice", "allowed_users": "bob", "allowed_groups": "admin, staff", "user_groups": ["staff"]},
    {"user_id": "alice", "allowed_users": "alice", "allowed_groups": "admins", "user_groups": [],
     "membership_unavailable": True},
    {"user_id": "alice", "allowed_users": "", "allowed_groups": "staff", "user_groups": ["staff"],
     "membership_unavailable": True},
    {"user_id": "ALICE", "allowed_users": "alice", "allowed_groups": "staff", "user_groups": []},
    {"user_id": "alice", "allowed_users": ",\r\n,  ", "allowed_groups": "  , ", "user_groups": []},
    {"user_id": "", "allowed_users": ",\n", "allowed_groups": "", "user_groups": []},
    {"user_id": "user-012", "allowed_users": "user-01\ruser-012", "allowed_groups": "", "user_groups": []},
]


class FakeAppConfig:
    def __init__(self, fixture):
        self.fixture = fixture

    async def get_value(self, field, default=""):
        return self.fixture.get(field, default)


class FakeNextcloud:
    def __init__(self, fixture):
        self.fixture = fixture
        self.appconfig_ex = FakeAppConfig(fixture)
        self.users = SimpleNamespace(get_user=self.get_user)

    async def get_user(self, user_id):
        if self.fixture.get("membership_unavailable"):
            raise RuntimeError("Directory unavailable")
        return SimpleNamespace(groups=self.fixture["user_groups"])


class EntitlementCrossLanguageContractTests(unittest.TestCase):
    def test_php_bridge_and_python_exapp_grant_the_same_users(self):
        php = shutil.which("php")
        self.assertIsNotNone(php, "Native bridge parity requires the PHP CLI")
        code = ROOT / "bridge/tests/entitlement-contract.php"
        result = subprocess.run(
            [php, str(code)],
            input=json.dumps(FIXTURES),
            capture_output=True, text=True, check=True, timeout=15,
        )
        php_results = json.loads(result.stdout)
        python_results = [
            asyncio.run(entitlement(FakeNextcloud(item), item["user_id"]))
            for item in FIXTURES
        ]
        self.assertEqual(php_results, python_results)
        self.assertEqual(python_results, [
            False, True, True, False, True, False, True,
            True, False, False, False, False, True,
        ])

    def test_activity_sync_uses_contract_policy_not_an_independent_copy(self):
        code = (ROOT / "bridge/lib/BackgroundJob/ActivitySync.php").read_text()
        self.assertIn("EntitlementPolicy::allows(", code)
        self.assertNotIn("preg_split(", code)
        self.assertIn("if (!$this->isEntitled($uid))", code)


if __name__ == "__main__":
    unittest.main()
