"""Deterministic disposable test origin for the Nextcloud AppAPI gateway.

Never deploy this fixture as a real core service: it only verifies that the
ExApp forwards a request with its server-side key, not user credentials.
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


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
        if self.path == "/api/v1/jobs":
            self.respond(200, [{"id": "ci-proxy-verified", "status": "queued"}])
        elif self.path == "/api/v1/engines":
            self.respond(200, [{"name": "generic", "installed": True}])
        else:
            self.respond(404, {"detail": "Unknown endpoint"})

    def do_POST(self) -> None:
        if self.headers.get("X-API-Key") != os.environ["MOCK_CORE_TOKEN"]:
            self.respond(401, {"detail": "Not authenticated"})
            return
        if any(self.headers.get(header) for header in (
            "Authorization", "Cookie", "AUTHORIZATION-APP-API",
        )):
            self.respond(400, {"detail": "Browser credentials reached core"})
            return
        if self.path != "/api/v1/jobs":
            self.respond(404, {"detail": "Unknown endpoint"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                raise ValueError("Invalid length")
            data = json.loads(self.rfile.read(size))
            if data.get("owner_id") != "alice" or data.get("delivery", {}).get("folder") != "Downloads":
                raise ValueError("Unscoped job")
            if not data.get("delivery", {}).get("app_password"):
                raise ValueError("Missing WebDAV password")
        except (ValueError, AttributeError, TypeError):
            self.respond(422, {"detail": "Invalid user-scoped test job"})
            return
        # This fixture never downloads or writes to Nextcloud. It proves
        # that actual Nextcloud's signed per-user Files folder creation
        # succeeded before the job reached the core.
        self.respond(202, {
            "id": "ci-first-use-user-job", "owner_id": "alice",
            "status": "queued", "delivery": {"mode": "webdav", "folder": "Downloads"},
        })

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
