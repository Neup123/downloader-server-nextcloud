#!/usr/bin/env python3
"""Reconcile the deployed Nextcloud ExApp with its pullable GHCR digest.

This is a READ-ONLY host acceptance check for the current Docker engine.
It does not run Docker pulls, change containers, inspect secrets or depend on
the Docker image having a native AppAPI @sha256 reference (NC35 lacks it).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

IMAGE_REPO = "ghcr.io/neup123/downloader-server-nextcloud"
COMMIT = re.compile(r"[a-f0-9]{40}\Z")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}\Z")
TAG = re.compile(r"(?:[0-9]+\.[0-9]+\.[0-9]+|sha-[a-f0-9]{40})\Z")


class ImageVerificationError(RuntimeError):
    pass


def image_from_manifest(data: bytes) -> tuple[str, str, str]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ImageVerificationError("Invalid ExApp installation manifest") from exc
    if root.findtext("./id") != "downloader-server-nextcloud":
        raise ImageVerificationError("Unexpected application ID")
    docker = root.find("./external-app/docker-install")
    if docker is None:
        raise ImageVerificationError("Manifest has no Docker installation")
    registry, image, tag = (
        docker.findtext("registry"), docker.findtext("image"),
        docker.findtext("image-tag"),
    )
    if registry != "ghcr.io" or image != "neup123/downloader-server-nextcloud":
        raise ImageVerificationError("Manifest references an unexpected repository")
    if not isinstance(tag, str) or not TAG.fullmatch(tag):
        raise ImageVerificationError("Manifest references an unreviewed image tag")
    version = root.findtext("version") or ""
    return f"{IMAGE_REPO}:{tag}", version, tag


def docker_field(args: list[str]) -> str:
    try:
        result = subprocess.run(["docker"] + args, text=True, capture_output=True,
                                check=False, timeout=25)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ImageVerificationError("Docker inspection unavailable") from exc
    if result.returncode:
        # Never emit Docker's stderr (could disclose host/image details).
        raise ImageVerificationError("Docker inspection failed")
    return result.stdout.strip()


def reconciliation(manifest: bytes, container: str, expected_source: str) -> dict:
    if not COMMIT.fullmatch(expected_source):
        raise ImageVerificationError("Expected source must be 40 lowercase hex digits")
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.-]{0,127}", container):
        raise ImageVerificationError("Invalid ExApp container name")
    image_tag, version, tag = image_from_manifest(manifest)
    if tag.startswith("sha-") and tag[4:] != expected_source:
        raise ImageVerificationError("Manifest SHA tag differs from expected source")
    image_id = docker_field(["image", "inspect", image_tag, "--format", "{{.Id}}"])
    running_id = docker_field(["inspect", container, "--format", "{{.Image}}"])
    if image_id != running_id or not image_id.startswith("sha256:"):
        raise ImageVerificationError("Running ExApp container does not use the manifest image")
    source_sha = docker_field(["image", "inspect", image_tag, "--format",
                              '{{index .Config.Labels "org.opencontainers.image.revision"}}'])
    if source_sha != expected_source:
        raise ImageVerificationError("ExApp source revision label does not match release target")
    digests_raw = docker_field(["image", "inspect", image_tag, "--format",
                                "{{json .RepoDigests}}"])
    try:
        candidates = json.loads(digests_raw)
    except ValueError as exc:
        raise ImageVerificationError("Docker did not return a valid digest list") from exc
    if not isinstance(candidates, list):
        raise ImageVerificationError("Docker digest list is invalid")
    refs = [x for x in candidates if isinstance(x, str) and x.startswith(IMAGE_REPO + "@")]
    if len(refs) != 1 or not DIGEST.fullmatch(refs[0].split("@", 1)[1]):
        raise ImageVerificationError("No unique verifiable GHCR digest for manifest image")

    return {
        "manifest_version": version,
        "manifest_image_tag": image_tag,
        "deployed_image_digest": refs[0],
        "source_commit": source_sha,
        "running_container_matches_manifest_image": True,
        "source_label_matches_expected_release_commit": True,
        "ghcr_digest_recorded": True,
        "appapi_native_digest_pinned": False,
        "target_image_reconciled": True,
        "note": "Actual image identity verified; Nextcloud 35 AppAPI manifest still installs a tag.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path,
                        help="Downloaded info.xml from the exact GitHub release")
    parser.add_argument("--expected-source", required=True,
                        help="40-digit target commit SHA of the GitHub release")
    parser.add_argument("--container", default="nc_app_downloader-server-nextcloud")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(reconciliation(
            args.manifest.read_bytes(), args.container, args.expected_source,
        ), sort_keys=True, indent=2))
        return 0
    except (ImageVerificationError, OSError) as exc:
        print(json.dumps({"target_image_reconciled": False,
                          "reason": (str(exc) if isinstance(exc, ImageVerificationError)
                                     else "Cannot open release manifest")},
                         sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
