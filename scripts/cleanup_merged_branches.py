"""Safely retire GitHub branches whose exact heads are in merged pull requests.

This is conservative: squash-merged heads are eligible only if no new commits
were added after PR merge, no open PR references the branch, and the PR's target
was merged into main. Deletion uses a remote SHA lease; it cannot erase an
unexpected branch update. All other branches are left untouched.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import quote
from urllib.request import Request, urlopen


def list_pages(repository: str, collection: str, token: str) -> list[dict]:
    result: list[dict] = []
    for page in range(1, 21):
        url = (
            f"https://api.github.com/repos/{repository}/{collection}"
            f"{'&' if '?' in collection else '?'}per_page=100&page={page}"
        )
        request = Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urlopen(request, timeout=30) as response:
            batch = json.load(response)
        if not isinstance(batch, list):
            raise ValueError("Unexpected GitHub list response")
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise RuntimeError("Pagination exceeded safety limit; not deleting any branches")


def cleanup_candidates(
    repository: str, branches: list[dict], pulls: list[dict],
) -> list[tuple[str, str]]:
    """Find exact, closed and merged PR heads; never guess from branch names."""
    open_heads: set[str] = set()
    eligible: set[tuple[str, str]] = set()
    phase_integrated = any(
        pr.get("merged_at")
        and pr.get("base", {}).get("ref") == "main"
        and pr.get("head", {}).get("ref") == "phase-1/core-mvp"
        for pr in pulls
    )
    for pr in pulls:
        head = pr.get("head") or {}
        ref = head.get("ref")
        source_repo = (head.get("repo") or {}).get("full_name")
        if not ref or source_repo != repository:
            continue
        if pr.get("state") == "open":
            open_heads.add(ref)
            continue
        base = (pr.get("base") or {}).get("ref")
        if (
            pr.get("merged_at")
            and (base == "main" or (base == "phase-1/core-mvp" and phase_integrated))
            and isinstance(head.get("sha"), str)
        ):
            eligible.add((ref, head["sha"]))
    output: list[tuple[str, str]] = []
    for branch in branches:
        name = branch.get("name")
        sha = (branch.get("commit") or {}).get("sha")
        if (
            name and name != "main" and not branch.get("protected")
            and name not in open_heads and (name, sha) in eligible
        ):
            output.append((name, sha))
    return sorted(output)



def get_json(repository: str, endpoint: str, token: str) -> dict:
    """Fetch GitHub metadata with the same token as the checked-out repository."""
    url = f"https://api.github.com/repos/{repository}/{endpoint}"
    request = Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("Unexpected GitHub object response")
    return payload


def tree_files(tree: dict) -> dict[str, tuple[str, str, str]]:
    """Reject a truncated response; blob content AND file mode must match."""
    if tree.get("truncated") is not False or not isinstance(tree.get("tree"), list):
        raise ValueError("GitHub Git tree was truncated or missing")
    return {
        entry["path"]: (entry["sha"], entry["mode"], entry["type"])
        for entry in tree["tree"] if entry.get("type") in ("blob", "commit")
    }


def same_changed_files(
    comparison: dict, main: dict[str, tuple[str, str, str]],
    branch: dict[str, tuple[str, str, str]],
) -> bool:
    """Proof of *no unique file changes*, even with different squash ancestry.

    The compare endpoint lists differences between the merge base and the
    candidate head. Every one must already match main byte-for-byte and mode-
    for-mode. Never accept incomplete pagination or an absent file listing.
    """
    files = comparison.get("files")
    ahead = comparison.get("ahead_by")
    if (
        comparison.get("status") not in ("ahead", "diverged")
        or not isinstance(ahead, int) or not 0 < ahead < 250
        or not isinstance(files, list) or not files or len(files) >= 250
    ):
        return False
    paths = set()
    for item in files:
        path = item.get("filename")
        if not isinstance(path, str) or not path:
            return False
        paths.add(path)
        if item.get("previous_filename"):
            paths.add(item["previous_filename"])
    return all(main.get(path) == branch.get(path) for path in paths)


def equivalent_branch_candidates(
    repository: str, branches: list[dict], pulls: list[dict],
    token: str, excluded: set[str],
) -> list[tuple[str, str]]:
    """Delete ancestors and exact-content squash duplicates; retain all new work."""
    open_heads = {
        (pr.get("head") or {}).get("ref")
        for pr in pulls if pr.get("state") == "open"
        and ((pr.get("head") or {}).get("repo") or {}).get("full_name") == repository
    }
    main_tree: dict[str, tuple[str, str, str]] | None = None
    candidates = []
    for branch in branches:
        name = branch.get("name")
        sha = (branch.get("commit") or {}).get("sha")
        if (
            not isinstance(name, str) or not isinstance(sha, str)
            or name == "main" or branch.get("protected")
            or name in open_heads or name in excluded
        ):
            continue
        ref = quote(name, safe="")
        comparison = get_json(repository, f"compare/main...{ref}", token)
        # A strict ancestor cannot have unmerged changes.
        if comparison.get("status") in ("behind", "identical") and comparison.get("ahead_by") == 0:
            candidates.append((name, sha))
            continue
        if comparison.get("status") not in ("ahead", "diverged"):
            continue
        if main_tree is None:
            main_tree = tree_files(get_json(repository, "git/trees/main?recursive=1", token))
        branch_tree = tree_files(get_json(repository, f"git/trees/{ref}?recursive=1", token))
        if same_changed_files(comparison, main_tree, branch_tree):
            candidates.append((name, sha))
    return sorted(candidates)


def audited_legacy_candidates(
    branches: list[dict], pulls: list[dict], *, port_verified: bool,
) -> list[tuple[str, str]]:
    """One-off reviewed legacy retirement, protected by an exact Git SHA.

    Issue #16 and PR #25 audit: the old Nextcloud readiness prototype is
    superseded by the tested scripts/ readiness probes and its unique
    auto-detection was ported. Do not turn this into a generic name prefix
    or delete an unexpectedly changed branch.
    """
    if not port_verified:
        return []
    old_name = "feature/read-only-nextcloud-preflight"
    expected_sha = "d5bcdfd5bb4627b6f40233147cea920233ca26a0"
    if any(
        pr.get("state") == "open"
        and (pr.get("head") or {}).get("ref") == old_name
        for pr in pulls
    ):
        return []
    return [
        (old_name, expected_sha)
        for branch in branches
        if branch.get("name") == old_name
        and not branch.get("protected")
        and (branch.get("commit") or {}).get("sha") == expected_sha
    ]


# Issue #199 audit: these exact historical refs are squash-result snapshots of
# the adjacent, merged PR in the old native UI stack. Their own original PR
# head SHAs differ. Never generalize this table to arbitrary closed branches.
_AUDITED_STACK = {
    "fix/108-widget-quick-delivery": ("c2c30779f7f15c509c451288262222bb732b1182", 119),
    "feat/109-compact-dashboard-widget": ("9fa3f8aecadd09975faef0a8049af1531735849c", 120),
    "fix/110-widget-refresh-state": ("64edc487cc936dc601cd51bf97e4a1fa53ae767f", 121),
    "feat/111-native-download-library": ("e13f2a3a362a4f0f5d025cad9914bab4c1ecbd3a", 122),
}
_LANDING_HEAD = "345771534ff0e11f25e8ad9352060b6b567695ea"
_LANDING_MERGE = "c548e6555f09dfac659d276cae72be906e04f601"
_DOCS_REF = "docs/sources-catalog"
_DOCS_SHA = "00a7cc312c92a5c3489bfd8eb6f3a415fb8550e2"


def audited_stack_candidates(
    repository: str, branches: list[dict], pulls: list[dict], token: str,
    excluded: set[str],
) -> list[tuple[str, str]]:
    """Retire only the five reviewed #199 refs, not arbitrary stacked work."""
    if repository != "Neup123/downloader-server-nextcloud":
        return []
    by_number = {pr.get("number"): pr for pr in pulls}
    open_refs = {
        ref.get("ref")
        for pr in pulls if pr.get("state") == "open"
        for ref in (pr.get("head") or {}, pr.get("base") or {})
        if (ref.get("repo") or {}).get("full_name") == repository
    }
    landing = by_number.get(135, {})
    if (
        not landing.get("merged_at")
        or landing.get("merge_commit_sha") != _LANDING_MERGE
        or (landing.get("head") or {}).get("sha") != _LANDING_HEAD
        or (landing.get("base") or {}).get("ref") != "main"
    ):
        return []
    # The landing squash itself must still be part of the current main history.
    if get_json(repository, f"compare/{_LANDING_MERGE}...main", token).get("behind_by") != 0:
        return []
    output = []
    for branch in branches:
        name = branch.get("name")
        sha = (branch.get("commit") or {}).get("sha")
        if name in excluded or name in open_refs or branch.get("protected"):
            continue
        if name == _DOCS_REF and sha == _DOCS_SHA:
            # Human audit 2026-11-24: this closed PR's sole catalog was moved
            # to Core PR #164; all 53 original source URLs and substantive
            # entries are retained, with corrected requirement descriptions.
            old = by_number.get(152, {})
            if (old.get("state") == "closed" and not old.get("merged_at")
                    and (old.get("head") or {}).get("ref") == name
                    and (old.get("head") or {}).get("sha") == sha):
                output.append((name, sha))
            continue
        audit = _AUDITED_STACK.get(name)
        if not audit or sha != audit[0]:
            continue
        pr = by_number.get(audit[1], {})
        head = (pr.get("head") or {}).get("sha")
        if (
            not pr.get("merged_at") or pr.get("merge_commit_sha") != sha
            or (pr.get("base") or {}).get("ref") != name
            or not isinstance(head, str)
        ):
            continue
        # A squash result is eligible only if its full tree (including modes,
        # binary blobs, and submodules) matches the original accepted PR head.
        # The latter must be an ancestor of the actual integrated landing head.
        candidate_tree = get_json(repository, f"git/commits/{sha}", token).get("tree", {}).get("sha")
        original_tree = get_json(repository, f"git/commits/{head}", token).get("tree", {}).get("sha")
        if not candidate_tree or candidate_tree != original_tree:
            continue
        comparison = get_json(repository, f"compare/{head}...{_LANDING_HEAD}", token)
        if comparison.get("behind_by") == 0:
            output.append((name, sha))
    return sorted(output)


