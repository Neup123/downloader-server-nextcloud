#!/usr/bin/env python3
"""Run existing read-only AppAPI and WebDAV target checks in one safe report.

Invoke as: python -m scripts.target_readiness ...
This script cannot perform or infer AppAPI Test Deploy. A real administrator
must still run that operation on the actual Nextcloud instance.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shlex
import sys
from typing import Any, Sequence

from scripts.appapi_readiness import ReadinessError, detect_nextcloud_container, run_readiness
from scripts.nextcloud_preflight import PreflightClient, PreflightError, run_preflight


def collect_target_report(
    occ_command: Sequence[str],
    client: PreflightClient,
    *,
    folder: str = "",
    write_test: bool = False,
) -> dict[str, Any]:
    """Compose the existing host and WebDAV probes without changing AppAPI."""
    appapi = run_readiness(occ_command)
    webdav = run_preflight(client, folder=folder, write_test=write_test)
    occ_version = appapi["nextcloud"]["version"]
    http_version = webdav["nextcloud"]["version"]
    if occ_version != http_version:
        raise ReadinessError("occ and WebDAV URL refer to different Nextcloud versions")
    maintenance = (
        appapi["nextcloud"]["maintenance"]
        or webdav["nextcloud"]["maintenance"]
    )
    return {
        "nextcloud": appapi["nextcloud"],
        "appapi": appapi["appapi"],
        "deploy_daemon": appapi["deploy_daemon"],
        "webdav": {
            "destination_folder": webdav["destination_folder"],
            "read": webdav["webdav_read"],
            "write": webdav["webdav_write"],
        },
        "release_gate": {
            "production_maintenance": bool(maintenance),
            "webdav_delivery": (
                "verified on actual target" if isinstance(webdav["webdav_write"], dict)
                and webdav["webdav_write"].get("sha256_verified") is True
                and webdav["webdav_write"].get("cleaned_up") is True
                else "not verified; explicit --write-test required"
            ),
            "appapi_test_deploy": "not verified; administrator Test Deploy required",
            "exapp_ready": "unverified; no ExApp deployment authorized by this report",
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--container", help="Actual Nextcloud Docker container name")
    choice.add_argument("--occ-command", help="Quoted command prefix for executing Nextcloud occ without a shell")
    choice.add_argument("--auto-container", action="store_true", help="Discover exactly one running Nextcloud application container; never guess between multiple instances")
    parser.add_argument("--url", required=True, help="Target Nextcloud HTTPS origin including subpath if applicable")
    parser.add_argument("--username", required=True, help="Target WebDAV user; password is requested securely")
    parser.add_argument("--folder", default="", help="Existing destination folder relative to user's Files root")
    parser.add_argument("--allow-http", action="store_true", help="Use only on isolated disposable development instances")
    parser.add_argument("--write-test", action="store_true", help="Explicitly upload, read back and remove a temporary WebDAV file")
    args = parser.parse_args(argv)

    try:
        container = detect_nextcloud_container() if args.auto_container else args.container
        command = (
            ["docker", "exec", "--user", "www-data", container, "php", "occ"]
            if container else shlex.split(args.occ_command)
        )
        password = os.environ.get("NEXTCLOUD_APP_PASSWORD") or getpass.getpass("Nextcloud app password: ")
        client = PreflightClient(args.url, args.username, password, allow_http=args.allow_http)
        report = collect_target_report(command, client, folder=args.folder, write_test=args.write_test)
    except (PreflightError, ReadinessError, ValueError) as exc:
        # Both underlying probes sanitize errors and avoid raw daemon output.
        print(f"Target verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
