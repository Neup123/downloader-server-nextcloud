"""The merge preview must accept core upgrades without write privileges."""
from __future__ import annotations

from pathlib import Path
import unittest



ROOT = Path(__file__).resolve().parents[1]


class ReadOnlyMergePreviewTests(unittest.TestCase):
    def test_preview_runs_full_gates_but_cannot_mutate_main(self):
        content = (
            ROOT / ".github/workflows/verify-upstream-merge.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("permissions:\n  contents: read", content)
        self.assertIn("verify-upstream-merge:", content)
        for expected in (
            "git fetch --no-tags upstream main",
            "git merge --no-ff --no-commit upstream/main",
            "scripts/resolve_upstream_conflicts.py",
            "git ls-files -u",
            "git restore --source=HEAD --staged --worktree README.md .github/workflows",
            "git diff --exit-code upstream/main",
            "git worktree add --detach /tmp/verified-upstream-core upstream/main",
            "python -m pytest -q",
            "scripts/run_downstream_acceptance.py",
            "docker build --tag downloader-server:nextcloud-upstream-preview .",
        ):
            self.assertIn(expected, content)
        for prohibited in ("git push", "gh pr merge", "git commit -m"):
            self.assertNotIn(prohibited, content)

    def test_preview_and_live_merge_use_same_reviewed_test_selector(self):
        live = (
            ROOT / ".github/workflows/bootstrap-upstream.yml"
        ).read_text(encoding="utf-8")
        preview = (
            ROOT / ".github/workflows/verify-upstream-merge.yml"
        ).read_text(encoding="utf-8")
        for content in (live, preview):
            self.assertIn("python3 scripts/run_downstream_acceptance.py", content)
            self.assertIn("git diff --exit-code upstream/main", content)
            self.assertIn("scripts/resolve_upstream_conflicts.py", content)
        self.assertIn("git push origin HEAD:main", live)
        self.assertNotIn("git push origin HEAD:main", preview)


if __name__ == "__main__":
    unittest.main()
