"""A release manifest is never allowed to claim AppAPI supports @sha256."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from xml.etree import ElementTree as ET

from scripts.exapp_release_manifest import render_release

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = (ROOT / "appinfo/info.xml").read_bytes()
SHA = "a" * 40
DIGEST = "sha256:" + "f" * 64


class ExAppReleaseManifestTests(unittest.TestCase):
    def test_renders_immutable_identity_and_truthful_digest_record(self):
        xml, record = render_release(TEMPLATE, SHA, DIGEST)
        root = ET.fromstring(xml)
        self.assertEqual(
            root.findtext("./external-app/docker-install/image-tag"),
            f"sha-{SHA}",
        )
        self.assertEqual(
            record["container_image_tag"],
            f"ghcr.io/neup123/downloader-server-nextcloud:sha-{SHA}",
        )
        self.assertEqual(
            record["container_image_digest"],
            f"ghcr.io/neup123/downloader-server-nextcloud@{DIGEST}",
        )
        self.assertFalse(record["appapi_manifest_digest_pinned"])
        self.assertEqual(record["appapi_manifest_sha256"], hashlib.sha256(xml).hexdigest())
        self.assertTrue(all(
            r.findtext("access_level") == "ADMIN"
            for r in root.findall("./external-app/routes/route")
            if (r.findtext("url") or "").startswith("^/api/v1/")
        ))

    def test_invalid_source_sha_and_digest_fail_closed(self):
        for source in ("abcd", "A" * 40, "x" * 40, "a" * 41, "a" * 39, "a" * 40 + "\n"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                render_release(TEMPLATE, source, DIGEST)
        for digest in ("sha256:bad", "sha256:" + "A" * 64, "sha512:" + "f" * 64,
                       "sha256:" + "f" * 63, "sha256:" + "f" * 64 + "\n"):
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                render_release(TEMPLATE, SHA, digest)

    def test_wrong_image_and_missing_admin_guards_are_rejected(self):
        for changed in (
            TEMPLATE.replace(b"neup123/downloader-server-nextcloud", b"some-other-image"),
            TEMPLATE.replace(b"<image-tag>0.5.3</image-tag>", b"<image-tag>latest</image-tag>"),
            TEMPLATE.replace(b"<access_level>ADMIN</access_level>", b"<access_level>USER</access_level>", 1),
            TEMPLATE.replace(b'max-version="35"', b'max-version="99"'),
        ):
            with self.subTest(changed=changed[:50]), self.assertRaises(ValueError):
                render_release(changed, SHA, DIGEST)

    def test_owner_approved_bsl_and_separate_agpl_bridge(self):
        license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
        native_license = (ROOT / "bridge/LICENSE").read_text(encoding="utf-8")
        exapp = ET.fromstring(TEMPLATE)
        native = ET.parse(ROOT / "bridge/appinfo/info.xml").getroot()
        self.assertEqual(exapp.findtext("licence"), "BUSL-1.1")
        self.assertEqual(native.findtext("licence").lower(), "agpl")
        self.assertIn("Business Source License 1.1", license_text)
        self.assertIn("twenty (20)", license_text)
        self.assertIn("USD 250,000", license_text)
        self.assertIn("Required Notice", license_text)
        self.assertIn("2030-11-08", license_text)
        self.assertIn("GPL-3.0-or-later", license_text)
        self.assertIn("native Nextcloud bridge/ component", license_text)
        self.assertTrue(native_license.startswith("GNU AFFERO GENERAL PUBLIC LICENSE"))
        self.assertIn("Version 3, 19 November 2007", native_license)

    def test_cli_writes_both_correlated_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "release"
            process = subprocess.run([
                sys.executable, str(ROOT / "scripts/exapp_release_manifest.py"),
                "--source-sha", SHA, "--digest", DIGEST,
                "--manifest", str(ROOT / "appinfo/info.xml"),
                "--output", str(output),
            ], capture_output=True, text=True, check=True)
            self.assertIn("NOT a native digest reference", process.stdout)
            record = json.loads((output / "image-provenance.json").read_text())
            xml = (output / "info.xml").read_bytes()
            self.assertEqual(record["appapi_manifest_sha256"], hashlib.sha256(xml).hexdigest())
            self.assertEqual(ET.fromstring(xml).findtext("./external-app/docker-install/image-tag"), f"sha-{SHA}")


if __name__ == "__main__":
    unittest.main()
