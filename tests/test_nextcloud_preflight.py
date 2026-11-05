from __future__ import annotations

import json
import unittest
from urllib.error import HTTPError

from scripts.nextcloud_preflight import (
    PreflightClient, PreflightError, parse_dav_length, run_preflight, validate_folder,
)

DAV_SIZE = (
    b'<?xml version="1.0"?>'
    b'<d:multistatus xmlns:d="DAV:"><d:response><d:propstat>'
    b'<d:prop><d:getcontentlength>38</d:getcontentlength></d:prop>'
    b'<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
)


class FakeResponse:
    def __init__(self, status: int, data: bytes = b""):
        self.status = status
        self.data = data

    def read(self):
        return self.data

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class FakeOpener:
    def __init__(self):
        self.calls = []
        self.payload = None
        self.bad_size = False
        self.fail_put = False

    def open(self, req, timeout):
        method, url = req.get_method(), req.full_url
        self.calls.append((method, url, dict(req.headers)))
        if method == "GET" and url.endswith("/status.php"):
            assert "Authorization" not in req.headers
            return FakeResponse(200, json.dumps({"installed": True, "versionstring": "35.0.2", "maintenance": False}).encode())
        assert req.get_header("Authorization") == "Basic dXNlcjpzZWNyZXQ="
        if method == "PROPFIND" and url.endswith("/probe.bin"):
            size = len(self.payload or b"") + (1 if self.bad_size else 0)
            return FakeResponse(207, DAV_SIZE.replace(b">38<", f">{size}<".encode()))
        if method == "PROPFIND":
            return FakeResponse(207, b"<d:multistatus xmlns:d='DAV:'/>")
        if method == "MKCOL":
            return FakeResponse(201)
        if method == "PUT":
            if self.fail_put:
                raise HTTPError(url, 500, "failed", {}, None)
            self.payload = req.data
            return FakeResponse(201)
        if method == "GET":
            return FakeResponse(200, self.payload or b"")
        if method == "DELETE":
            return FakeResponse(204)
        raise AssertionError((method, url))


def client():
    result = PreflightClient("https://example.test/cloud", "user", "secret")
    fake = FakeOpener()
    result._opener = fake
    return result, fake


class PreflightTests(unittest.TestCase):
    def test_read_only_does_not_mutate_files(self):
        runner, fake = client()
        result = run_preflight(runner, folder="Downloads")
        self.assertEqual(result["webdav_read"], "passed")
        self.assertEqual(result["webdav_write"], "not tested")
        self.assertEqual(result["nextcloud"]["version"], "35.0.2")
        self.assertEqual([call[0] for call in fake.calls], ["GET", "PROPFIND"])
        self.assertTrue(fake.calls[-1][1].endswith("/remote.php/dav/files/user/Downloads"))

    def test_write_is_verified_and_cleans_up(self):
        runner, fake = client()
        result = run_preflight(runner, folder="Media/Downloads", write_test=True)
        self.assertTrue(result["webdav_write"]["sha256_verified"])
        self.assertTrue(result["webdav_write"]["cleaned_up"])
        methods = [call[0] for call in fake.calls]
        self.assertEqual(methods, ["GET", "PROPFIND", "MKCOL", "PUT", "PROPFIND", "GET", "DELETE", "DELETE"])
        self.assertIn("/Media/Downloads/.downloader-preflight-", fake.calls[2][1])

    def test_bad_size_cleans_up(self):
        runner, fake = client()
        fake.bad_size = True
        with self.assertRaisesRegex(PreflightError, "size mismatch"):
            run_preflight(runner, write_test=True)
        self.assertEqual([call[0] for call in fake.calls][-2:], ["DELETE", "DELETE"])

    def test_put_error_still_removes_probe_directory(self):
        runner, fake = client()
        fake.fail_put = True
        with self.assertRaisesRegex(PreflightError, "HTTP 500"):
            run_preflight(runner, write_test=True)
        self.assertEqual([call[0] for call in fake.calls][-1], "DELETE")

    def test_folder_segments_cannot_escape_destination(self):
        for folder in ("..", "hello/../world", "./hello", "hello//world", "/root", "root/", "root\\nested"):
            with self.subTest(folder=folder), self.assertRaises(PreflightError):
                validate_folder(folder)
        self.assertEqual(validate_folder("Photos/2026"), ["Photos", "2026"])

    def test_url_requires_https_and_never_embeds_credentials(self):
        with self.assertRaises(PreflightError):
            PreflightClient("http://example.test", "user", "secret")
        with self.assertRaises(PreflightError):
            PreflightClient("https://user:secret@example.test", "user", "secret")
        self.assertEqual(PreflightClient("http://localhost:8080", "user", "secret", allow_http=True).dav_url,
                         "http://localhost:8080/remote.php/dav/files/user")

    def test_webdav_metadata_must_be_successful(self):
        self.assertEqual(parse_dav_length(DAV_SIZE), 38)
        with self.assertRaises(PreflightError):
            parse_dav_length(b"<invalid")
        with self.assertRaises(PreflightError):
            parse_dav_length(DAV_SIZE.replace(b"200 OK", b"404 Not Found"))


if __name__ == "__main__":
    unittest.main()
