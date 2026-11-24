from __future__ import annotations

from scripts.cleanup_merged_branches import cleanup_candidates


REPO = "Neup123/Media-Downloader-server"


def pr(ref, sha, *, base="phase-1/core-mvp", merged=True, state="closed", repo=REPO):
    return {
        "head": {"ref": ref, "sha": sha, "repo": {"full_name": repo}},
        "base": {"ref": base},
        "state": state,
        "merged_at": "2026-11-05T20:00:00Z" if merged else None,
    }


def branch(name, sha, protected=False):
    return {"name": name, "commit": {"sha": sha}, "protected": protected}


def test_only_exact_merged_heads_on_integrated_base_are_removed():
    branches = [
        branch("main", "main"), branch("phase-1/core-mvp", "phase"),
        branch("feature/merged", "head"), branch("feature/changed-after-merge", "new"),
        branch("feature/active-pr", "active"), branch("feature/unmerged", "unmerged"),
        branch("feature/fork-same-name", "fork"), branch("feature/protected", "guard", True),
        branch("feature/no-pr", "nopull"),
    ]
    pulls = [
        pr("phase-1/core-mvp", "phase", base="main"),
        pr("feature/merged", "head"),
        pr("feature/changed-after-merge", "old"),
        pr("feature/active-pr", "active", state="open", merged=False),
        pr("feature/unmerged", "unmerged", merged=False),
        pr("feature/fork-same-name", "fork", repo="another-user/fork"),
        pr("feature/protected", "guard"),
    ]
    assert cleanup_candidates(REPO, branches, pulls) == [
        ("feature/merged", "head"), ("phase-1/core-mvp", "phase"),
    ]


def test_phase_branches_not_eligible_until_phase_is_merged_into_main():
    pulls = [pr("feature/merged", "head")]
    assert cleanup_candidates(REPO, [branch("feature/merged", "head")], pulls) == []


def test_an_open_pr_blocks_deleting_same_head_even_with_old_merged_pr():
    pulls = [pr("feature/active", "head", base="main"),
             pr("feature/active", "head", base="main", merged=False, state="open")]
    assert cleanup_candidates(REPO, [branch("feature/active", "head")], pulls) == []


def test_cleanup_requires_mutable_branch():
    pulls = [pr("feature/review", "head", base="main")]
    assert cleanup_candidates(REPO, [branch("feature/review", "head", protected=True)], pulls) == []


def test_issue_199_stacked_cleanup_requires_exact_snapshot_and_landing(monkeypatch):
    import scripts.cleanup_merged_branches as cleanup
    repo = "Neup123/downloader-server-nextcloud"
    name = "fix/108-widget-quick-delivery"
    sha, number = cleanup._AUDITED_STACK[name]
    original = "accepted-original-head"
    landing = {
        "number": 135, "merged_at": "2026-11-10T00:00:00Z",
        "merge_commit_sha": cleanup._LANDING_MERGE,
        "head": {"sha": cleanup._LANDING_HEAD}, "base": {"ref": "main"},
    }
    merged = {
        "number": number, "merged_at": "2026-11-10T00:00:00Z",
        "merge_commit_sha": sha, "head": {"sha": original},
        "base": {"ref": name},
    }
    responses = {
        f"compare/{cleanup._LANDING_MERGE}...main": {"behind_by": 0},
        f"git/commits/{sha}": {"tree": {"sha": "same"}},
        f"git/commits/{original}": {"tree": {"sha": "same"}},
        f"compare/{original}...{cleanup._LANDING_HEAD}": {"behind_by": 0},
    }
    monkeypatch.setattr(cleanup, "get_json", lambda repo, endpoint, token: responses[endpoint])
    pulls = [landing, merged]
    check = lambda branches, prs=pulls, excluded=set(): cleanup.audited_stack_candidates(
        repo, branches, prs, "unused", excluded,
    )
    assert check([branch(name, sha)]) == [(name, sha)]
    assert not check([branch(name, "unexpected")])
    assert not check([branch(name, sha, protected=True)])
    assert not check([branch(name, sha)], excluded={name})
    assert not check([branch(name, sha)], prs=[landing, merged, {
        "state": "open", "base": {"ref": name, "repo": {"full_name": repo}},
    }])
    responses[f"git/commits/{original}"]["tree"]["sha"] = "different"
    assert not check([branch(name, sha)])
    responses[f"git/commits/{original}"]["tree"]["sha"] = "same"
    responses[f"compare/{original}...{cleanup._LANDING_HEAD}"]["behind_by"] = 1
    assert not check([branch(name, sha)])
    responses[f"compare/{original}...{cleanup._LANDING_HEAD}"]["behind_by"] = 0
    responses[f"compare/{cleanup._LANDING_MERGE}...main"]["behind_by"] = 1
    assert not check([branch(name, sha)])


def test_issue_199_docs_retirement_is_reviewed_exact_closed_pr_only(monkeypatch):
    import scripts.cleanup_merged_branches as cleanup
    repo = "Neup123/downloader-server-nextcloud"
    landing = {
        "number": 135, "merged_at": "2026-11-10T00:00:00Z",
        "merge_commit_sha": cleanup._LANDING_MERGE,
        "head": {"sha": cleanup._LANDING_HEAD}, "base": {"ref": "main"},
    }
    old = {"number": 152, "state": "closed",
           "head": {"ref": cleanup._DOCS_REF, "sha": cleanup._DOCS_SHA}}
    monkeypatch.setattr(cleanup, "get_json", lambda *args: {"behind_by": 0})
    rows = [branch(cleanup._DOCS_REF, cleanup._DOCS_SHA)]
    assert cleanup.audited_stack_candidates(repo, rows, [landing, old], "unused", set()) == [
        (cleanup._DOCS_REF, cleanup._DOCS_SHA)]
    assert not cleanup.audited_stack_candidates(repo, rows, [landing], "unused", set())
    assert not cleanup.audited_stack_candidates(repo, [branch(cleanup._DOCS_REF, "new")],
                                                [landing, old], "unused", set())
