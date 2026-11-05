#!/usr/bin/env python3
"""Read-only AppAPI readiness probe using Nextcloud's own occ CLI.

No daemon or app is installed, changed, or enabled. Raw output from
app_api:daemon:list is intentionally never printed or saved because daemon
configuration can contain internal hostnames and credentials.

This does NOT perform AppAPI Test Deploy. Test Deploy is a separate, explicit
administrator action, and a successful list command cannot replace it.
"""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from typing import Any, Callable, Sequence


class ReadinessError(RuntimeError):
    pass


def _call_occ(
    command: Sequence[str],
    args: Sequence[str],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> str:
    try:
        result = runner(
            [*command, *args],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReadinessError("Could not execute the read-only Nextcloud occ command") from exc
    if result.returncode:
        # Do not echo stderr/stdout: Nextcloud errors can contain private config.
        raise ReadinessError(f"Nextcloud occ command failed (exit code {result.returncode})")
    return result.stdout


def _read_json(raw: str, command: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ReadinessError(f"{command} did not return valid JSON") from exc
    if not isinstance(value, dict):
        raise ReadinessError(f"{command} must return a JSON object")
    return value


def _enabled_app(apps: dict[str, Any], name: str) -> tuple[bool, str | None]:
    enabled = apps.get("enabled")
    if isinstance(enabled, dict):
        version = enabled.get(name)
        return (name in enabled, str(version) if version is not None else None)
    if isinstance(enabled, list):
        for item in enabled:
            if item == name:
                return True, None
            if isinstance(item, dict) and name in item:
                return True, str(item[name])
    return False, None


def summarize_daemon_registration(raw: str) -> str:
    """Interpret only recognized CLI shapes; never expose daemon configuration.

    A successful command can still mean zero registered daemons. AppAPI emits
    an explicit no-daemon line or a Symfony console table with a Name column.
    An unknown format must not be interpreted as a registered daemon.
    """
    if "no registered daemon configs." in raw.lower():
        return "none"

    rows = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = [part.strip() for part in stripped[1:-1].split("|")]
            rows.append(cells)
    header_index = next(
        (index for index, cells in enumerate(rows)
         if "name" in [cell.lower() for cell in cells]),
        None,
    )
    if header_index is None:
        return "unverified (unrecognized command output)"
    header = rows[header_index]
    count = sum(
        1 for cells in rows[header_index + 1:]
        if len(cells) == len(header) and any(cells)
    )
    return f"present ({count} entries; details withheld)" if count else "none"


def run_readiness(
    occ_command: Sequence[str],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    if not occ_command:
        raise ReadinessError("An occ command is required")
    status = _read_json(
        _call_occ(occ_command, ["status", "--output=json"], runner=runner),
        "occ status",
    )
    if not status.get("installed"):
        raise ReadinessError("The target Nextcloud instance is not installed")

    apps = _read_json(
        _call_occ(occ_command, ["app:list", "--output=json"], runner=runner),
        "occ app:list",
    )
    enabled, version = _enabled_app(apps, "app_api")
    result = {
        "nextcloud": {
            "version": str(status.get("versionstring") or status.get("version") or "unknown"),
            "maintenance": bool(status.get("maintenance", False)),
        },
        "appapi": {"enabled": enabled, "version": version},
        "deploy_daemon": {
            "list_command": "not run (AppAPI is disabled)",
            "registration": "not verified",
            "test_deploy": "not tested; requires an administrator",
        },
        "webdav": "not tested; use scripts/nextcloud_preflight.py separately",
        "exapp_ready": "unverified; requires a successful real Test Deploy",
    }
    if not enabled:
        return result
    try:
        # This is read-only. The content deliberately stays in memory and
        # is not recorded; it may contain internal deploy daemon metadata.
        daemon_output = _call_occ(occ_command, ["app_api:daemon:list"], runner=runner)
    except ReadinessError:
        result["deploy_daemon"]["list_command"] = "failed"
    else:
        result["deploy_daemon"]["list_command"] = "succeeded"
        result["deploy_daemon"]["registration"] = summarize_daemon_registration(daemon_output)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    connection = parser.add_mutually_exclusive_group(required=True)
    connection.add_argument(
        "--container",
        help="Docker container running Nextcloud (e.g. nextcloud-aio-nextcloud)",
    )
    connection.add_argument(
        "--occ-command",
        help="Quoted argv prefix to invoke occ without a shell, e.g. 'php /var/www/html/occ'",
    )
    args = parser.parse_args(argv)
    command = (
        ["docker", "exec", "--user", "www-data", args.container, "php", "occ"]
        if args.container else shlex.split(args.occ_command)
    )
    try:
        report = run_readiness(command)
    except ReadinessError as exc:
        print(f"Readiness check failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
