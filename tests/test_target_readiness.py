"""Read-only target report composes existing checks without claiming ExApp readiness."""
from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from scripts.appapi_readiness import ReadinessError
from scripts.target_readiness import collect_target_report, main


APPAPI = {
    "nextcloud": {"version": "35.0.2", "maintenance": False},
    "appapi": {"enabled": True, "version": "4.0"},
    "deploy_daemon": {
        "list_command": "succeeded",
        "registration": "present (1 entries; details withheld)",
        "test_deploy": "not tested; requires an administrator",
    },
}
WEBDAV = {
    "nextcloud": {"version": "35.0.2", "maintenance": False},
    "webdav_read": "passed",
    "destination_folder": "Downloader",
    "webdav_write": "not tested",
}


class CombinedTargetReadinessTests(unittest.TestCase):
    @patch("scripts.target_readiness.run_preflight", return_value=WEBDAV)
    @patch("scripts.target_readiness.run_readiness", return_value=APPAPI)
    def test_readonly_default_never_requests_upload_or_test_deploy(self, appapi, dav):
        report = collect_target_report(["docker", "exec", "nc", "php", "occ"], object(), folder="Downloader")
        dav.assert_called_once()
        self.assertFalse(dav.call_args.kwargs["write_test"])
        appapi.assert_called_once()
        self.assertIn("not verified", report["release_gate"]["webdav_delivery"])
        self.assertIn("unverified", report["release_gate"]["exapp_ready"])
        self.assertNotIn("password", json.dumps(report).lower().replace("app_password", ""))
        self.assertEqual(report["webdav"]["destination_folder"], "Downloader")

    @patch("scripts.target_readiness.run_preflight")
    @patch("scripts.target_readiness.run_readiness", return_value=APPAPI)
    def test_explicit_write_test_reports_verified_readback_but_no_exapp_approval(self, appapi, dav):
        dav.return_value = {
            **WEBDAV,
            "webdav_write": {"sha256_verified": True, "cleaned_up": True, "size_bytes": 32},
        }
        report = collect_target_report(["php", "occ"], object(), write_test=True)
        self.assertTrue(dav.call_args.kwargs["write_test"])
        self.assertEqual(report["release_gate"]["webdav_delivery"], "verified on actual target")
        self.assertIn("not verified", report["release_gate"]["appapi_test_deploy"])

    @patch("scripts.target_readiness.run_preflight")
    @patch("scripts.target_readiness.run_readiness", return_value=APPAPI)
    def test_mismatched_webdav_origin_fails_closed(self, appapi, dav):
        dav.return_value = {
            **WEBDAV,
            "nextcloud": {"version": "34.0.0", "maintenance": False},
        }
        with self.assertRaisesRegex(ReadinessError, "different Nextcloud versions"):
            collect_target_report(["php", "occ"], object())

    @patch.dict(os.environ, {"NEXTCLOUD_APP_PASSWORD": "very-secret-app-password"})
    @patch("scripts.target_readiness.PreflightClient")
    @patch("scripts.target_readiness.collect_target_report")
    def test_cli_never_echoes_app_password(self, collect, client):
        collect.return_value = {
            "release_gate": {"exapp_ready": "unverified"},
            "nextcloud": {"version": "35.0.2"},
        }
        stream = io.StringIO()
        with redirect_stdout(stream):
            code = main([
                "--container", "nextcloud-aio-nextcloud",
                "--url", "https://cloud.example",
                "--username", "operator",
                "--folder", "Downloader",
            ])
        self.assertEqual(code, 0)
        self.assertNotIn("very-secret-app-password", stream.getvalue())
        client.assert_called_once_with("https://cloud.example", "operator", "very-secret-app-password", allow_http=False)
        self.assertFalse(collect.call_args.kwargs["write_test"])


if __name__ == "__main__":
    unittest.main()
