# Downloader Server — Nextcloud Adaptation

This repository contains the Nextcloud-specific integration for Downloader Server. The core downloader service, web UI, REST API, engine adapters, job manager, tests, and engine update automation are maintained in the separate core repository:

https://github.com/Neup123/Media-Downloader-server

This repository must stay thin. It must not contain downloader logic or duplicate core-owned functionality.

## Current status

**Integration documentation initialized; no Nextcloud app or deployment package is implemented yet.**

- [NEXTCLOUD.md](NEXTCLOUD.md) defines the integration boundary, AppAPI/ExApp deployment path, fallbacks, WebDAV delivery, and target-instance checks.
- The target Nextcloud version, AppAPI state, Deploy Daemon registration, reverse proxy, and WebDAV authentication remain unverified.
- The core Phase 1 implementation is under review in the core repository. Do not package or integrate an unaccepted core build.

## Integration sequence

1. Verify the actual target Nextcloud instance and host-level deployment capabilities.
2. Bootstrap the Git relationship with the core repository as the upstream remote, as described in NEXTCLOUD.md.
3. Prefer AppAPI ExApp packaging where the target supports it and a Deploy Daemon is configured and tested.
4. Use the official External Sites app to embed the standalone UI as the fallback.
5. Add a thin PHP bridge only if neither supported path is available.

## Delivery

Use the core service's generic WebDAV delivery module. Nextcloud files must be delivered through WebDAV PUT and verified using WebDAV metadata. Never write directly into the Nextcloud data directory or use files:scan as the delivery path.

## Documentation

Start with [NEXTCLOUD.md](NEXTCLOUD.md) for the prerequisites, deployment decision tree, configuration boundaries, and current blockers.
