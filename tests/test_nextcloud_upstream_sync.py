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

    def test_no_unverified_or_unsafe_merges(self):
        content = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("git merge-base --is-ancestor", content)
        self.assertIn("git merge --no-ff --no-commit upstream/main", content)
        self.assertIn('if [[ "$unresolved" != "README.md" ]]', content)
        self.assertIn("git ls-files -u", content)
        self.assertIn("git diff --exit-code upstream/main -- BLUEPRINT.md", content)
        self.assertIn("python -m pytest -q", content)
        self.assertIn("docker build --tag downloader-server:nextcloud-upstream-acceptance .", content)
        self.assertLess(content.index("python -m pytest -q"), content.index("git push origin HEAD:main"))
        self.assertLess(content.index("docker build --tag"), content.index("git push origin HEAD:main"))
        self.assertIn("git restore --source=HEAD --staged --worktree .github/workflows", content)
        self.assertNotIn("--allow-unrelated-histories", content)


if __name__ == "__main__":
    unittest.main()
