"""Disposable Nextcloud preflight must not serialize unrelated PR revision checks."""
from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DisposableAcceptanceIsolationTests(unittest.TestCase):
    def test_revision_scoped_concurrency_never_blocks_latest_candidate(self):
        source = (ROOT / ".github/workflows/live-nextcloud-preflight.yml").read_text()
        self.assertIn(
            "group: live-disposable-nextcloud-preflight-${{ github.ref }}-${{ github.sha }}",
            source,
        )
        self.assertIn("cancel-in-progress: false", source)
        self.assertIn("pull_request:", source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("contents: read", source)

    def test_disposable_target_isolated_and_cleanup_explicit(self):
        source = (ROOT / ".github/workflows/live-nextcloud-preflight.yml").read_text()
        self.assertIn("nextcloud:35.0.2-apache", source)
        self.assertIn("NEXTCLOUD_ADMIN_PASSWORD", source)
        self.assertIn("--write-test", source)
        self.assertIn("docker rm", source)
        self.assertIn("if: always()", source)


if __name__ == "__main__":
    unittest.main()
