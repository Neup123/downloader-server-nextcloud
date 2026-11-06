"""Prevent future core-only tests from breaking Nextcloud upstream synchronization."""
from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from scripts.run_downstream_acceptance import (
    DOWNSTREAM_PATTERNS, main, plan_tests, tracked_head_files,
)

OWNED = {
    "tests/test_appapi_deploy_workflow.py",
    "tests/test_audited_preflight_branch_cleanup.py",
    "tests/test_cleanup_equivalent_branches.py",
    "tests/test_exapp_publication_workflow.py",
    "tests/test_nextcloud_upstream_sync.py",
    "tests/test_target_readiness.py",
}
CORE_ONLY = {
    "tests/test_audited_core_legacy_cleanup.py",
    "tests/test_engine_updates.py",
    "tests/test_egress_guard_contract.py",
}


class DownstreamAcceptanceInventoryTests(unittest.TestCase):
    def test_only_reviewed_downstream_tests_are_run(self):
        selected = plan_tests(OWNED, OWNED | CORE_ONLY)
        self.assertEqual(selected, sorted(OWNED))
        self.assertNotIn("tests/test_audited_core_legacy_cleanup.py", selected)

    def test_new_core_only_test_with_existing_prefix_cannot_leak(self):
        # Historically the wildcard tests/test_audited_*.py imported core-only
        # AUDITED_SUPERSEDED_CORE_HEADS from Nextcloud's different cleanup code.
        added = {"tests/test_audited_core_legacy_cleanup.py"}
        self.assertEqual(plan_tests(OWNED, OWNED | added), sorted(OWNED))
        self.assertNotIn(next(iter(added)), plan_tests(OWNED, OWNED | added))

    def test_missing_existing_downstream_test_fails_closed(self):
        for path in sorted(OWNED):
            with self.subTest(path=path), self.assertRaisesRegex(
                RuntimeError, "Downstream test removed"
            ):
                plan_tests(OWNED, OWNED - {path})

    def test_empty_or_missing_downstream_group_is_error(self):
        with self.assertRaisesRegex(RuntimeError, "no test inventory"):
            plan_tests(set(), set())
        for path in sorted(OWNED):
            with self.subTest(path=path):
                reduced = OWNED - {path}
                with self.assertRaisesRegex(RuntimeError, "required group"):
                    plan_tests(reduced, reduced)

    def test_acceptance_inventory_rejects_nested_non_reviewed_path(self):
        committed = OWNED | {"tests/test_appapi_nested/file.py"}
        with self.assertRaisesRegex(RuntimeError, "invalid path"):
            plan_tests(committed, committed)

    def test_git_tree_lookup_is_explicitly_based_on_downstream_head(self):
        result = b"tests/test_nextcloud_sample.py\0tests/test_exapp_probe.py\0"
        with patch(
            "scripts.run_downstream_acceptance.subprocess.check_output",
            return_value=result,
        ) as check:
            self.assertEqual(tracked_head_files(), {
                "tests/test_nextcloud_sample.py",
                "tests/test_exapp_probe.py",
            })
        self.assertEqual(check.call_args.args[0][5], "HEAD")

    def test_pytest_is_invoked_with_exact_selected_modules(self):
        with patch(
            "scripts.run_downstream_acceptance.tracked_head_files",
            return_value=OWNED,
        ), patch(
            "scripts.run_downstream_acceptance.Path.is_file", return_value=True,
        ), patch(
            "scripts.run_downstream_acceptance.Path.is_symlink", return_value=False,
        ), patch(
            "scripts.run_downstream_acceptance.subprocess.call",
            return_value=0,
        ) as execute:
            self.assertEqual(main(), 0)
            self.assertEqual(execute.call_args.args[0][-len(OWNED):], sorted(OWNED))
            self.assertEqual(execute.call_args.args[0][1:4], [
                "-m", "pytest", "-q",
            ])

    def test_globs_cover_downstream_ownership_not_generic_core_tests(self):
        self.assertNotIn("tests/test_*.py", DOWNSTREAM_PATTERNS)
        self.assertTrue(all(path.startswith("tests/test_") for path in DOWNSTREAM_PATTERNS))


if __name__ == "__main__":
    unittest.main()
