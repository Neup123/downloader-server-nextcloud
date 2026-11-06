"""Release manifest, OCI digest and running-container reconciliation tests."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from scripts.verify_deployed_exapp import (
    ImageVerificationError, image_from_manifest, reconciliation,
)

ROOT = Path(__file__).resolve().parents[1]
RELEASE = (ROOT / "appinfo/info.xml").read_bytes()
SHA = "a" * 40
IMAGE_ID = "sha256:" + "b" * 64
DIGEST = "sha256:" + "c" * 64
REF = "ghcr.io/neup123/downloader-server-nextcloud@" + DIGEST


class TargetExappImageTests(unittest.TestCase):
    def test_manifest_is_from_expected_registry(self):
        image, version, tag = image_from_manifest(RELEASE)
        self.assertEqual(image, "ghcr.io/neup123/downloader-server-nextcloud:0.5.2")
        self.assertEqual(version, "0.5.2")
        self.assertEqual(tag, "0.5.2")
        for invalid in (
            RELEASE.replace(b"ghcr.io", b"badreg", 1),
            RELEASE.replace(b"neup123/downloader-server-nextcloud",
                            b"someone-else/my-container", 1),
            RELEASE.replace(b"<image-tag>0.5.2</image-tag>",
                            b"<image-tag>latest</image-tag>"),
        ):
            with self.subTest(invalid=invalid[:90]), self.assertRaises(ImageVerificationError):
                image_from_manifest(invalid)

    def test_running_image_digest_and_source_must_all_match(self):
        calls = []
        def docker_mock(args):
            calls.append(args)
            arguments = " ".join(args)
            if "{{.Id}}" in arguments:
                return IMAGE_ID
            if "{{.Image}}" in arguments:
                return IMAGE_ID
            if "org.opencontainers.image.revision" in arguments:
                return SHA
            if "RepoDigests" in arguments:
                return json.dumps([REF])
            raise AssertionError(args)

        with patch("scripts.verify_deployed_exapp.docker_field", side_effect=docker_mock):
            result = reconciliation(RELEASE, "nc_app_downloader-server-nextcloud", SHA, REF)
        self.assertTrue(result["matches_expected_publisher_digest"])
        self.assertEqual(result["deployed_image_digest"], REF)
        self.assertTrue(result["target_image_reconciled"])
        self.assertFalse(result["appapi_native_digest_pinned"])
        self.assertEqual(len(calls), 4)

    def test_wrong_image_or_source_fails_closed(self):
        for payloads in (
            [IMAGE_ID, "sha256:" + "1" * 64, SHA, json.dumps([REF])],
            [IMAGE_ID, IMAGE_ID, "d" * 40, json.dumps([REF])],
            [IMAGE_ID, IMAGE_ID, SHA, json.dumps([])],
        ):
            with self.subTest(payloads=payloads), patch(
                "scripts.verify_deployed_exapp.docker_field", side_effect=payloads
            ):
                with self.assertRaises(ImageVerificationError):
                    reconciliation(RELEASE, "nc_app_downloader-server-nextcloud", SHA)

    def test_publisher_digest_mismatch_fails_closed(self):
        with patch("scripts.verify_deployed_exapp.docker_field",
                   side_effect=[IMAGE_ID, IMAGE_ID, SHA, json.dumps([REF])]):
            with self.assertRaisesRegex(ImageVerificationError, "differs from"):
                reconciliation(RELEASE, "nc_app_downloader-server-nextcloud", SHA,
                               "ghcr.io/neup123/downloader-server-nextcloud@sha256:" + "f" * 64)

    def test_source_sha_and_container_name_are_strict(self):
        for invalid in ("abc", "A" * 40, "a" * 41, "a" * 40 + "\n"):
            with self.subTest(invalid=invalid), self.assertRaises(ImageVerificationError):
                reconciliation(RELEASE, "nc_app_downloader-server-nextcloud", invalid)
        with self.assertRaises(ImageVerificationError):
            reconciliation(RELEASE, "../other-container", SHA)


if __name__ == "__main__":
    unittest.main()
