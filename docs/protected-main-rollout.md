# Protected main rollout (#195)

The GitHub API reported main unprotected and no rulesets on 25 November
2026. The connected GitHub App cannot write administration settings (and
branch-protection GET returns 403). This code change is preparation, not
evidence of a live ruleset.

The candidate workflow retains the upstream exact merge, core file parity,
generated consumer contracts, both test suites and Docker build. After
those checks it opens a same-repository PR from a topic branch. No direct
push to main, no bypass actor, no auto-merge. The candidate artifact explicitly
does not attest accepted main. Use a **merge commit**, not squash or rebase,
to retain Core ancestry. A closed merged same-repository sync PR causes
revalidation on actual main; ancestor and byte-parity checks precede the
existing main revalidation attestation and AppAPI dispatch.

Before activating a ruleset, test a real sync candidate: confirm the
proposed topic's second parent is the exact Core SHA, all PR checks passed
on the merge candidate, merge commit preserves its ancestry and actual
main revalidation produces evidence. GitHub may require approval for
workflow runs on bot-created PRs. Approve those runs rather than bypass
checks. A manual workflow dispatch is not a substitute for required PR
checks (see https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

Administrator configuration after the real sync rehearsal:
- target only refs/heads/main;
- require pull requests and up-to-date branches;
- block force pushes and deletions; no blanket GitHub Actions bypass;
- require the five actual check contexts: unittest, preflight-acceptance,
  docker-deploy, package, build-exapp (select GitHub Actions as source).
  These workflows now run on every PR to main rather than path-filtered
  PRs. Push filters remain to avoid redundant post-merge work.
- prove a deliberately failing disposable PR is blocked, then close it;
  do not push an intentionally failing change to main.
- read back the active ruleset and branch status before closing #195.

GitHub owner settings: https://github.com/Neup123/downloader-server-nextcloud/settings/rules
This rollout does not change repository administration by itself, does not
verify a production Nextcloud host and does not claim a completed migration
until the actual candidate and revalidation are observed.
