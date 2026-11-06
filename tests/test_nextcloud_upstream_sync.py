"""Conservative upstream synchronization contract for Nextcloud downstream."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/bootstrap-upstream.yml"


class UpstreamSyncWorkflowTests(unittest.TestCase):
    def test_periodic_and_manual_sync_are_available(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", content)
        self.assertIn('cron: "17 3 * * 1"', content)
        self.assertIn("group: core-upstream-sync", content)
        self.assertIn("cancel-in-progress: false", content)

    def test_core_tests_use_exact_upstream_worktree_and_downstream_own_workflows(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("git worktree add --detach /tmp/downloader-core-acceptance upstream/main", content)
        self.assertIn("(cd /tmp/downloader-core-acceptance && python -m pytest -q)", content)
        self.assertIn("git restore --source=HEAD --staged --worktree README.md .github/workflows", content)
        self.assertIn("git diff --exit-code upstream/main -- app openapi.yaml requirements.txt Dockerfile Dockerfile.egress compose.egress.yaml scripts/egress_guard.sh EGRESS_GUARD.md", content)
        self.assertIn("tests/test_audited_preflight_branch_cleanup.py", content)
        self.assertNotIn("tests/test_audited_*.py", content)
        self.assertIn("git worktree add --detach /tmp/downloader-core-acceptance upstream/main", content)
        for pattern in (
            "tests/test_nextcloud_*.py", "tests/test_appapi_*.py",
            "tests/test_exapp_*.py", "tests/test_audited_preflight_branch_cleanup.py",
            "tests/test_cleanup_*.py", "tests/test_target_*.py",
        ):
            self.assertIn(pattern, content)
        self.assertLess(
            content.index("git diff --exit-code upstream/main -- app"),
            content.index("git push origin HEAD:main"),
        )

    def test_accepted_upstream_merge_dispatches_main_appapi_acceptance(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("actions: write", content)
        self.assertIn("GH_TOKEN: ${{ github.token }}", content)
        self.assertIn("if: steps.merge.outputs.changed == 'true'", content)
        self.assertIn("gh workflow run appapi-docker-deploy-e2e.yml --ref main", content)
        self.assertIn('actual_main="$(git ls-remote origin refs/heads/main | cut -f1)"', content)
        self.assertIn('if [[ "$actual_main" != "$accepted_sha" ]]', content)
        self.assertLess(
            content.index("git push origin HEAD:main"),
            content.index("gh workflow run appapi-docker-deploy-e2e.yml --ref main"),
        )

    def test_no_unverified_or_unsafe_merges(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("git merge-base --is-ancestor", content)
        self.assertIn("git merge --no-ff --no-commit upstream/main", content)
        self.assertIn("python3 scripts/resolve_upstream_conflicts.py", content)
        self.assertIn("git ls-files -u", content)
        self.assertIn("git diff --exit-code upstream/main -- BLUEPRINT.md", content)
        self.assertIn("python -m pytest -q", content)
        self.assertIn("docker build --tag downloader-server:nextcloud-upstream-acceptance .", content)
        self.assertLess(content.index("python -m pytest -q"), content.index("git push origin HEAD:main"))
        self.assertLess(content.index("docker build --tag"), content.index("git push origin HEAD:main"))
        self.assertIn("git restore --source=HEAD --staged --worktree README.md .github/workflows", content)
        self.assertNotIn("--allow-unrelated-histories", content)
        self.assertLess(content.index("python3 scripts/resolve_upstream_conflicts.py"), content.index("python -m pytest -q"))


if __name__ == "__main__":
    unittest.main()
