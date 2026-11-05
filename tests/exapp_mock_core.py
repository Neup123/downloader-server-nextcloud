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
        if self.path == "/api/v1/jobs":
            self.respond(200, [{"id": "ci-proxy-verified", "status": "queued"}])
        elif self.path == "/api/v1/engines":
            self.respond(200, [{"name": "generic", "installed": True}])
        else:
            self.respond(404, {"detail": "Unknown endpoint"})

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