def legacy_port_verified() -> bool:
    """Require current files AND the regression suite in checked-out main."""
    root = Path(__file__).resolve().parents[1]
    appapi = root / "scripts/appapi_readiness.py"
    target = root / "scripts/target_readiness.py"
    regression = root / "tests/test_auto_container_detection.py"
    return (
        appapi.is_file() and target.is_file() and regression.is_file()
        and "def detect_nextcloud_container" in appapi.read_text()
        and '"--auto-container"' in appapi.read_text()
        and '"--auto-container"' in target.read_text()
    )



def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Delete eligible refs with a SHA lease")
    parser.add_argument("--prune-equivalent", action="store_true", help="Retire ancestor and identical-file branches, never unique work")
    parser.add_argument("--retire-audited", action="store_true", help="Retire only reviewed, SHA-locked superseded historical refs")
    args = parser.parse_args()
    repository = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    branches = list_pages(repository, "branches", token)
    pulls = list_pages(repository, "pulls?state=all&sort=updated&direction=desc", token)
    candidates = cleanup_candidates(repository, branches, pulls)
    exact = len(candidates)
    if args.prune_equivalent:
        candidates += equivalent_branch_candidates(
            repository, branches, pulls, token, {name for name, _ in candidates}
        )
    equivalent = len(candidates) - exact
    if args.retire_audited:
        candidates += audited_legacy_candidates(
            branches, pulls, port_verified=legacy_port_verified(),
        )
        candidates += audited_stack_candidates(
            repository, branches, pulls, token, {name for name, _ in candidates},
        )
    print(f"Reviewed {len(branches)} branches and {len(pulls)} PRs; "
          f"{exact} exact merged heads, {equivalent} content-equivalent heads "
          f"and {len(candidates) - exact - equivalent} audited legacy heads eligible")
    failures = []
    for name, sha in candidates:
        print(f"{'Deleting' if args.apply else 'Dry run'}: {name} at {sha[:12]}")
        if not args.apply:
            continue
        # This compare-and-swap prevents deleting a newer branch head.
        command = [
            "git", "push", f"--force-with-lease=refs/heads/{name}:{sha}",
            "origin", f":refs/heads/{name}",
        ]
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        if result.returncode:
            failures.append(name)
            print(f"Lease or deletion failed for {name}; branch left intact")
    if failures:
        raise SystemExit(f"Could not delete {len(failures)} branch(es); inspect workflow logs")


if __name__ == "__main__":
    main()
