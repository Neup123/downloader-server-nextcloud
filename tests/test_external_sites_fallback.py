"""Validate the actual Docker Compose model used by the External Sites fallback.

Compose JSON is the source of truth. These tests run in CI with the Docker
Compose plugin and intentionally do not start any production containers.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "compose.external-sites.yaml"


@unittest.skipUnless(shutil.which("docker"), "Docker CLI unavailable on this host")
class ExternalSitesFallbackContractTests(unittest.TestCase):
    def compose(self, token="test-only-long-token-value-01234567890123456789",
                key="test-only-placeholder-not-a-real-fernet-key"):
        env = os.environ.copy()
        env.update({
            "APP_API_TOKEN": token,
            "APP_ENCRYPTION_KEY": key,
            "APP_BIND_ADDRESS": "127.0.0.1",
            "APP_PORT": "8080",
        })
        # A caller's local .env must never override the explicitly supplied
        # test values; only Compose config is evaluated, never the service.
        return subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE),
             "config", "--format", "json"],
            cwd=ROOT, env=env, text=True, capture_output=True, check=False,
        )

    def test_full_config_uses_guarded_released_core_and_persistent_volume(self):
        result = self.compose()
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        self.assertEqual(config["name"], "downloader-external-sites")
        core = config["services"]["downloader-server"]
        guard = config["services"]["egress-guard"]
        self.assertEqual(core["image"], "ghcr.io/neup123/media-downloader-server:0.3.1")
        self.assertNotIn("build", core)
        self.assertEqual(core["network_mode"], "service:egress-guard")
        self.assertEqual(core["depends_on"]["egress-guard"]["condition"], "service_healthy")
        self.assertEqual(guard["cap_add"], ["NET_ADMIN"])
        self.assertEqual(core["cap_drop"], ["ALL"])
        self.assertEqual(core["environment"]["ALLOW_PRIVATE_TARGETS"], "false")
        self.assertEqual(core["environment"]["ALLOW_PRIVATE_WEBDAV_TARGETS"], "false")
        self.assertEqual(core["environment"]["ALLOW_INSECURE_WEBDAV"], "false")
        self.assertEqual(core["environment"]["APP_ENCRYPTION_KEY"],
                         "test-only-placeholder-not-a-real-fernet-key")
        self.assertTrue(core["read_only"])
        self.assertNotIn("ports", core)
        self.assertEqual(guard["ports"][0]["host_ip"], "127.0.0.1")
        self.assertEqual(guard["ports"][0]["published"], "8080")
        self.assertEqual(config["volumes"]["downloader-data"]["name"],
                         "downloader-server-egress-data")
        self.assertTrue(any(m["target"] == "/data" and m["type"] == "volume"
                            for m in core["volumes"]))
        self.assertNotIn("downloader-server-nextcloud", core["image"])

    def test_missing_secrets_fail_at_compose_config_stage(self):
        self.assertNotEqual(self.compose(token="").returncode, 0)
        self.assertNotEqual(self.compose(key="").returncode, 0)

    def test_optional_exapp_network_overlay_reuses_guarded_core(self):
        env = os.environ.copy()
        env.update({
            "APP_API_TOKEN": "test-token-012345678901234567890123456789",
            "APP_ENCRYPTION_KEY": "test-only",
            "NEXTCLOUD_DOCKER_NETWORK": "actual-nextcloud-network",
            "DOWNLOADER_IMAGE": "ghcr.io/neup123/media-downloader-server:0.3.1",
        })
        result = subprocess.run(
            ["docker", "compose", "-f", str(ROOT / "compose.egress.yaml"),
             "-f", str(ROOT / "compose.nextcloud-network.yaml"),
             "config", "--format", "json"],
            cwd=ROOT, env=env, text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        model = json.loads(result.stdout)
        self.assertEqual(model["networks"]["nextcloud-integration"]["name"],
                         "actual-nextcloud-network")
        self.assertTrue(model["networks"]["nextcloud-integration"]["external"])
        guard = model["services"]["egress-guard"]
        self.assertIn("downloader-core",
                      guard["networks"]["nextcloud-integration"]["aliases"])
        core = model["services"]["downloader-server"]
        self.assertEqual(core["network_mode"], "service:egress-guard")
        self.assertNotIn("networks", core)
        self.assertNotIn("ports", core)
        self.assertEqual(core["environment"]["ALLOW_PRIVATE_TARGETS"], "false")
        self.assertEqual(core["environment"]["ALLOW_PRIVATE_WEBDAV_TARGETS"], "false")
        self.assertEqual(model["volumes"]["downloader-data"]["name"],
                         "downloader-server-egress-data")

    def test_network_overlay_requires_existing_network_name(self):
        env = os.environ.copy()
        env.update({"APP_API_TOKEN": "test", "NEXTCLOUD_DOCKER_NETWORK": ""})
        result = subprocess.run(
            ["docker", "compose", "-f", str(ROOT / "compose.egress.yaml"),
             "-f", str(ROOT / "compose.nextcloud-network.yaml"), "config"],
            cwd=ROOT, env=env, text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)

    def test_documented_fallback_does_not_claim_per_user_sso(self):
        doc = (ROOT / "NEXTCLOUD_EXTERNAL_SITES_FALLBACK.md").read_text()
        self.assertIn("External Sites", doc)
        self.assertIn("app password", doc)
        self.assertIn("not authenticate to Downloader", doc)
        self.assertIn("Do not run", doc)
        self.assertIn("redirect", doc.lower())


if __name__ == "__main__":
    unittest.main()
