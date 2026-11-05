#!/usr/bin/env python3
"""Read-only Nextcloud readiness probe with an opt-in disposable WebDAV write test.

No credentials are stored on disk or printed. AppAPI/Deploy Daemon checks require
Nextcloud administrator access and are deliberately not inferred from WebDAV.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import secrets
import ssl
import sys
import xml.etree.ElementTree as ET
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class PreflightError(RuntimeError):
    """A targeted Nextcloud readiness check failed."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def parse_dav_length(payload: bytes, target_url: str) -> int:
    """Verify one successful DAV:getcontentlength for the exact upload target.

    HTTP 207 is a collection of resource responses and per-property statuses:
    a matching size for another file, or a 404 propstat, proves nothing.
    """
    if len(payload) > 1_000_000:
        raise PreflightError("WebDAV metadata response is unexpectedly large")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise PreflightError("Nextcloud returned malformed WebDAV XML") from exc
    dav = "{DAV:}"
    if root.tag != dav + "multistatus":
        raise PreflightError("Nextcloud returned an unexpected WebDAV XML root")

    expected = urlsplit(target_url)
    sizes: list[int] = []
    for response in root.findall(dav + "response"):
        href = response.findtext(dav + "href")
        if not href:
            continue
        located = urlsplit(urljoin(target_url, href.strip()))
        if (located.scheme != expected.scheme or located.netloc != expected.netloc
                or unquote(located.path) != unquote(expected.path)
                or located.query or located.fragment):
            continue
        for propstat in response.findall(dav + "propstat"):
            status = (propstat.findtext(dav + "status") or "").strip().split()
            if len(status) < 2 or not status[0].startswith("HTTP/") or status[1] != "200":
                continue
            prop = propstat.find(dav + "prop")
            text = prop.findtext(dav + "getcontentlength") if prop is not None else None
            if text is None:
                continue
            try:
                size = int(text)
            except ValueError:
                continue
            if size >= 0:
                sizes.append(size)
    if len(sizes) != 1:
        raise PreflightError("No unambiguous successful WebDAV content-length for the uploaded file")
    return sizes[0]


def validate_dav_collection(payload: bytes, target_url: str) -> None:
    """Require a successful DAV:resourcetype collection for the actual folder.

    The HTTP 207 transport status is not enough: even a missing folder or
    a failed property can appear inside a Multi-Status response.
    """
    if len(payload) > 1_000_000:
        raise PreflightError("WebDAV folder metadata response is unexpectedly large")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise PreflightError("Nextcloud returned malformed folder metadata") from exc
    dav = "{DAV:}"
    if root.tag != dav + "multistatus":
        raise PreflightError("Nextcloud returned an unexpected WebDAV folder response")
    expected = urlsplit(target_url)
    successful = 0
    for response in root.findall(dav + "response"):
        href = response.findtext(dav + "href")
        if not href:
            continue
        located = urlsplit(urljoin(target_url, href.strip()))
        if (located.scheme != expected.scheme or located.netloc != expected.netloc
                or unquote(located.path).rstrip("/") != unquote(expected.path).rstrip("/")
                or located.query or located.fragment):
            continue
        for propstat in response.findall(dav + "propstat"):
            status = (propstat.findtext(dav + "status") or "").strip().split()
            if len(status) < 2 or not status[0].startswith("HTTP/") or status[1] != "200":
                continue
            prop = propstat.find(dav + "prop")
            if prop is not None and prop.find(dav + "resourcetype/" + dav + "collection") is not None:
                successful += 1
    if successful != 1:
        raise PreflightError("The requested WebDAV destination is not a verified accessible collection")


def validate_folder(folder: str) -> list[str]:
    if not folder:
        return []
    parts = folder.split("/")
    if any(not p or p in (".", "..") or "\x00" in p or "\\" in p for p in parts):
        raise PreflightError("Folder must be a slash-separated path with no empty or dot segments")
    return parts


