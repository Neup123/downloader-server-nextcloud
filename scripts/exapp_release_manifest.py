"""Generate an AppAPI-compatible commit-tag manifest with OCI digest provenance.

AppAPI's docker-install backend currently forms "registry/image:tag"; the XML
manifest itself CANNOT refer to OCI @sha256 digests. The separately recorded
OCI digest is the exact pull-by-digest reference for deployment auditing.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET


REGISTRY = "ghcr.io"
IMAGE = "neup123/downloader-server-nextcloud"
GIT_SHA_PATTERN = re.compile(r"[a-f0-9]{40}\Z")
DIGEST_PATTERN = re.compile(r"sha256:[a-f0-9]{64}\Z")


def render_release(
    template: bytes, source_sha: str, digest: str
) -> tuple[bytes, dict[str, str | bool]]:
    """Return an AppAPI XML manifest and digest-auditable release record."""
    if not isinstance(source_sha, str) or not GIT_SHA_PATTERN.fullmatch(source_sha):
        raise ValueError("Source commit must be a full lowercase 40-character Git SHA")
    if not isinstance(digest, str) or not DIGEST_PATTERN.fullmatch(digest):
        raise ValueError("OCI image digest must be sha256 plus 64 lowercase hex characters")
    root = ET.fromstring(template)
    docker = root.find("./external-app/docker-install")
    if docker is None:
        raise ValueError("Manifest must declare a Docker-installed ExApp")
    if (
        docker.findtext("registry") != REGISTRY
        or docker.findtext("image") != IMAGE
        or docker.findtext("image-tag") != "0.1.0-dev"
    ):
        raise ValueError("Manifest registry, image or development tag changed unexpectedly")
    if root.findtext("id") != "downloader-server-nextcloud":
        raise ValueError("Unexpected Nextcloud application ID")
    dependencies = root.find("dependencies/nextcloud")
    if dependencies is None or dependencies.get("min-version") != "35" or dependencies.get("max-version") != "35":
        raise ValueError("Unsupported or unreviewed Nextcloud version range")
    routes = root.findall("./external-app/routes/route")
    if not routes or any(r.findtext("access_level") != "ADMIN" for r in routes):
        raise ValueError("A Nextcloud route is not administrator-only")
    tag = f"sha-{source_sha}"
    docker.find("image-tag").text = tag
    ET.indent(root, space="    ")
    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return xml_bytes, {
        "source_commit": source_sha,
        "container_image_tag": f"{REGISTRY}/{IMAGE}:{tag}",
        "container_image_digest": f"{REGISTRY}/{IMAGE}@{digest}",
        "appapi_manifest_image_tag": tag,
        "appapi_manifest_sha256": sha256(xml_bytes).hexdigest(),
        "appapi_manifest_digest_pinned": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--manifest", type=Path, default=Path("appinfo/info.xml"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    xml_bytes, record = render_release(
        args.manifest.read_bytes(), args.source_sha, args.digest
    )
    # Prevent any partially created release artifacts on failed validation.
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "info.xml").write_bytes(xml_bytes)
    (args.output / "image-provenance.json").write_text(
        json.dumps(record, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Prepared ExApp manifest for {record['source_commit']}")
    print(f"OCI digest reference: {record['container_image_digest']}")
    print("AppAPI XML uses a source-commit tag, NOT a native digest reference.")


if __name__ == "__main__":
    main()
