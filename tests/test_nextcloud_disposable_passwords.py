"""Verify disposable Nextcloud admin credentials cannot start with an option dash."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NextcloudDisposablePasswords(unittest.TestCase):
    def test_default_nextcloud_admin_passwords_are_always_positional_values(self):
        preflight = (ROOT / ".github/workflows/live-nextcloud-preflight.yml").read_text()
        appapi = (ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml").read_text()
        self.assertIn('print("nc-" + secrets.token_urlsafe(32))', preflight)
        self.assertIn('("nc-" if name == "NEXTCLOUD_APP_PASSWORD" else "") + secrets.token_urlsafe(32)', appapi)
        self.assertIn("NEXTCLOUD_ADMIN_PASSWORD=\"$NEXTCLOUD_APP_PASSWORD\"", preflight)
        self.assertIn('-e NEXTCLOUD_ADMIN_PASSWORD="$NEXTCLOUD_APP_PASSWORD"', appapi)
        self.assertIn('NEXTCLOUD_APP_PASSWORD', appapi)
        # Other unrelated secrets retain their independent secure generation.
        self.assertIn('APPAPI_DSP_PASSWORD', appapi)


if __name__ == "__main__":
    unittest.main()
