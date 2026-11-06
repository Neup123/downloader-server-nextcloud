"""A reviewed manifest, not filename globs, owns downstream acceptance tests."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from scripts.run_downstream_acceptance import (
    DOWNSTREAM_TEST_MODULES, main, plan_tests, tracked_head_files,
)

OWNED = set(DOWNSTREAM_TEST_MODULES)
CORE_ONLY = {
    "tests/test_audited_core_legacy_cleanup.py",
    "tests/test_engine_updates.py",
    "tests/test_egress_guard_contract.py",
}


class DownstreamAcceptanceInventoryTests(unittest.TestCase):
    def test_exact_manifest_does_not_execute_imported_core_tests(self):
        # Even if core-only tests are ALREADY part of downstream HEAD history,
        # they cannot enter the reviewed downstream test list.
        selected = plan_tests(OWNED | CORE_ONLY, OWNED | CORE_ONLY)
        self.assertEqual(selected, sorted(OWNED))
        for unwanted in CORE_ONLY:
            self.assertNotIn(unwanted, selected)

    def test_reviewed_test_removed_from_head_or_merged_tree_fails(self):
        for path in sorted(OWNED):
            with self.subTest(path=path), self.assertRaisesRegex(
                RuntimeError, "missing from HEAD"
            ):
                plan_tests(OWNED - {path}, OWNED)
            with self.subTest(path=path + " merged"), self.assertRaisesRegex(
                RuntimeError, "removed by upstream"
            ):
                plan_tests(OWNED, OWNED - {path})

    def test_empty_manifest_and_unsafe_paths_are_rejected(self):
        with patch("scripts.run_downstream_acceptance.DOWNSTREAM_TEST_MODULES", frozenset()):
            with self.assertRaisesRegex(RuntimeError, "No reviewed"):
                plan_tests(set(), set())
        for invalid in (
            "tests/test_nextcloud_nested/sub.py",
            "tests/test_nextcloud_bad.txt",
            "../tests/test_nextcloud_escape.py",
        ):
            with self.subTest(invalid=invalid), patch(
                "scripts.run_downstream_acceptance.DOWNSTREAM_TEST_MODULES",
                frozenset({invalid}),
            ), self.assertRaisesRegex(RuntimeError, "Unsafe"):
                plan_tests({invalid}, {invalid})

    def test_git_tree_lookup_is_explicitly_based_on_downstream_head(self):
        result = b"tests/test_nextcloud_sample.py" + bytes([0]) + b"tests/test_exapp_probe.py" + bytes([0])
        with patch(
            "scripts.run_downstream_acceptance.subprocess.check_output",
            return_value=result,
        ) as check:
            self.assertEqual(tracked_head_files(), {
                "tests/test_nextcloud_sample.py",
                "tests/test_exapp_probe.py",
            })
        self.assertEqual(check.call_args.args[0][5], "HEAD")

    def test_pytest_is_invoked_only_with_declared_modules(self):
        with patch(
            "scripts.run_downstream_acceptance.tracked_head_files",
            return_value=OWNED | CORE_ONLY,
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
            self.assertEqual(execute.call_args.args[0][1:4], ["-m", "pytest", "-q"])

    def test_all_downstream_modules_are_explicit_and_core_cleanup_is_not(self):
        self.assertGreaterEqual(len(DOWNSTREAM_TEST_MODULES), 12)
        self.assertIn("tests/test_audited_preflight_branch_cleanup.py", OWNED)
        self.assertNotIn("tests/test_audited_core_legacy_cleanup.py", OWNED)
        self.assertTrue(all("*" not in path for path in DOWNSTREAM_TEST_MODULES))
        self.assertTrue(all(path.endswith(".py") for path in DOWNSTREAM_TEST_MODULES))


if __name__ == "__main__":
    unittest.main()
