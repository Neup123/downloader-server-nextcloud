# Downloader Server — Nextcloud Adaptation

This repository contains the Nextcloud-specific integration for Downloader Server. The core downloader service, web UI, REST API, engine adapters, job manager, tests, and engine update automation are maintained in the separate core repository:

https://github.com/Neup123/Media-Downloader-server

This repository must stay thin. It must not contain downloader logic or duplicate core-owned functionality.

## Current status

**The administrator-only Downloader Server ExApp is implemented and has passed a real disposable Nextcloud 35 AppAPI installation, signed proxy request and removal test. The actual Nextcloud installation has NOT been checked or approved for deployment.**

- [NEXTCLOUD.md](NEXTCLOUD.md) defines the integration boundary, AppAPI/ExApp deployment path, fallbacks, WebDAV delivery, and target-instance checks.
- Core `main` Git ancestry was already imported in merge commit [`0044d368`](https://github.com/Neup123/downloader-server-nextcloud/commit/0044d3686fed9167a9268872c9b1935740e2b74a). Future local clones should add the `upstream` remote normally; do not repeat the unrelated-histories bootstrap.
- The **real target** Nextcloud version, AppAPI state, Deploy Daemon registration, reverse proxy, and WebDAV authentication remain unverified. Disposable CI uses Nextcloud 35.0.2 and has demonstrated both WebDAV readback and a real AppAPI Docker ExApp install/enable/disable/unregister sequence.
- Accepted core changes are checked daily by the [verified core sync workflow](.github/workflows/bootstrap-upstream.yml). Successful imports archive `core-sync-evidence.json` with the exact core parent, downstream merge SHA, core-file parity and test/build gates. This proves source integration, not target deployment.
- The core `main` includes the [guarded Linux Compose egress configuration](https://github.com/Neup123/Media-Downloader-server/blob/main/EGRESS_GUARD.md), with green Linux CI for private-network and metadata-IP rejection; Docker Desktop/target egress acceptance and live P2 engine acceptance are still incomplete. Do not expose jobs to untrusted submitters.

## Verified disposable AppAPI infrastructure

`.github/workflows/appapi-docker-deploy-e2e.yml` provisions disposable
Nextcloud 35.0.2 and a trusted Docker Socket Proxy, then exercises the
official skeleton ExApp **and our own Downloader Server ExApp**. It checks
real registration, enablement, AppAPI request signing, unsigned-request
rejection, server-side API-key proxying and removal. The real ExApp image
is built from this source and installed using an ephemeral local Docker
registry remap. This does **not** modify the real target.

Accepted `main` commits can publish ExApp images with source-SHA tags and an
OCI digest/provenance artifact. [Pinned build input checks](nextcloud_exapp/Dockerfile)
use immutable Node/Python base image digests, `npm ci`, and
a complete exact-version Python package lock. **Python wheel hashes are not
fully locked**, and Nextcloud 35's observed AppAPI `docker-install` manifest
uses a SHA **tag**, not an OCI digest. The separately recorded `@sha256:`
reference enables audit and direct verified image pulls; it does not make
the XML digest-native or protect against external GHCR tag mutation.

For new production deployments, use the mechanism recommended for the
target's verified AppAPI/Deploy Daemon version (normally HaRP), not the
CI-only Docker Socket Proxy.

## Integration sequence

1. Verify the actual target Nextcloud instance and host-level deployment capabilities.
2. Configure the `upstream` remote in your local checkout; the one-time core-main ancestry bootstrap is already complete, as documented in NEXTCLOUD.md.
3. Install the existing ExApp using its generated source-SHA `info.xml` from a verified release artifact **only after** the target AppAPI/Deploy Daemon passes the administrator Test Deploy. Enter the separate core service origin and secret as ExApp environment variables.
4. Use the official External Sites app to embed the standalone UI as the fallback.
5. Add a thin PHP bridge only if neither supported path is available.

## Delivery

Use the core service's generic WebDAV delivery module. Nextcloud files must be delivered through WebDAV PUT and verified using WebDAV metadata. Never write directly into the Nextcloud data directory or use files:scan as the delivery path.

## Documentation

Start with [NEXTCLOUD.md](NEXTCLOUD.md) for the prerequisites, deployment decision tree, configuration boundaries, and current blockers.

A **read-only-by-default Nextcloud WebDAV preflight** is available at `scripts/nextcloud_preflight.py`. It checks server status, authentication, and access to an existing destination folder; the optional `--write-test` verifies upload, remote size, readback, and cleanup. It does **not** verify AppAPI or the Deploy Daemon. See [NEXTCLOUD.md](NEXTCLOUD.md#webdav-target-instance-preflight-safe-before-selecting-an-integration-method).


A second **read-only AppAPI/Deploy Daemon prerequisite probe** is provided at
`scripts/appapi_readiness.py`. It invokes only Nextcloud `occ` inspection
commands on the actual host; it reports the server version and AppAPI state
without copying daemon configuration into logs. It does **not** perform
AppAPI's mandatory administrator **Test Deploy** or prove ExApp readiness.
See [NEXTCLOUD.md](NEXTCLOUD.md#read-only-appapi-readiness-check).

### Combined target readiness report

On the actual Nextcloud host, one command can run the separate read-only AppAPI
and authenticated WebDAV checks together. The Nextcloud URL, user, and existing
Files destination must refer to the **same** installation:

```bash
python3 -m scripts.target_readiness \\
  --container nextcloud-aio-nextcloud \\
  --url https://cloud.example.org \\
  --username example-user \\
  --folder Downloader
```

If Docker Desktop contains **exactly one** recognizable Nextcloud application
container, you may use `--auto-container` instead of `--container
nextcloud-aio-nextcloud`. It only reads the output of `docker ps` and refuses
ambiguous matches. If several Nextcloud containers are present, select the
intended one explicitly with `--container`; do not guess from the first match.

The app password is requested securely, or read from `NEXTCLOUD_APP_PASSWORD`
if set. The report does not reveal passwords, daemon names or deployment
configuration and does not modify AppAPI. The separate `--write-test` flag
performs a disposable WebDAV upload, SHA-256 readback and cleanup **only after
confirming the target destination**. Even a passing combined report does not
perform or prove AppAPI Test Deploy; administrator verification is mandatory.
See [NEXTCLOUD.md](NEXTCLOUD.md) for the remaining deployment gates.
