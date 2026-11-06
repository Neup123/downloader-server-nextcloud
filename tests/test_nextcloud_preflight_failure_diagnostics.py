"""Ensure disposable Nextcloud failures leave diagnostic evidence, not secrets."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/live-nextcloud-preflight.yml"


class DisposablePreflightFailureTests(unittest.TestCase):
    def test_failure_logs_precede_disposable_teardown(self):
        content = WORKFLOW.read_text()
        assert "if: failure()" in content
        assert "docker logs --tail 200 downloader-preflight-nextcloud" in content
        assert "state={{.State.Status}}" in content
        assert "oom={{.State.OOMKilled}}" in content
        assert "NEXTCLOUD_APP_PASSWORD" in content
        assert 'log=log.replace(secret,"[REDACTED]")' in content
        assert content.index("Report sanitized disposable startup diagnostics") < content.index(
            "Remove disposable Nextcloud container and volumes"
        )
        assert "if: always()" in content
        assert "docker inspect downloader-preflight-nextcloud \\\n            --format 'state={{.State.Status}}" in content
        # Never dump a container's unredacted environment.
        assert "docker inspect --format '{{json .Config.Env}}'" not in content
        assert 'docker logs --tail 200 downloader-preflight-nextcloud' in content


if __name__ == "__main__":
    unittest.main()
