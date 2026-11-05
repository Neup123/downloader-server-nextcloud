# Downloader Server — Nextcloud Adaptation

This repository contains the Nextcloud-specific integration for Downloader Server. The core downloader service, web UI, REST API, engine adapters, job manager, tests, and engine update automation are maintained in the separate core repository:

https://github.com/Neup123/Media-Downloader-server

This repository must stay thin. It must not contain downloader logic or duplicate core-owned functionality.

## Current status

**Integration documentation initialized; no Nextcloud app or deployment package is implemented yet.**

- [NEXTCLOUD.md](NEXTCLOUD.md) defines the integration boundary, AppAPI/ExApp deployment path, fallbacks, WebDAV delivery, and target-instance checks.
- Core `main` Git ancestry was already imported in merge commit [`0044d368`](https://github.com/Neup123/downloader-server-nextcloud/commit/0044d3686fed9167a9268872c9b1935740e2b74a). Future local clones should add the `upstream` remote normally; do not repeat the unrelated-histories bootstrap.
- The target Nextcloud version, AppAPI state, Deploy Daemon registration, reverse proxy, and WebDAV authentication remain unverified.
- The core Phase 1 implementation is under review in the core repository. Do not package or integrate an unaccepted core build.

## Integration sequence

1. Verify the actual target Nextcloud instance and host-level deployment capabilities.
2. Configure the `upstream` remote in your local checkout; the one-time core-main ancestry bootstrap is already complete, as documented in NEXTCLOUD.md.
3. Prefer AppAPI ExApp packaging where the target supports it and a Deploy Daemon is configured and tested.
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

The app password is requested securely, or read from `NEXTCLOUD_APP_PASSWORD`
if set. The report does not reveal passwords, daemon names or deployment
configuration and does not modify AppAPI. The separate `--write-test` flag
performs a disposable WebDAV upload, SHA-256 readback and cleanup **only after
confirming the target destination**. Even a passing combined report does not
perform or prove AppAPI Test Deploy; administrator verification is mandatory.
See [NEXTCLOUD.md](NEXTCLOUD.md) for the remaining deployment gates.
