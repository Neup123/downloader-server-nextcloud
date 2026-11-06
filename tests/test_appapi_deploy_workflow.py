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

    def test_our_exapp_really_deploys_and_enforces_appapi_signing(self):
        source = (ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml").read_text()
        required = (
            "ghcr.io/neup123/downloader-server-nextcloud:0.4.0",
            "app_api:daemon:registry:add downloader-ci-dsp",
            "--registry-from=ghcr.io --registry-to=local",
            "--info-xml /tmp/downloader-info.xml",
            "app_api:app:register downloader-server-nextcloud",
            "docker inspect nc_app_downloader-server-nextcloud",
            "AUTHORIZATION-APP-API",
            'assert exc.code == 401',
            "ci-proxy-verified",
            "downloader-test-core",
            "app_api:app:unregister downloader-server-nextcloud",
        )
        for snippet in required:
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, source)
        manifest = (ROOT / "appinfo/info.xml").read_text()
        self.assertIn("<image-tag>0.4.0</image-tag>", manifest)
        fixture = (ROOT / "tests/exapp_mock_core.py").read_text()
        for dangerous in ("Authorization", "Cookie", "AUTHORIZATION-APP-API"):
            self.assertIn(dangerous, fixture)

    def test_no_exapp_deployment_claim_on_unrelated_webdav_preflight(self):
        webdav = (ROOT / ".github/workflows/live-nextcloud-preflight.yml").read_text()
        self.assertIn("appapi_readiness.py", webdav)
        self.assertNotIn("app_api:app:register", webdav)


if __name__ == "__main__":
    unittest.main()
