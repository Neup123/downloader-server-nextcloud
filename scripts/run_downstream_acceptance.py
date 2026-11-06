"""Run explicitly reviewed Nextcloud-owned test modules during core imports.

The core's COMPLETE test suite is tested in the exact upstream/main worktree.
Upstream-only tests can also already exist in downstream Git history, so neither
filename prefix globs nor the pre-merge HEAD inventory alone establish ownership.

Add each new *downstream* test module to this exact list in the same PR.
The selector verifies every declared module exists in HEAD and the merged tree;
missing coverage fails closed rather than silently skipping tests.
"""
from __future__ import annotations

from pathlib import Path
import subprocess
import sys


DOWNSTREAM_TEST_MODULES = frozenset({
    "tests/test_appapi_deploy_workflow.py",
    "tests/test_appapi_readiness.py",
    "tests/test_audited_preflight_branch_cleanup.py",
    "tests/test_cleanup_equivalent_branches.py",
    "tests/test_cleanup_merged_branches.py",
    "tests/test_exapp_build_inputs.py",
    "tests/test_exapp_publication_workflow.py",
    "tests/test_exapp_release_manifest.py",
    "tests/test_nextcloud_bridge_config.py",
    "tests/test_nextcloud_core_sync_evidence.py",
    "tests/test_nextcloud_merge_preview_workflow.py",
    "tests/test_nextcloud_preflight.py",
    "tests/test_nextcloud_test_inventory.py",
    "tests/test_nextcloud_upstream_conflicts.py",
    "tests/test_nextcloud_upstream_sync.py",
    "tests/test_target_readiness.py",
})


def plan_tests(head_files: set[str], merged_files: set[str]) -> list[str]:
    """Execute only declared downstream tests, rejecting missing or unsafe paths."""
    if not DOWNSTREAM_TEST_MODULES:
        raise RuntimeError("No reviewed downstream tests declared")
    for path in DOWNSTREAM_TEST_MODULES:
        if (
            not path.startswith("tests/test_")
            or not path.endswith(".py")
            or "/" in path[len("tests/"):]
        ):
            raise RuntimeError("Unsafe or non-test downstream test path")
    missing_head = sorted(DOWNSTREAM_TEST_MODULES - head_files)
    if missing_head:
        raise RuntimeError("Declared downstream test missing from HEAD: " + ", ".join(missing_head))
    missing_merged = sorted(DOWNSTREAM_TEST_MODULES - merged_files)
    if missing_merged:
        raise RuntimeError("Downstream test removed by upstream merge: " + ", ".join(missing_merged))
    return sorted(DOWNSTREAM_TEST_MODULES)


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
        path for path in DOWNSTREAM_TEST_MODULES
        if Path(path).is_file() and not Path(path).is_symlink()
    }
    files = plan_tests(committed, merged)
    print(f"Running {len(files)} explicitly reviewed Nextcloud test modules", flush=True)
    return subprocess.call([sys.executable, "-m", "pytest", "-q", *files])


if __name__ == "__main__":
    raise SystemExit(main())
