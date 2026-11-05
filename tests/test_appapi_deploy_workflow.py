"""Offline guardrails for real disposable Nextcloud AppAPI deployment acceptance."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AppApiDeployWorkflowTests(unittest.TestCase):
    def test_disposable_docker_deploy_checks_lifecycle(self):
        source = (ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml").read_text()
        for required in (
            "nextcloud:35.0.2-apache",
            "docker network create downloader-appapi-ci",
            "ghcr.io/nextcloud/nextcloud-appapi-dsp:v1.5.3",
            "app_api:daemon:register",
            "--set-default",
            "app_api:app:register",
            "app_api:app:enable",
            "app_api:app:disable",
            "app_api:app:unregister",
            "docker inspect nc_app_app-skeleton-python",
            "if: always()",
            "docker network rm downloader-appapi-ci",
        ):
            self.assertIn(required, source)
        self.assertIn("permissions:\n  contents: read", source)
        self.assertIn("127.0.0.1:8099:80", source)
        self.assertNotIn("NEXTCLOUD_ADMIN_PASSWORD=admin", source)

    def test_no_exapp_deployment_claim_on_unrelated_webdav_preflight(self):
        webdav = (ROOT / ".github/workflows/live-nextcloud-preflight.yml").read_text()
        self.assertIn("appapi_readiness.py", webdav)
        self.assertNotIn("app_api:app:register", webdav)


if __name__ == "__main__":
    unittest.main()
