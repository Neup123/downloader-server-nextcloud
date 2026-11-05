"""Detect a unique Nextcloud application container without guessing or mutation."""
from __future__ import annotations

import io
import json
import os
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from scripts.appapi_readiness import ReadinessError, detect_nextcloud_container, main as appapi_main
from scripts.target_readiness import main as target_main


def completed(output: str, status: int = 0, stderr: str = ""):
    return subprocess.CompletedProcess(["docker", "ps"], status, output, stderr)


class NextcloudContainerDiscoveryTests(unittest.TestCase):
    def test_selects_one_aio_application_container_not_master_or_redis(self):
        calls = []
        def run(command, **kwargs):
            calls.append((command, kwargs))
            return completed("redis\nnextcloud-aio-mastercontainer\nnextcloud-aio-nextcloud\n")
        self.assertEqual(detect_nextcloud_container(runner=run), "nextcloud-aio-nextcloud")
        self.assertEqual(calls[0][0], ["docker", "ps", "--format", "{{.Names}}"])
        self.assertTrue(calls[0][1]["capture_output"])
        self.assertFalse(calls[0][1]["check"])
        self.assertLessEqual(calls[0][1]["timeout"], 15)

    def test_classic_nextcloud_ordinal_container_is_recognized(self):
        self.assertEqual(
            detect_nextcloud_container(runner=lambda *_a, **_kw: completed("nextcloud-1\nother-service\n")),
            "nextcloud-1",
        )

    def test_ambiguous_or_missing_containers_are_rejected(self):
        for output in ("redis\n", "nextcloud\nnextcloud-aio-nextcloud\n", "nextcloud-1\nnextcloud-2\n"):
            with self.subTest(output=output), self.assertRaisesRegex(ReadinessError, "exactly one"):
                detect_nextcloud_container(runner=lambda *_a, **_kw: completed(output))

    def test_discovery_failure_does_not_expose_docker_stderr_or_secrets(self):
        with self.assertRaises(ReadinessError) as raised:
            detect_nextcloud_container(
                runner=lambda *_a, **_kw: completed("", 1, "secret-private-container-token")
            )
        self.assertNotIn("secret-private-container-token", str(raised.exception))

    def test_missing_docker_fails_closed(self):
        def fail(*_args, **_kwargs):
            raise FileNotFoundError("docker unavailable")
        with self.assertRaises(ReadinessError):
            detect_nextcloud_container(runner=fail)

    @patch("scripts.appapi_readiness.run_readiness", return_value={"nextcloud": {"version": "35.0.2"}})
    @patch("scripts.appapi_readiness.detect_nextcloud_container", return_value="nextcloud-aio-nextcloud")
    def test_appapi_auto_cli_uses_exact_container(self, discover, readiness):
        output = io.StringIO()
        with redirect_stdout(output):
            result = appapi_main(["--auto-container"])
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["nextcloud"]["version"], "35.0.2")
        readiness.assert_called_once_with([
            "docker", "exec", "--user", "www-data", "nextcloud-aio-nextcloud", "php", "occ"
        ])
        discover.assert_called_once()

    @patch.dict(os.environ, {"NEXTCLOUD_APP_PASSWORD": "private-password"})
    @patch("scripts.target_readiness.collect_target_report", return_value={"release_gate": {"exapp_ready": "unverified"}})
    @patch("scripts.target_readiness.PreflightClient")
    @patch("scripts.target_readiness.detect_nextcloud_container", return_value="nextcloud-1")
    def test_combined_target_cli_uses_same_detected_instance(self, discover, client, collect):
        output = io.StringIO()
        with redirect_stdout(output):
            result = target_main([
                "--auto-container", "--url", "https://cloud.example.org",
                "--username", "operator", "--folder", "Downloader"
            ])
        self.assertEqual(result, 0)
        self.assertEqual(collect.call_args.args[0], [
            "docker", "exec", "--user", "www-data", "nextcloud-1", "php", "occ"
        ])
        self.assertNotIn("private-password", output.getvalue())
        discover.assert_called_once()


if __name__ == "__main__":
    unittest.main()
