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
from scripts.bridge_job_state_contract import OUTPUT, render


ROOT = Path(__file__).resolve().parents[1]


class NativeCoreJobStatusContractTests(unittest.TestCase):
    def test_generated_php_file_is_exact_reflection_of_core(self):
        self.assertEqual(OUTPUT.read_text(encoding="utf-8"), render())
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
        self.assertEqual(
            php_result["checks"],
            [isinstance(sample, str) and sample in TERMINAL_STATES for sample in samples],
        )

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
