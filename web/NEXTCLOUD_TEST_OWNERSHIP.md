# Nextcloud web test ownership

The Core and Nextcloud repositories share Git history, but they do **not** share the same React `web/src/App.tsx`. The standalone Core interface is deliberately not exposed by the Nextcloud integration.

`web/package.json` therefore lists the Nextcloud-owned Node test modules explicitly instead of using `tests/*.test.mjs`. A verified Core upstream merge can introduce Core-only web tests; running these against the Nextcloud-specific legacy React entry point is a false failure. The canonical Core CI is run in the isolated `upstream/main` worktree by `.github/workflows/bootstrap-upstream.yml` before any downstream merge.

When adding a Nextcloud-specific web test, add its path to `web/package.json`'s `test` script in the same PR. Do not add Core-owned tests to that command: they run against the exact upstream code in Core's own test suite. The downstream test command does not claim to cover imported Core web tests, external media sites, or the owner's live installation. The Nextcloud integration retains its disposable AppAPI/ExApp, native browser, and WebDAV acceptance gates.

Source of the split: upstream sync run 44516464585 failed on `url-scheme-hint.test.mjs` asserting Core `item.url_schemes` inside the intentionally divergent Nextcloud `App.tsx`. This was unrelated to release-only `npm install` packaging.
