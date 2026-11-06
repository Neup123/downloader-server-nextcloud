"""Safety contract for the fail-closed upstream merge conflict policy."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from scripts.resolve_upstream_conflicts import (
    CORE_TEST_ONLY, DOWNSTREAM, main, plan_conflicts,
)


class ResolverPolicyTests(unittest.TestCase):
    def test_only_exact_audited_paths_are_allowed(self):
        paths = sorted(DOWNSTREAM | CORE_TEST_ONLY)
        result = plan_conflicts(paths)
        self.assertEqual(result.keys(), set(paths))
        self.assertTrue(all(result[p] == "ours" for p in DOWNSTREAM))
        self.assertTrue(all(result[p] == "theirs" for p in CORE_TEST_ONLY))
        self.assertIn(".github/workflows/pinned-engine-updates.yml", CORE_TEST_ONLY)
        self.assertNotIn(".github/workflows/pinned-engine-updates-copy.yml", CORE_TEST_ONLY)

    def test_unknown_conflicts_are_rejected_without_partial_resolution(self):
        for path in (
            "app/main.py",
            ".github/workflows/pinned-engine-updates-copy.yml",
            "scripts/cleanup_merged_branches.py.bak",
            "../README.md",
            "README.md/extra",
            "tests/test_cleanup_equivalent_branches.py ",
        ):
            with self.subTest(path=path), self.assertRaises(ValueError):
                plan_conflicts(["README.md", path])

    def test_empty_and_unexpected_conflict_sets_fail_closed(self):
        with self.assertRaises(ValueError):
            plan_conflicts([])
        with self.assertRaisesRegex(ValueError, "Unexpected upstream"):
            plan_conflicts(["some-new-file.txt"])

    def test_unexpected_conflicts_cause_zero_writes(self):
        # Mock Git output only: an unexpected path must be rejected before
        # checkout, rm, or add is invoked.
        with patch("scripts.resolve_upstream_conflicts.git", side_effect=[
            b"upstream-sha\n", b"app/main.py\0README.md\0",
        ]), patch("scripts.resolve_upstream_conflicts.subprocess.check_call") as writer:
            with self.assertRaises(ValueError):
                main()
            writer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
