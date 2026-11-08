"""One canonical Core job-state vocabulary consumed by ExApp Python and native PHP."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

from app.job_states import JobStatus, TERMINAL_STATUSES
from nextcloud_exapp.user import TERMINAL_STATES
from scripts.bridge_job_state_contract import OUTPUT, PYTHON_OUTPUT, render, render_python


ROOT = Path(__file__).resolve().parents[1]


class NativeCoreJobStatusContractTests(unittest.TestCase):
    def test_generated_php_file_is_exact_reflection_of_core(self):
        self.assertEqual(OUTPUT.read_text(encoding="utf-8"), render())
        self.assertEqual(PYTHON_OUTPUT.read_text(encoding="utf-8"), render_python())
        self.assertNotIn("from app.", PYTHON_OUTPUT.read_text(encoding="utf-8"))
        subprocess.run(
            [sys.executable, "-m", "scripts.bridge_job_state_contract", "--check"],
            cwd=ROOT, check=True, capture_output=True, text=True, timeout=15,
        )

    def test_python_tracker_and_real_php_activity_use_identical_vocabulary(self):
        php = shutil.which("php")
        self.assertIsNotNone(php, "Native bridge contract requires the PHP CLI")
        samples = [status.value for status in JobStatus] + [
            "paused", "deleted", "", "COMPLETED", "complete", None, {}, 1,
        ]
        command = [php, str(ROOT / "bridge/tests/job-state-contract.php")]
        completed = subprocess.run(
            command, input=json.dumps(samples),
            check=True, capture_output=True, text=True, timeout=15,
        )
        php_result = json.loads(completed.stdout)
        all_states = sorted(status.value for status in JobStatus)
        terminal = sorted(status.value for status in TERMINAL_STATUSES)
        self.assertEqual(php_result["all"], all_states)
        self.assertEqual(php_result["terminal"], terminal)
        self.assertEqual(set(TERMINAL_STATES), set(terminal))
        from nextcloud_exapp.job_state_contract import ALL_STATES
        self.assertEqual(ALL_STATES, frozenset(all_states))
        self.assertEqual(
            php_result["checks"],
            [isinstance(sample, str) and sample in TERMINAL_STATES for sample in samples],
        )

    def test_exapp_image_packages_only_generated_leaf_and_no_core_source(self):
        dockerfile = (ROOT / "nextcloud_exapp/Dockerfile").read_text()
        self.assertIn("COPY nextcloud_exapp/*.py /app/nextcloud_exapp/", dockerfile)
        self.assertIn("nextcloud_exapp.job_state_contract import TERMINAL_STATES", dockerfile)
        self.assertNotIn("COPY app/", dockerfile)
        self.assertNotIn("from app.job_states", dockerfile)
        runtime_user = (ROOT / "nextcloud_exapp/user.py").read_text()
        self.assertIn("from nextcloud_exapp.job_state_contract import TERMINAL_STATES", runtime_user)
        self.assertNotIn("from app.job_states", runtime_user)

    def test_php_activity_uses_generated_contract_not_embedded_status_list(self):
        content = (ROOT / "bridge/lib/BackgroundJob/ActivitySync.php").read_text()
        self.assertIn("JobStateContract::isTerminal($status)", content)
        self.assertNotIn("['completed', 'failed', 'cancelled']", content)
        self.assertIn("EntitlementPolicy::allows(", content)
        script = (ROOT / "scripts/bridge_job_state_contract.py").read_text()
        self.assertIn("from app.job_states import JobStatus, TERMINAL_STATUSES", script)
        self.assertIn('if args.check:', script)


if __name__ == "__main__":
    unittest.main()
