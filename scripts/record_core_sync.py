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
        "shared_core_ui": "all upstream web/src source files except intentional web/src/App.tsx",
        "acceptance": {
            "full_upstream_python_tests": "passed",
            "reviewed_nextcloud_python_tests": "passed",
            "merged_production_docker_build": "passed",
        },
        "production_nextcloud_target_verified": False,
        "artifact_published_after_accepted_main_push": True,
    }


def validate_revalidation_record(
    core_sha: str, main_sha: str, remote_sha: str,
    *, core_ancestor: bool, core_files_equal: bool,
) -> dict:
    """A later main tip is not a two-parent core merge; never claim it is."""
    for name, sha in (("upstream", core_sha), ("current main", main_sha), ("remote main", remote_sha)):
        if SHA.fullmatch(sha) is None:
            raise ValueError(f"Invalid {name} commit SHA")
    if main_sha != remote_sha:
        raise ValueError("Remote main changed since the tested source revision")
    if not core_ancestor:
        raise ValueError("Current main does not contain the exact fetched core source")
    if not core_files_equal:
        raise ValueError("Current main contains divergent core-owned backend files")
    return {
        "schema_version": 1,
        "record_type": "revalidated-current-main; NOT a new core merge",
        "source_repository": CORE_REPOSITORY,
        "source_commit": core_sha,
        "downstream_repository": DOWNSTREAM_REPOSITORY,
        "downstream_commit": main_sha,
        "source_is_exact_second_parent": False,
        "source_ancestry_verified": True,
        "core_owned_files_byte_identical": True,
        "core_owned_paths": list(CORE_OWNED_PATHS),
        "shared_core_ui": "all upstream web/src source files except intentional web/src/App.tsx",
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


# B's legacy App.tsx includes Nextcloud session/proxy behavior and is an
# intentionally separate adapter; its signed user/admin entrypoints are
# UserApp.tsx and AdminApp.tsx. Every other file Core owns in web/src must
# remain byte-identical in the downstream merge.
INTENTIONAL_WEB_DIVERGENCE = "web/src/App.tsx"


def core_shared_web_paths(core_sha: str) -> tuple[str, ...]:
    """Enumerate upstream-owned UI files dynamically; include newly added ones."""
    if SHA.fullmatch(core_sha) is None:
        raise ValueError("Core source revision is not a SHA")
    items = tuple(git("ls-tree", "-r", "--name-only", core_sha, "--", "web/src").splitlines())
    if INTENTIONAL_WEB_DIVERGENCE not in items or len(items) < 2:
        raise ValueError("Core UI ownership inventory is missing or truncated")
    if len(set(items)) != len(items) or any(
        not item.startswith("web/src/") or item.startswith("-")
        for item in items
    ):
        raise ValueError("Invalid Core UI inventory")
    return tuple(item for item in items if item != INTENTIONAL_WEB_DIVERGENCE)


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
        ["git", "diff", "--quiet", core, merged, "--", *CORE_OWNED_PATHS, *core_shared_web_paths(core)],
        check=False, capture_output=True, timeout=15,
    ).returncode == 0
    return validate_record(
        core, merged, entries[0], parents[1:],
        core_ancestor=source_in_history, core_files_equal=byte_parity,
    )


def accepted_main_revalidation_record() -> dict:
    """Recheck HEAD (which may be a squash commit), after all acceptance gates."""
    core = git("rev-parse", "upstream/main")
    current = git("rev-parse", "HEAD")
    remote_line = git("ls-remote", "origin", "refs/heads/main")
    entries = remote_line.split()
    if len(entries) != 2 or entries[1] != "refs/heads/main":
        raise ValueError("Unable to verify exact current remote main reference")
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", core, current],
        check=False, capture_output=True, timeout=10,
    ).returncode == 0
    parity = subprocess.run(
        ["git", "diff", "--quiet", core, current, "--", *CORE_OWNED_PATHS, *core_shared_web_paths(core)],
        check=False, capture_output=True, timeout=15,
    ).returncode == 0
    return validate_revalidation_record(
        core, current, entries[0],
        core_ancestor=ancestry, core_files_equal=parity,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--revalidate-existing-main", action="store_true",
        help="Prove previously imported core source on today's accepted main; do not claim a new merge",
    )
    args = parser.parse_args()
    result = (
        accepted_main_revalidation_record()
        if args.revalidate_existing_main
        else accepted_sync_record()
    )
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    print("Verified core source:", result["source_commit"])
    print("Verified exact downstream main commit:", result["downstream_commit"])
    if args.revalidate_existing_main:
        print("Source revalidation only; no new core merge was performed")


if __name__ == "__main__":
    main()
