"""Verified core sync must record the exact trusted source and main merge tip."""
from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.record_core_sync import (
    CORE_OWNED_PATHS, core_shared_web_paths, accepted_sync_record, accepted_main_revalidation_record,
    validate_record, validate_revalidation_record,
)


ROOT = Path(__file__).resolve().parents[1]
CORE = "a" * 40
PREVIOUS = "b" * 40
MERGE = "c" * 40


class CoreSyncEvidenceTests(unittest.TestCase):
    def green(self, **updates):
        args = {
            "core_sha": CORE,
            "merged_sha": MERGE,
            "remote_sha": MERGE,
            "parents": [PREVIOUS, CORE],
            "core_ancestor": True,
            "core_files_equal": True,
        }
        args.update(updates)
        return validate_record(**args)

    def test_exact_second_parent_and_pushed_remote_main_are_recorded(self):
        record = self.green()
        self.assertEqual(record["source_commit"], CORE)
        self.assertEqual(record["downstream_commit"], MERGE)
        self.assertEqual(record["downstream_previous_commit"], PREVIOUS)
        self.assertTrue(record["source_is_exact_second_parent"])
        self.assertTrue(record["core_owned_files_byte_identical"])
        self.assertEqual(record["schema_version"], 1)
        self.assertFalse(record["production_nextcloud_target_verified"])
        self.assertIn("Dockerfile.egress", record["core_owned_paths"])
        self.assertIn("app", record["core_owned_paths"])

    def test_rejects_wrong_remote_source_and_non_merge(self):
        cases = [
            {"remote_sha": PREVIOUS},
            {"parents": [PREVIOUS]},
            {"parents": [PREVIOUS, PREVIOUS]},
            {"parents": [PREVIOUS, CORE, CORE]},
            {"core_ancestor": False},
            {"core_files_equal": False},
            {"core_sha": "not-a-sha"},
            {"merged_sha": ""},
            {"parents": ["INVALID", CORE]},
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                self.green(**case)

    def test_live_git_probe_rejects_private_backend_drift(self):
        def run_git(*args):
            if args[:2] == ("rev-parse", "upstream/main"):
                return CORE
            if args[:2] == ("rev-parse", "HEAD"):
                return MERGE
            if args[0] == "ls-remote":
                return MERGE + "  refs/heads/main"
            if args[0] == "rev-list":
                return f"{MERGE} {PREVIOUS} {CORE}"
            if args[0] == "ls-tree":
                return "web/src/App.tsx\nweb/src/JobCard.tsx\nweb/src/i18n.ts"
            raise AssertionError(args)

        def allowed(args, **kwargs):
            obj = type("Result", (), {})()
            obj.returncode = 0
            return obj

        with patch("scripts.record_core_sync.git", side_effect=run_git), patch(
            "scripts.record_core_sync.subprocess.run", side_effect=allowed,
        ) as invocation:
            result = accepted_sync_record()
        self.assertEqual(result["downstream_commit"], MERGE)
        self.assertEqual(invocation.call_count, 2)
        arguments = [call.args[0] for call in invocation.call_args_list]
        self.assertTrue(any("merge-base" in args for args in arguments))
        self.assertTrue(any("diff" in args and "Dockerfile.egress" in args for args in arguments))

    def test_missing_or_moved_main_does_not_write_acceptance_artifact(self):
        with patch("scripts.record_core_sync.git", side_effect=[
            CORE, MERGE, PREVIOUS + "  refs/heads/main", f"{MERGE} {PREVIOUS} {CORE}",
            "web/src/App.tsx\nweb/src/JobCard.tsx",
        ]), patch("scripts.record_core_sync.subprocess.run") as run:
            with self.assertRaises(ValueError):
                accepted_sync_record()
            # Checking this case does not depend on leaking tokens or writing.
            self.assertTrue(run.called)

    def test_workflow_emits_artifact_only_after_merge_and_before_appapi_dispatch(self):
        content = (ROOT / ".github/workflows/bootstrap-upstream.yml").read_text()
        self.assertIn("scripts/record_core_sync.py", content)
        self.assertIn("core-sync-evidence.json", content)
        self.assertIn("actions/upload-artifact@v4", content)
        self.assertLess(content.index("git push origin HEAD:main"), content.index("scripts/record_core_sync.py"))
        self.assertLess(
            content.index("scripts/record_core_sync.py"),
            content.index('gh workflow run appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY" --ref main'),
        )
        self.assertIn("EXPECTED_CORE_SHA", content)
        self.assertIn('cron: "17 3 * * *"', content)
        self.assertIn("expected_core_sha:", content)
        self.assertIn("core-upstream-sync", content)

    def test_existing_main_revalidation_never_claims_two_parent_merge(self):
        result = validate_revalidation_record(
            CORE, MERGE, MERGE,
            core_ancestor=True, core_files_equal=True,
        )
        self.assertEqual(result["source_commit"], CORE)
        self.assertEqual(result["downstream_commit"], MERGE)
        self.assertFalse(result["source_is_exact_second_parent"])
        self.assertIn("NOT a new core merge", result["record_type"])
        self.assertTrue(result["source_ancestry_verified"])
        self.assertFalse(result["production_nextcloud_target_verified"])

    def test_revalidation_rejects_wrong_target_source_or_backend(self):
        for updates in (
            {"remote_sha": PREVIOUS},
            {"core_sha": "invalid"},
            {"main_sha": "invalid"},
            {"core_ancestor": False},
            {"core_files_equal": False},
        ):
            with self.subTest(updates=updates):
                payload = {
                    "core_sha": CORE, "main_sha": MERGE,
                    "remote_sha": MERGE,
                    "core_ancestor": True, "core_files_equal": True,
                }
                payload.update(updates)
                with self.assertRaises(ValueError):
                    validate_revalidation_record(**payload)

    def test_revalidation_reads_actual_git_source_tip_and_source_file_parity(self):
        def run_git(*args):
            if args[:2] == ("rev-parse", "upstream/main"):
                return CORE
            if args[:2] == ("rev-parse", "HEAD"):
                return MERGE
            if args[0] == "ls-remote":
                return MERGE + "  refs/heads/main"
            if args[0] == "ls-tree":
                return "web/src/App.tsx\nweb/src/JobCard.tsx\nweb/src/i18n.ts"
            raise AssertionError(args)
        def allowed(args, **kwargs):
            obj = type("Result", (), {})()
            obj.returncode = 0
            return obj
        with patch("scripts.record_core_sync.git", side_effect=run_git), patch(
            "scripts.record_core_sync.subprocess.run", side_effect=allowed,
        ) as runner:
            actual = accepted_main_revalidation_record()
        self.assertEqual(actual["downstream_commit"], MERGE)
        self.assertEqual(runner.call_count, 2)
        self.assertFalse(actual["source_is_exact_second_parent"])

    def test_shared_core_ui_ownership_covers_new_modules_but_preserves_legacy_adapter(self):
        with patch("scripts.record_core_sync.git", return_value=(
            "web/src/App.tsx\nweb/src/JobCard.tsx\n"
            "web/src/i18n.ts\nweb/src/NewCoreModule.tsx\n"
        )):
            paths = core_shared_web_paths(CORE)
        self.assertNotIn("web/src/App.tsx", paths)
        self.assertEqual(paths, (
            "web/src/JobCard.tsx",
            "web/src/i18n.ts",
            "web/src/NewCoreModule.tsx",
        ))
        for inventory in ("", "web/src/App.tsx", "web/src/JobCard.tsx",
                          "web/src/App.tsx\n../outside.txt"):
            with self.subTest(inventory=inventory), patch(
                "scripts.record_core_sync.git", return_value=inventory
            ), self.assertRaises(ValueError):
                core_shared_web_paths(CORE)

    def test_accepted_sync_and_preview_reject_shared_ui_drift(self):
        for workflow in ("bootstrap-upstream.yml", "verify-upstream-merge.yml"):
            content = (ROOT / ".github/workflows" / workflow).read_text()
            self.assertIn("git ls-tree -r --name-only upstream/main -- web/src", content)
            self.assertIn("grep -vFx 'web/src/App.tsx'", content)
            self.assertIn('git diff --exit-code upstream/main -- "${shared_ui[@]}"', content)
        source = (ROOT / "scripts/record_core_sync.py").read_text()
        self.assertIn("*CORE_BYTE_PARITY_PATHS, *core_shared_web_paths(core)", source)
        backend_scope = source.split("CORE_BYTE_PARITY_PATHS = (", 1)[1].split("\n)", 1)[0]
        self.assertIn('":(exclude)app/delivery.py"', backend_scope)
        self.assertIn('":(exclude)app/schemas.py"', backend_scope)
        web_scope = source.split("WEB_BYTE_PARITY_EXEMPTIONS =", 1)[1].splitlines()[0]
        self.assertIn('"web/src/ui-options.ts"', web_scope)

    def test_core_parity_scope_is_explicit_and_no_private_target_claim(self):
        self.assertIn("BLUEPRINT.md", CORE_OWNED_PATHS)
        self.assertIn("scripts/egress_guard.sh", CORE_OWNED_PATHS)
        self.assertNotIn("README.md", CORE_OWNED_PATHS)
        self.assertNotIn(".github/workflows", CORE_OWNED_PATHS)


if __name__ == "__main__":
    unittest.main()
