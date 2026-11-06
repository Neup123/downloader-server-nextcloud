"""Run only Nextcloud-owned acceptance tests during a shared-history core merge.

The core's COMPLETE test suite runs first in an isolated upstream/main worktree.
The merged worktree includes new core-only tests; do not select those with
prefix globs because some deliberately refer to core-only cleanup/workflows.

The unmerged HEAD tree identifies the reviewed downstream test inventory.
Missing or removed tests cause a failure rather than silently lowering coverage.
"""
from __future__ import annotations

import fnmatch
from pathlib import Path
import subprocess
import sys


DOWNSTREAM_PATTERNS = (
    "tests/test_appapi_*.py",
    "tests/test_audited_*.py",
    "tests/test_cleanup_*.py",
    "tests/test_exapp_*.py",
    "tests/test_nextcloud_*.py",
    "tests/test_target_*.py",
)


def plan_tests(head_files: set[str], merged_files: set[str]) -> list[str]:
    """Select exact reviewed HEAD tests; never import newly merged core tests."""
    if not head_files:
        raise RuntimeError("Downstream HEAD has no test inventory")
    selected: set[str] = set()
    for pattern in DOWNSTREAM_PATTERNS:
        owned = {path for path in head_files if fnmatch.fnmatchcase(path, pattern)}
        if not owned:
            raise RuntimeError(f"No downstream tests match required group: {pattern}")
        selected.update(owned)
    missing = sorted(selected - merged_files)
    if missing:
        raise RuntimeError("Downstream test removed by upstream merge: " + ", ".join(missing))
    if any(
        not path.startswith("tests/") or "/" in path[len("tests/"):]
        for path in selected
    ):
        raise RuntimeError("Downstream test inventory contains an invalid path")
    return sorted(selected)


def tracked_head_files() -> set[str]:
    result = subprocess.check_output([
        "git", "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "tests/"
    ])
    return {
        path.decode("utf-8", "strict")
        for path in result.split(bytes([0]))
        if path
    }


def main() -> int:
    committed = tracked_head_files()
    merged = {
        path for path in committed
        if Path(path).is_file() and not Path(path).is_symlink()
    }
    files = plan_tests(committed, merged)
    print(f"Running {len(files)} reviewed Nextcloud-owned test modules", flush=True)
    return subprocess.call([sys.executable, "-m", "pytest", "-q", *files])


if __name__ == "__main__":
    raise SystemExit(main())
