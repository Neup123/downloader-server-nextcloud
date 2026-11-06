"""Audit exact ExApp build inputs before building or publishing a release.

This records verifiable digests for the base-image references and input locks.
Pinned *versions* are not the same as artifact hash-locked wheel installs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

BASE = re.compile(r"^FROM (node:22-alpine|python:3\.13-slim-trixie)@sha256:([0-9a-f]{64}) AS (web-build|runtime)$", re.M)
PIN = re.compile(r"^([a-zA-Z0-9_.-]+)(\[[a-zA-Z0-9_.,-]+\])?==([0-9][a-zA-Z0-9._+!-]*)$")
SOURCE = re.compile(r"[0-9a-f]{40}\Z")


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_pin_file(source: str) -> dict[str, tuple[str, str]]:
    pins: dict[str, tuple[str, str]] = {}
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = PIN.fullmatch(line)
        if not match:
            raise ValueError("ExApp dependencies must use exact PEP 440 version pins")
        name, extras, version = match.groups()
        key = normalized(name)
        if key in pins:
            raise ValueError("Duplicate ExApp dependency name in lock")
        pins[key] = (version, extras or "")
    if not pins:
        raise ValueError("Empty ExApp package lock")
    return pins


def prepare_build_inputs(root: Path, source_sha: str) -> dict:
    if not SOURCE.fullmatch(source_sha):
        raise ValueError("Source SHA must be exactly 40 lowercase hex characters")
    dockerfile = (root / "nextcloud_exapp/Dockerfile").read_bytes()
    docker_text = dockerfile.decode("utf-8")
    bases = {stage: (name, digest) for name, digest, stage in BASE.findall(docker_text)}
    if set(bases) != {"web-build", "runtime"} or docker_text.count("FROM ") != 2:
        raise ValueError("Both ExApp build stages must use known digest-pinned images")
    if "pip install --no-cache-dir --only-binary=:all: -r /app/requirements.lock" not in docker_text:
        raise ValueError("ExApp runtime must install wheels using exact version lock")
    if "npm ci --no-audit --no-fund" not in docker_text:
        raise ValueError("ExApp Node dependencies must use npm ci with package-lock")
    if "COPY nextcloud_exapp/requirements.lock /app/requirements.lock" not in docker_text:
        raise ValueError("ExApp Docker build must install the reviewed Python lock")

    direct_path = root / "nextcloud_exapp/requirements.txt"
    lock_path = root / "nextcloud_exapp/requirements.lock"
    direct = parse_pin_file(direct_path.read_text())
    pinned = parse_pin_file(lock_path.read_text())
    for name, entry in direct.items():
        if pinned.get(name) != entry:
            raise ValueError("ExApp direct dependency differs from locked version or extras")
    if len(pinned) < len(direct):
        raise ValueError("Incomplete ExApp dependency lock")
    node_path = root / "web/package-lock.json"
    if not node_path.is_file():
        raise ValueError("Missing npm package-lock.json")

    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    return {
        "source_commit": source_sha,
        "base_images": {stage: f"docker.io/library/{name}@sha256:{value}" for stage, (name, value) in sorted(bases.items())},
        "dockerfile_sha256": hashlib.sha256(dockerfile).hexdigest(),
        "python_lock_sha256": digest(lock_path),
        "npm_lock_sha256": digest(node_path),
        "python_dependency_count": len(pinned),
        "base_images_digest_pinned": True,
        "python_versions_fully_pinned": True,
        "python_wheel_hashes_verified": False,
        "native_appapi_manifest_digest_pinned": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    record = prepare_build_inputs(args.root, args.source_sha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(record, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print(f"Audited {record['python_dependency_count']} locked Python dependencies and two OCI base images")


if __name__ == "__main__":
    main()
