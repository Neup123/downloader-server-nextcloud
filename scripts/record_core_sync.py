"""Fail-closed provenance for a tested, actually pushed core-to-Nextcloud merge.

Run only after the merge, upstream Python suite, reviewed downstream suite
and production Docker image build all passed, and HEAD was pushed to main.
Never record a successful source integration from a PR preview or unpushed tip.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess

SHA = re.compile(r"[0-9a-f]{40}\Z")
CORE_REPOSITORY = "Neup123/Media-Downloader-server"
DOWNSTREAM_REPOSITORY = "Neup123/downloader-server-nextcloud"
CORE_OWNED_PATHS = (
    "BLUEPRINT.md", "app", "openapi.yaml", "requirements.txt", "Dockerfile",
    "Dockerfile.egress", "compose.egress.yaml", "scripts/egress_guard.sh",
    "EGRESS_GUARD.md",
)


def validate_record(
    core_sha: str, merged_sha: str, remote_sha: str,
    parents: list[str], *, core_ancestor: bool, core_files_equal: bool,
) -> dict:
    for name, sha in (("upstream", core_sha), ("merged", merged_sha), ("remote main", remote_sha)):
        if SHA.fullmatch(sha) is None:
            raise ValueError(f"Invalid {name} commit SHA")
    if merged_sha != remote_sha:
        raise ValueError("Remote main moved or never received the tested merge")
    if len(parents) != 2 or parents[1] != core_sha:
        raise ValueError("Verified merge must have the exact core SHA as its second parent")
    if not all(SHA.fullmatch(parent) for parent in parents):
        raise ValueError("Merge parent SHA is invalid")
    if not core_ancestor:
        raise ValueError("The fetched core main commit is not an ancestor of the merge")
    if not core_files_equal:
        raise ValueError("A core-owned backend, contract or egress-policy file differs")
    return {
        "schema_version": 1,
        "source_repository": CORE_REPOSITORY,
        "source_commit": core_sha,
        "downstream_repository": DOWNSTREAM_REPOSITORY,
        "downstream_commit": merged_sha,
        "downstream_previous_commit": parents[0],
        "source_is_exact_second_parent": True,
        "source_ancestry_verified": True,
        "core_owned_files_byte_identical": True,
        "core_owned_paths": list(CORE_OWNED_PATHS),
        "acceptance": {
            "full_upstream_python_tests": "passed",
            "reviewed_nextcloud_python_tests": "passed",
            "merged_production_docker_build": "passed",
        },
        "production_nextcloud_target_verified": False,
        "artifact_published_after_accepted_main_push": True,
    }


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def accepted_sync_record() -> dict:
    core = git("rev-parse", "upstream/main")
    merged = git("rev-parse", "HEAD")
    remote_line = git("ls-remote", "origin", "refs/heads/main")
    entries = remote_line.split()
    if len(entries) != 2 or entries[1] != "refs/heads/main":
        raise ValueError("Unable to verify exact remote main reference")
    parents = git("rev-list", "--parents", "-n", "1", "HEAD").split()
    if not parents or parents[0] != merged:
        raise ValueError("Cannot reconstruct merge parent identity")
    source_in_history = subprocess.run(
        ["git", "merge-base", "--is-ancestor", core, merged],
        check=False, capture_output=True, timeout=10,
    ).returncode == 0
    byte_parity = subprocess.run(
        ["git", "diff", "--quiet", core, merged, "--", *CORE_OWNED_PATHS],
        check=False, capture_output=True, timeout=15,
    ).returncode == 0
    return validate_record(
        core, merged, entries[0], parents[1:],
        core_ancestor=source_in_history, core_files_equal=byte_parity,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = accepted_sync_record()
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print("Verified core-to-Nextcloud source merge:", result["source_commit"])
    print("Verified exact downstream main commit:", result["downstream_commit"])


if __name__ == "__main__":
    main()
