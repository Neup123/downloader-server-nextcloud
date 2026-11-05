"""Offline read-only checks for the Nextcloud AppAPI deployment readiness probe."""
from __future__ import annotations

import json
import subprocess
import unittest

from scripts.appapi_readiness import ReadinessError, run_readiness


class FakeRunner:
    def __init__(self, *, enabled=True, daemon_error=False, status=None, app_list=None):
        self.calls = []
        self.enabled = enabled
        self.daemon_error = daemon_error
        self.status = status or {"installed": True, "versionstring": "35.0.2", "maintenance": False}
        self.app_list = app_list

    def __call__(self, command, *, capture_output, text, timeout, check):
        self.calls.append(command)
        assert capture_output is True and text is True and check is False and timeout <= 30
        op = command[-2] if command[-1] == "--output=json" else command[-1]
        if op == "status":
            return subprocess.CompletedProcess(command, 0, json.dumps(self.status), "")
        if op == "app:list":
            apps = self.app_list if self.app_list is not None else {
                "enabled": {"app_api": "35.0.2"} if self.enabled else {"files": "35.0.2"},
                "disabled": {},
            }
            return subprocess.CompletedProcess(command, 0, json.dumps(apps), "")
        if op == "app_api:daemon:list":
            if self.daemon_error:
                return subprocess.CompletedProcess(command, 1, "", "secret-internal-daemon-token")
            return subprocess.CompletedProcess(command, 0, "host=internal:2375 password=secret-internal-token", "")
        raise AssertionError("Unexpected occ operation")


class AppApiReadinessTests(unittest.TestCase):
    def test_enabled_appapi_checks_daemons_but_never_exposes_daemon_secrets(self):
        runner = FakeRunner()
        report = run_readiness(["docker", "exec", "--user", "www-data", "nextcloud-aio-nextcloud", "php", "occ"], runner=runner)
        self.assertEqual(report["nextcloud"]["version"], "35.0.2")
        self.assertTrue(report["appapi"]["enabled"])
        self.assertEqual(report["appapi"]["version"], "35.0.2")
        self.assertIn("succeeded", report["deploy_daemon"]["list_command"])
        self.assertEqual(len(runner.calls), 3)
        for command in runner.calls:
            self.assertEqual(command[:6], ["docker", "exec", "--user", "www-data", "nextcloud-aio-nextcloud", "php"])
        self.assertNotIn("secret-", json.dumps(report))
        self.assertIn("unverified", report["exapp_ready"])

    def test_disabled_appapi_never_invokes_daemon_command(self):
        runner = FakeRunner(enabled=False)
        report = run_readiness(["php", "/var/www/html/occ"], runner=runner)
        self.assertFalse(report["appapi"]["enabled"])
        self.assertEqual(len(runner.calls), 2)
        self.assertIn("not run", report["deploy_daemon"]["list_command"])

    def test_daemon_command_failure_is_reported_without_stderr_secrets(self):
        runner = FakeRunner(daemon_error=True)
        report = run_readiness(["php", "occ"], runner=runner)
        self.assertEqual(report["deploy_daemon"]["list_command"], "failed")
        self.assertNotIn("secret-internal", json.dumps(report))

    def test_app_list_with_list_objects_is_accepted(self):
        runner = FakeRunner(app_list={"enabled": [{"app_api": "4.0.0"}, {"files": "35.0"}]})
        report = run_readiness(["php", "occ"], runner=runner)
        self.assertTrue(report["appapi"]["enabled"])
        self.assertEqual(report["appapi"]["version"], "4.0.0")

    def test_uninstalled_instance_is_rejected_before_other_queries(self):
        runner = FakeRunner(status={"installed": False, "version": "35.0.0"})
        with self.assertRaisesRegex(ReadinessError, "not installed"):
            run_readiness(["php", "occ"], runner=runner)
        self.assertEqual(len(runner.calls), 1)

    def test_readiness_does_not_run_mutating_occ_commands(self):
        runner = FakeRunner()
        run_readiness(["php", "occ"], runner=runner)
        self.assertEqual(
            [c[-2:] for c in runner.calls],
            [["status", "--output=json"], ["app:list", "--output=json"], ["occ", "app_api:daemon:list"]],
        )
        self.assertNotIn("register", " ".join(" ".join(c) for c in runner.calls))


if __name__ == "__main__":
    unittest.main()