class PreflightClient:
    def __init__(self, base_url: str, username: str, password: str, *, allow_http: bool = False):
        parsed = urlsplit(base_url)
        if (parsed.scheme != "https" and not (allow_http and parsed.scheme == "http")) or not parsed.netloc:
            raise PreflightError("Use an absolute HTTPS Nextcloud URL (or explicitly --allow-http for development)")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise PreflightError("Nextcloud URL must not contain credentials, query, or fragment")
        if not username or not password:
            raise PreflightError("Username and app password are required")
        self.base_url = base_url.rstrip("/")
        self.dav_url = self.base_url + "/remote.php/dav/files/" + quote(username, safe="")
        token = base64.b64encode((username + ":" + password).encode("utf-8")).decode("ascii")
        self._auth = "Basic " + token
        self._opener = build_opener(NoRedirects())

    def request(self, method: str, url: str, *, body: bytes | None = None, authenticated: bool = True,
                headers: dict[str, str] | None = None, expected: tuple[int, ...] = (200,)) -> bytes:
        req_headers = dict(headers or {})
        if authenticated:
            req_headers["Authorization"] = self._auth
        request = Request(url, data=body, headers=req_headers, method=method)
        try:
            with self._opener.open(request, timeout=20) as response:
                if response.status not in expected:
                    raise PreflightError(f"{method} returned unexpected HTTP {response.status}")
                return response.read()
        except HTTPError as exc:
            raise PreflightError(f"{method} returned HTTP {exc.code}; verify URL, app password, and permissions") from exc
        except (URLError, TimeoutError, ssl.SSLError) as exc:
            raise PreflightError(f"{method} could not reach the Nextcloud server") from exc

    def status(self) -> dict:
        raw = self.request("GET", self.base_url + "/status.php", authenticated=False)
        try:
            status = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as exc:
            raise PreflightError("status.php did not return JSON") from exc
        if not isinstance(status, dict) or not status.get("installed"):
            raise PreflightError("Nextcloud status.php does not report an installed instance")
        return {
            "version": status.get("versionstring") or status.get("version") or "unknown",
            "maintenance": bool(status.get("maintenance")),
        }

    def propfind(self, url: str, *, collection: bool = False) -> bytes:
        property_name = "resourcetype" if collection else "getcontentlength"
        body = (
            '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop>'
            f'<d:{property_name}/></d:prop></d:propfind>'
        ).encode("utf-8")
        return self.request(
            "PROPFIND", url, body=body,
            headers={"Depth": "0", "Content-Type": "application/xml"},
            expected=(207,),
        )

    def verify_read_access(self, folder: str = "") -> str:
        target = self.dav_url + "".join("/" + quote(part, safe="") for part in validate_folder(folder))
        validate_dav_collection(self.propfind(target, collection=True), target)
        return target

    def verify_write(self, parent_url: str) -> dict:
        """Write, read, verify, and clean up a uniquely named disposable DAV folder."""
        nonce = secrets.token_hex(8)
        folder = parent_url.rstrip("/") + "/.downloader-preflight-" + nonce
        file_url = folder + "/probe.bin"
        payload = ("downloader-preflight:" + nonce).encode("ascii")
        created = False
        uploaded = False
        try:
            self.request("MKCOL", folder, expected=(201,))
            created = True
            self.request("PUT", file_url, body=payload, expected=(200, 201, 204))
            uploaded = True
            size = parse_dav_length(self.propfind(file_url), file_url)
            if size != len(payload):
                raise PreflightError(f"WebDAV size mismatch: expected {len(payload)}, received {size}")
            actual = self.request("GET", file_url)
            if hashlib.sha256(actual).digest() != hashlib.sha256(payload).digest():
                raise PreflightError("WebDAV download checksum did not match uploaded data")
            return {"size_bytes": size, "sha256_verified": True, "cleaned_up": True}
        finally:
            errors = []
            if uploaded:
                try:
                    self.request("DELETE", file_url, expected=(200, 204))
                except PreflightError as exc:
                    errors.append(str(exc))
            if created:
                try:
                    self.request("DELETE", folder, expected=(200, 204))
                except PreflightError as exc:
                    errors.append(str(exc))
            if errors:
                raise PreflightError("Temporary WebDAV probe cleanup failed: " + "; ".join(errors))


def run_preflight(client: PreflightClient, *, folder: str = "", write_test: bool = False) -> dict:
    status = client.status()
    target = client.verify_read_access(folder)
    result = {
        "nextcloud": status,
        "webdav_read": "passed",
        "destination_folder": folder or "(user root)",
        "webdav_write": "not tested",
        "appapi_and_deploy_daemon": "not tested; requires administrator checks",
    }
    if write_test:
        result["webdav_write"] = client.verify_write(target)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Nextcloud server origin, including subpath if applicable")
    parser.add_argument("--username", required=True, help="Nextcloud username for WebDAV")
    parser.add_argument("--folder", default="", help="Existing destination folder relative to the user's Files root")
    parser.add_argument("--write-test", action="store_true", help="Create, verify and delete a temporary test file")
    parser.add_argument("--allow-http", action="store_true", help="Allow insecure HTTP only in controlled development")
    args = parser.parse_args(argv)
    password = os.environ.get("NEXTCLOUD_APP_PASSWORD") or getpass.getpass("Nextcloud app password: ")
    try:
        client = PreflightClient(args.url, args.username, password, allow_http=args.allow_http)
        report = run_preflight(client, folder=args.folder, write_test=args.write_test)
        print(json.dumps(report, indent=2))
        return 0
    except (PreflightError, ValueError) as exc:
        print(f"Preflight failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
