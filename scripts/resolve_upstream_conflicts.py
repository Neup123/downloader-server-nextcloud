"""Resolve only audited downstream/core merge conflicts.

During CI acceptance, upstream's workflow versions are used so upstream test
contracts can inspect them. Before the resulting merge is committed,
Nextcloud-owned workflows are restored from the downstream branch. Every
unknown conflict stops the synchronization without publishing any changes.
"""
from __future__ import annotations

import subprocess

# Preserve Nextcloud-owned README, branch cleanup and legacy Nextcloud-aware
# standalone UI adapter. The new signed admin page is web/src/AdminApp.tsx;
# core web/src/App.tsx is intentionally *not* the served ExApp admin entrypoint.
# Existing downstream App.tsx still contains Nextcloud-only session/proxy paths
# and must not be overwritten automatically in an unrelated core UI sync.
# Revisit removing that legacy page after native admin browser acceptance.
DOWNSTREAM = frozenset({
    "README.md",
    "web/src/App.tsx",
    "scripts/cleanup_merged_branches.py",
    "tests/test_cleanup_equivalent_branches.py",
})
# Use core CI workflow versions *temporarily* while running the merged core
# test suite, then restore the Nextcloud CI directory before committing.
CORE_TEST_ONLY = frozenset({
    ".github/workflows/live-nextcloud-e2e.yml",
    ".github/workflows/egress-guard-e2e.yml",
    ".github/workflows/manual-p2-site-webdav.yml",
    ".github/workflows/pinned-engine-updates.yml",
    ".github/workflows/safe-merged-branch-cleanup.yml",
})


def plan_conflicts(paths: list[str]) -> dict[str, str]:
    """Return an exact allowlisted resolution plan; reject before modifying any file."""
    if not paths:
        raise ValueError("No unresolved merge paths found")
    unexpected = sorted(set(paths) - DOWNSTREAM - CORE_TEST_ONLY)
    if unexpected:
        raise ValueError("Unexpected upstream merge conflict(s): " + ", ".join(unexpected))
    return {
        path: "ours" if path in DOWNSTREAM else "theirs"
        for path in paths
    }


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args])


def main() -> None:
    # Do not allow this script to operate during ordinary repository operations.
    git("rev-parse", "-q", "--verify", "MERGE_HEAD")
    paths = [
        item.decode("utf-8", "strict")
        for item in git("diff", "--name-only", "--diff-filter=U", "-z").split(bytes([0]))
        if item
    ]
    plan = plan_conflicts(paths)
    for path, side in plan.items():
        # Preserve a deliberate deletion without silently restoring core's copy.
        if side == "ours" and subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:{path}"], check=False,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode != 0:
            subprocess.check_call(["git", "rm", "--force", "--", path])
        else:
            subprocess.check_call(["git", "checkout", f"--{side}", "--", path])
            subprocess.check_call(["git", "add", "--", path])
    if git("ls-files", "-u"):
        raise RuntimeError("Unresolved merge paths remain")
    print("Resolved audited upstream conflicts; downstream workflows restored before commit")


if __name__ == "__main__":
    main()
