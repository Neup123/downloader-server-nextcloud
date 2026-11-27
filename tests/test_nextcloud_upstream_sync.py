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
        self.assertIn("python3 -m scripts.bridge_job_state_contract --check", content)
        generation = content.index("python3 -m scripts.bridge_job_state_contract\n")
        stage = content.index("git add -- bridge/lib/JobStateContract.php nextcloud_exapp/job_state_contract.py bridge/src/job-states.generated.mjs")
        verified = content.index("python3 -m scripts.bridge_job_state_contract --check")
        downstream = content.index("python3 scripts/run_downstream_acceptance.py")
        assert generation < stage < verified < downstream
        # The merge may publish only after generated consumers and the
        # separately reviewed downstream suite have passed.
        assert downstream < content.index("git push origin \"HEAD:refs/heads/$branch\"")
        self.assertLess(
            content.index("python3 -m scripts.bridge_job_state_contract --check"),
            content.index("python3 scripts/run_downstream_acceptance.py"),
        )
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
            content.index("git push origin \"HEAD:refs/heads/$branch\""),
        )

    def test_nextcloud_web_suite_excludes_imported_standalone_contract_tests(self):
        # Core's current web tests run against the exact upstream Core worktree;
        # Nextcloud's historical App.tsx intentionally diverges from Core.
        import json
        import shlex

        web = ROOT / "web"
        package = json.loads((web / "package.json").read_text(encoding="utf-8"))
        command = shlex.split(package["scripts"]["test"])
        self.assertEqual(command[:3], ["node", "--experimental-strip-types", "--test"])
        suite = command[3:]
        self.assertTrue(suite)
        self.assertEqual(len(suite), len(set(suite)))
        self.assertNotIn("tests/*.test.mjs", suite)
        self.assertNotIn("tests/url-scheme-hint.test.mjs", suite)
        for name in suite:
            self.assertTrue(name.startswith("tests/") and name.endswith(".test.mjs"), name)
            self.assertTrue((web / name).is_file(), name)

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
            content.index("git push origin \"HEAD:refs/heads/$branch\""),
            content.index('gh workflow run appapi-docker-deploy-e2e.yml --repo "$GITHUB_REPOSITORY" --ref main'),
        )

    def test_revalidation_rechecks_tests_and_docker_before_scoped_dispatch(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("revalidate_current_main:", content)
        self.assertIn("REVALIDATE_CURRENT_MAIN: ${{ inputs.revalidate_current_main }}", content)
        self.assertIn('if [[ "$GITHUB_EVENT_NAME" == "push" || "$GITHUB_EVENT_NAME" == "pull_request" || "$REVALIDATE_CURRENT_MAIN" == "true" ]]', content)
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

    def test_sync_candidate_has_no_direct_main_push_or_bypass(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("git push origin HEAD:main", content)
        self.assertNotIn("gh pr merge", content)
        self.assertIn("pull-requests: write", content)
        self.assertIn("types: [closed]", content)
        self.assertIn("github.event.pull_request.merged == true", content)
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", content)
        self.assertIn('git merge-base --is-ancestor "$ACCEPTED_PR_HEAD" HEAD', content)
        self.assertIn('test "$(git rev-parse HEAD^2)" = "$core_sha"', content)
        self.assertIn('test "$(git rev-parse FETCH_HEAD^2)" = "$core_sha"', content)
        self.assertIn("tested-candidate-not-accepted-main", content)
        self.assertIn('"accepted_main": False', content)
        self.assertIn('gh pr create --repo "$GITHUB_REPOSITORY" --base main', content)
        self.assertIn("Use a merge commit, not squash or rebase", content)
        self.assertIn("if: steps.merge.outputs.reverify == 'true'", content)

    def test_required_pr_checks_are_not_path_filtered(self):
        for name in (
            "nextcloud-preflight.yml", "live-nextcloud-preflight.yml",
            "appapi-docker-deploy-e2e.yml", "bridge-package.yml",
            "nextcloud-exapp-build.yml",
        ):
            source = (ROOT / ".github/workflows" / name).read_text()
            pr_trigger = source.split("  pull_request:", 1)[1].split("  workflow_dispatch:", 1)[0]
            self.assertIn("branches: [main, integration]", pr_trigger)
            self.assertNotIn("paths:", pr_trigger)
            self.assertNotIn("paths-ignore:", pr_trigger)

    def test_no_unverified_or_unsafe_merges(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("git merge-base --is-ancestor", content)
        self.assertIn("git merge --no-ff --no-commit upstream/main", content)
        self.assertIn("python3 scripts/resolve_upstream_conflicts.py", content)
        self.assertIn("git ls-files -u", content)
        self.assertIn("git diff --exit-code upstream/main -- BLUEPRINT.md", content)
        self.assertIn("python -m pytest -q", content)
        self.assertIn("docker build --tag downloader-server:nextcloud-upstream-acceptance .", content)
        self.assertLess(content.index("python -m pytest -q"), content.index("git push origin \"HEAD:refs/heads/$branch\""))
        self.assertLess(content.index("docker build --tag"), content.index("git push origin \"HEAD:refs/heads/$branch\""))
        self.assertIn("git restore --source=HEAD --staged --worktree README.md .github/workflows", content)
        self.assertNotIn("--allow-unrelated-histories", content)
        self.assertLess(content.index("python3 scripts/resolve_upstream_conflicts.py"), content.index("python -m pytest -q"))


if __name__ == "__main__":
    unittest.main()
