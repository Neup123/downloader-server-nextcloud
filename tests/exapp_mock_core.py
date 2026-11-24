"""Deterministic disposable test origin for the Nextcloud AppAPI gateway.

Never deploy this fixture as a real core service: it only verifies that the
ExApp forwards a request with its server-side key, not user credentials.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import parse_qs, quote, urlsplit


# Controlled CI fixture state only, never a production core implementation.
# Completion is published only after the runner independently verifies an
# actual byte-for-byte Nextcloud WebDAV upload.
_STATE_LOCK = Lock()
_TEST_JOB: dict | None = None
_COOKIE_RECORDS: dict[str, dict] = {}
_COOKIE_PREFIX = 'nc-' + hashlib.sha256(b'alice').hexdigest()[:24] + '-'
_COOKIE_NAMES = {_COOKIE_PREFIX + site + '.txt' for site in ('alpha.example', 'beta.example')}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/healthz":
            self.respond(200, {"ready": True})
            return
        if self.headers.get("X-API-Key") != os.environ["MOCK_CORE_TOKEN"]:
            self.respond(401, {"detail": "Not authenticated"})
            return
        if any(self.headers.get(header) for header in (
            "Authorization", "Cookie", "AUTHORIZATION-APP-API",
        )):
            self.respond(400, {"detail": "Browser credentials reached core"})
            return
        target = urlsplit(self.path)
        if target.path == "/api/v1/jobs" and target.query:
            owner = parse_qs(target.query).get("owner_id", [""])[0]
            with _STATE_LOCK:
                selected = dict(_TEST_JOB) if _TEST_JOB is not None else None
            self.respond(200, [selected] if owner == "alice" and selected else [])
        elif self.path == "/api/v1/jobs":
            self.respond(200, [{"id": "ci-proxy-verified", "status": "queued"}])
        elif target.path == "/api/v1/jobs/ci-first-use-user-job":
            with _STATE_LOCK:
                selected = dict(_TEST_JOB) if _TEST_JOB is not None else None
            if selected:
                self.respond(200, selected)
            else:
                self.respond(404, {"detail": "No fixture job"})
        elif self.path == "/api/v1/cookies":
            with _STATE_LOCK:
                rows = [dict(record) for record in _COOKIE_RECORDS.values()]
            self.respond(200, rows)
        elif self.path == "/api/v1/engines":
            self.respond(200, [{"name": "generic", "installed": True}])
        else:
            self.respond(404, {"detail": "Unknown endpoint"})

    def do_POST(self) -> None:
        global _TEST_JOB
        if self.headers.get("X-API-Key") != os.environ["MOCK_CORE_TOKEN"]:
            self.respond(401, {"detail": "Not authenticated"})
            return
        if any(self.headers.get(header) for header in (
            "Authorization", "Cookie", "AUTHORIZATION-APP-API",
        )):
            self.respond(400, {"detail": "Browser credentials reached core"})
            return
        if self.path == "/fixture/mark-delivering":
            # An explicit test-only transition makes the native UI prove that
            # real signed AppAPI polling observes queued -> delivering.
            with _STATE_LOCK:
                if _TEST_JOB is None or _TEST_JOB["status"] != "queued":
                    self.respond(409, {"detail": "No queued fixture job"})
                    return
                _TEST_JOB = {
                    **_TEST_JOB, "status": "delivering",
                    "progress": {"state": "delivering", "percent": 85},
                }
            self.respond(200, {"fixture_delivering": True})
            return
        if self.path == "/fixture/complete-after-dav-readback":
            # The runner calls this **only after** uploading into disposable
            # Nextcloud and checking the actual returned bytes and checksum.
            with _STATE_LOCK:
                if _TEST_JOB is None:
                    self.respond(409, {"detail": "No queued test job"})
                    return
                _TEST_JOB = {
                    **_TEST_JOB,
                    "status": "completed",
                    "progress": {"state": "completed", "percent": 100},
                    "output_files": [{
                        "filename": "dummy.pdf", "size_bytes": 13264,
                        "verified": True,
                        "path": ("http://downloader-appapi-nextcloud/remote.php/dav/files/alice/"
                                 + quote(_TEST_JOB["delivery"]["folder"], safe="/")
                                 + "/ci-first-use-user-job/dummy.pdf"),
                    }],
                }
            self.respond(200, {"fixture_completed": True})
            return
        if self.path != "/api/v1/jobs":
            self.respond(404, {"detail": "Unknown endpoint"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                raise ValueError("Invalid length")
            data = json.loads(self.rfile.read(size))
            if (data.get("owner_id") != "alice" or
                    data.get("delivery", {}).get("folder") not in
                    {"Downloads", "Downloads/Direct files"}):
                raise ValueError("Unscoped job")
            if not data.get("delivery", {}).get("app_password"):
                raise ValueError("Missing WebDAV password")
        except (ValueError, AttributeError, TypeError):
            self.respond(422, {"detail": "Invalid user-scoped test job"})
            return
        # This fixture never downloads or writes to Nextcloud. It proves
        # that actual Nextcloud's signed per-user Files folder creation
        # succeeded before the job reached the core.
        created = {
            "id": "ci-first-use-user-job", "owner_id": "alice",
            "url": data["url"], "engine": data.get("engine", "generic"),
            "status": "queued", "progress": {"state": "queued"},
            "output_files": [],
            "delivery": {"mode": "webdav", "folder": data["delivery"]["folder"]},
        }
        with _STATE_LOCK:
            _TEST_JOB = created
        self.respond(202, created)

    def _cookie_fixture_name(self) -> str | None:
        if self.headers.get("X-API-Key") != os.environ["MOCK_CORE_TOKEN"]:
            self.respond(401, {"detail": "Not authenticated"})
            return None
        if any(self.headers.get(header) for header in (
            "Authorization", "Cookie", "AUTHORIZATION-APP-API",
        )):
            self.respond(400, {"detail": "Browser credentials reached core"})
            return None
        prefix = "/api/v1/cookies/"
        if not self.path.startswith(prefix) or self.path[len(prefix):] not in _COOKIE_NAMES:
            self.respond(404, {"detail": "Unknown cookie fixture"})
            return None
        return self.path[len(prefix):]

    def do_PUT(self) -> None:
        name = self._cookie_fixture_name()
        if name is None:
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096:
                raise ValueError("Invalid fixture length")
            payload = json.loads(self.rfile.read(size))
            raw = base64.b64decode(payload["content_base64"], validate=True)
            if not raw.startswith(b"# Netscape HTTP Cookie File") or len(raw) > 2048:
                raise ValueError("Invalid synthetic cookie fixture")
        except (ValueError, TypeError, KeyError):
            self.respond(422, {"detail": "Invalid synthetic cookie fixture"})
            return
        record = {"filename": name, "size_bytes": len(raw)}
        # Retain metadata only, never the supplied value.
        with _STATE_LOCK:
            _COOKIE_RECORDS[name] = record
        self.respond(200, record)

    def do_DELETE(self) -> None:
        name = self._cookie_fixture_name()
        if name is None:
            return
        with _STATE_LOCK:
            _COOKIE_RECORDS.pop(name, None)
        self.respond(200, {"deleted": True})

    def respond(self, status: int, data: object) -> None:
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        # No paths, headers, token, or signed URLs appear in CI logs.
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
