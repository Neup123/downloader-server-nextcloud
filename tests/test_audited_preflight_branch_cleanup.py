"""Audited branch retirement must never delete newer or active code."""
from __future__ import annotations

import unittest

from scripts.cleanup_merged_branches import audited_legacy_candidates, legacy_port_verified

OLD_BRANCH = "feature/read-only-nextcloud-preflight"
OLD_SHA = "d5bcdfd5bb4627b6f40233147cea920233ca26a0"


def branch(name: str, sha: str = OLD_SHA, protected: bool = False):
    return {"name": name, "commit": {"sha": sha}, "protected": protected}


class AuditedRetirementTests(unittest.TestCase):
    def test_port_and_tests_are_present_before_audited_retirement(self):
        self.assertTrue(legacy_port_verified())

    def test_only_the_exact_reviewed_branch_head_may_be_removed(self):
        result = audited_legacy_candidates([
            branch("main"), branch(OLD_BRANCH), branch("feature/unmerged"),
            branch("old-but-not-audited"),
        ], [], port_verified=True)
        self.assertEqual(result, [(OLD_BRANCH, OLD_SHA)])

    def test_modified_branch_head_is_preserved(self):
        self.assertEqual(audited_legacy_candidates(
            [branch(OLD_BRANCH, "a"*40)], [], port_verified=True
        ), [])

    def test_active_pr_and_protected_branch_are_preserved(self):
        self.assertEqual(audited_legacy_candidates(
            [branch(OLD_BRANCH)], [
                {"state": "open", "head": {"ref": OLD_BRANCH}}
            ], port_verified=True
        ), [])
        self.assertEqual(audited_legacy_candidates(
            [branch(OLD_BRANCH, protected=True)], [], port_verified=True
        ), [])

    def test_missing_port_blocks_retirement(self):
        self.assertEqual(audited_legacy_candidates(
            [branch(OLD_BRANCH)], [], port_verified=False
        ), [])


if __name__ == "__main__":
    unittest.main()
