#!/usr/bin/env python3
"""Prepare a reviewed, artifact-hash-locked wheel requirements file for ExApp.

This generator is for explicit dependency-update reviews, not image builds.
The Docker build must use the checked-in result with --require-hashes; it
must NEVER fetch mutable hashes at build time or silently trust new files.
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

PIN = re.compile(r"([A-Za-z0-9_.-]+)(\[[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*\])?==([0-9][A-Za-z0-9._+!-]*)\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def parse_pins(source: str) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for raw in source.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = PIN.fullmatch(line)
        if match is None:
            raise ValueError("Expected exact package==version pins, no source URLs or ranges")
        name, extras, version = match.groups()
        identity = re.sub(r"[-_.]+", "-", name).lower()
        if identity in seen:
            raise ValueError("Duplicate Python distribution in lock")
        seen.add(identity)
        result.append((name, extras or "", version))
    if not result:
        raise ValueError("No pinned distributions")
    return result


def wheel_hashes(release: dict) -> list[str]:
    entries = release.get("urls")
    if not isinstance(entries, list):
        raise ValueError("Missing release artifact list")
    hashes: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid release artifact")
        if entry.get("packagetype") != "bdist_wheel" or entry.get("yanked"):
            continue
        digest = (entry.get("digests") or {}).get("sha256")
        if not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise ValueError("Wheel missing valid SHA-256 from PyPI release metadata")
        if not str(entry.get("filename", "")).endswith(".whl"):
            raise ValueError("Wheel artifact filename was not a .whl")
        hashes.add(digest)
    if not hashes:
        raise ValueError("A pinned package has no eligible prebuilt wheels")
    return sorted(hashes)


def fetch_release(name: str, version: str) -> dict:
    url = "https://pypi.org/pypi/" + quote(name, safe="") + "/" + quote(version, safe="") + "/json"
    for attempt in range(3):
        try:
            request = Request(url, headers={"Accept": "application/json", "User-Agent": "downloader-exapp-reviewed-lock/1"})
            with urlopen(request, timeout=25) as response:
                data = json.load(response)
            if not isinstance(data, dict):
                raise ValueError("Invalid PyPI release response")
            return data
        except (HTTPError, URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError("Could not retrieve package release")


def render_hash_lock(pins: list[tuple[str, str, str]], fetch=fetch_release) -> str:
    lines = [
        "# Generated from nextcloud_exapp/requirements.lock using scripts/exapp_wheel_hashes.py.",
        "# Review this file in Git; never retrieve artifact hashes during a production build.",
        "# Wheel files only. Every accepted wheel artifact SHA-256 comes from pinned PyPI release metadata.",
    ]
    for name, extras, version in pins:
        digests = wheel_hashes(fetch(name, version))
        lines.append(f"{name}{extras}=={version} \\")
        for i, digest in enumerate(digests):
            suffix = " \\" if i < len(digests) - 1 else ""
            lines.append(f"    --hash=sha256:{digest}{suffix}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("nextcloud_exapp/requirements.lock"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pins = parse_pins(args.source.read_text(encoding="utf-8"))
    output = render_hash_lock(pins)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8")
    print(f"Resolved {len(pins)} exact pinned distributions to reviewed wheel SHA-256 candidates")


if __name__ == "__main__":
    main()
