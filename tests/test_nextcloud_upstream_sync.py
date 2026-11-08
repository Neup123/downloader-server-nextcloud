"""Conservative upstream synchronization contract for Nextcloud downstream."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/bootstrap-upstream.yml"


class UpstreamSyncWorkflowTests(unittest.TestCase):
    def test_periodic_and_manual_sync_are_available(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", content)
        self.assertIn('cron: "17 3 * * *"', content)
        self.assertIn("group: core-upstream-sync", content)
        self.assertIn("cancel-in-progress: false", content)
        self.assertIn("expected_core_sha:", content)
        self.assertIn("EXPECTED_CORE_SHA: ${{ inputs.expected_core_sha }}", content)
        self.assertIn('if [[ "$core_sha" != "$EXPECTED_CORE_SHA" ]]', content)

    def test_core_tests_use_exact_upstream_worktree_and_downstream_own_workflows(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("git worktree add --detach /tmp/downloader-core-acceptance upstream/main", content)
        self.assertIn("(cd /tmp/downloader-core-acceptance && python -m pytest -q)", content)
        self.assertIn("git restore --source=HEAD --staged --worktree README.md .github/workflows", content)
        self.assertIn("git diff --exit-code upstream/main -- LICENSE app openapi.yaml requirements.txt Dockerfile Dockerfile.egress compose.egress.yaml scripts/egress_guard.sh scripts/guarded_host_acceptance.py EGRESS_GUARD.md", content)
        self.assertIn("git cat-file -e upstream/main:app/job_states.py", content)
        self.assertIn("test -s app/job_states.py", content)
        self.assertIn("python3 scripts/run_downstream_acceptance.py", content)
        # Only an explicit reviewed manifest can establish downstream test
        # ownership; the core test may already be present in HEAD history.
        selector = (ROOT / "scripts/run_downstream_acceptance.py").read_text()
        self.assertIn('"HEAD", "--", "tests/"', selector)
        self.assertIn("DOWNSTREAM_TEST_MODULES", selector)
        self.assertIn('"tests/test_audited_preflight_branch_cleanup.py"', selector)
        self.assertNotIn('"tests/test_audited_core_legacy_cleanup.py"', selector)
        self.assertNotIn('"tests/test_audited_*.py"', selector)
        self.assertLess(
            content.index("git diff --exit-code upstream/main -- LICENSE app"),
            content.index("git push origin HEAD:main"),
        )

    def test_accepted_upstream_merge_dispatches_main_appapi_acceptance(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("actions: write", content)
        self.assertIn("GH_TOKEN: ${{ github.token }}", content)
        self.assertIn("if: steps.merge.outputs.changed == 'true'", content)
        self.assertIn('gh workflow run appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY" --ref main', content)
        self.assertIn('gh workflow view appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY"', content)
        self.assertIn('if [[ "${GITHUB_REPOSITORY:-}" != "Neup123/downloader-server-nextcloud" ]]', content)
        self.assertIn("steps.merge.outputs.reverify == 'true'", content)
        self.assertIn('actual_main="$(git ls-remote origin refs/heads/main | cut -f1)"', content)
        self.assertIn('if [[ "$actual_main" != "$accepted_sha" ]]', content)
        self.assertLess(
            content.index("git push origin HEAD:main"),
            content.index('gh workflow run appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY" --ref main'),
        )

    def test_revalidation_rechecks_tests_and_docker_before_scoped_dispatch(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("revalidate_current_main:", content)
        self.assertIn("REVALIDATE_CURRENT_MAIN: ${{ inputs.revalidate_current_main }}", content)
        self.assertIn('if [[ "$GITHUB_EVENT_NAME" == "push" || "$REVALIDATE_CURRENT_MAIN" == "true" ]]', content)
        self.assertIn('echo "reverify=false" >> "$GITHUB_OUTPUT"', content)
        self.assertIn("steps.merge.outputs.changed == 'true' || steps.merge.outputs.reverify == 'true'", content)
        self.assertIn("python3 scripts/record_core_sync.py", content)
        self.assertIn("--revalidate-existing-main", content)
        self.assertIn("current-main-revalidation.json", content)
        self.assertLess(
            content.index("docker build --tag downloader-server:nextcloud-upstream-acceptance ."),
            content.index("--revalidate-existing-main"),
        )
        self.assertLess(
            content.index("--revalidate-existing-main"),
            content.index('gh workflow run appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY"'),
        )
        self.assertIn("if: steps.merge.outputs.reverify == 'true'", content)
        self.assertIn("if: steps.merge.outputs.changed == 'true'", content)

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
