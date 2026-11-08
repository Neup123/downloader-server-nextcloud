
## Native Nextcloud-only product

All Downloader user interfaces are hosted by Nextcloud itself: Files actions, Dashboard widget, the native [Library](bridge/README.md), and Nextcloud Personal settings. Do not embed, redirect to, or link users to the standalone Core website. The service origin and API token are configured once in administrator-controlled AppAPI deployment settings and never entered by a regular user.

# Downloader Server — Nextcloud Adaptation

This repository contains the Nextcloud-specific integration for Downloader Server. The core downloader service, web UI, REST API, engine adapters, job manager, tests, and engine update automation are maintained in the separate core repository:

https://github.com/Neup123/Media-Downloader-server

This repository must stay thin. It must not contain downloader logic or duplicate core-owned functionality.

## Current status

**The per-user Nextcloud v0.5.3 release includes native Files, Viewer, Dashboard,
Search, Activity and opt-in Talk message actions.** The standalone downloader
remains Core v0.3.1. Disposable Nextcloud 35 AppAPI and WebDAV checks are
automated; **the owner's actual Nextcloud installation has NOT been checked or
approved for deployment**. See [per-user installation](NEXTCLOUD_PER_USER_INSTALL.md)
and the [acceptance ledger](ACCEPTANCE_STATUS.md).

- [NEXTCLOUD.md](NEXTCLOUD.md) defines the integration boundary, AppAPI/ExApp deployment path, fallbacks, WebDAV delivery, and target-instance checks.
- Core `main` Git ancestry was already imported in merge commit [`0044d368`](https://github.com/Neup123/downloader-server-nextcloud/commit/0044d3686fed9167a9268872c9b1935740e2b74a). Future local clones should add the `upstream` remote normally; do not repeat the unrelated-histories bootstrap.
- The **real target** Nextcloud version, AppAPI state, Deploy Daemon registration, reverse proxy, and WebDAV authentication remain unverified. Disposable CI uses Nextcloud 35.0.2 and has demonstrated both WebDAV readback and a real AppAPI Docker ExApp install/enable/disable/unregister sequence.
- Accepted core changes are checked daily by the [verified core sync workflow](.github/workflows/bootstrap-upstream.yml). Successful imports archive `core-sync-evidence.json` with the exact core parent, downstream merge SHA, core-file parity and test/build gates. This proves source integration, not target deployment.
- An accepted core sync with a failed later AppAPI dispatch can be safely retried via manual `revalidate_current_main=true`: it reruns full test/build gates and records a separate existing-main provenance artifact before dispatching AppAPI explicitly to this repository. It never treats a normal squash commit as a new core merge.
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
a complete exact-version Python package lock and a checked-in
[SHA-256 wheel hash lock](nextcloud_exapp/requirements.hashed.lock), enforced
by `pip --require-hashes --only-binary=:all:` in the production ExApp build.
This checks the actual downloaded wheel bytes against reviewed hashes; it is
not a guarantee of identical multi-architecture OCI build digests.
Nextcloud 35's observed AppAPI `docker-install` manifest
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
4. Install the native PHP bridge ZIP from the matching release; it provides the Nextcloud Library route and Personal settings UI.
5. Verify the Files action, Dashboard, Library, Personal settings, per-user WebDAV delivery and notifications on the target instance. If AppAPI/bridge support is unavailable, block deployment rather than opening the standalone UI.

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


## Install v0.1.0

Follow [NEXTCLOUD_INSTALL.md](NEXTCLOUD_INSTALL.md) for the versioned GHCR/AppAPI path and real-target verification. The v0.1.0 baseline is still admin-only; per-user UI integration is planned separately.


## Per-user Nextcloud 0.2.0

After the administrator-only v0.1.0 baseline, the per-user Nextcloud version requires BOTH `ghcr.io/neup123/media-downloader-server:0.2.0` and `ghcr.io/neup123/downloader-server-nextcloud:0.2.0`. Do not mix a 0.2 ExApp with the 0.1 standalone core. The UI-only native PHP bridge is packaged as `downloader-bridge-0.2.0.zip` on the Nextcloud v0.2.0 GitHub Release. Read [NEXTCLOUD_PER_USER_INSTALL.md](NEXTCLOUD_PER_USER_INSTALL.md) for installation and verification.

### Native administrator settings

The signed AppAPI administrator landing page now serves a dedicated Nextcloud
administrator dashboard. **Service connection** verifies the real Core engines
server-side, displays the configured Core URL and whether a private API token is
configured, but never returns the token to the browser. Change the URL or token
through the ExApp's Nextcloud AppAPI deployment configuration, not in the
browser. **Who can download** manages individual Nextcloud user and group IDs in
the same AppAPI entitlement storage enforced independently on each per-user
request. Without a grant, ordinary users cannot use the downloader.

Do not open the standalone Core administrator website through Nextcloud.
Administrators manage service credentials only at ExApp installation time,
and entitlement is administered in Nextcloud settings. Regular users see
neither the service origin nor any service API-key screen. Acceptance on the
operator's actual Nextcloud instance remains tracked in issue #19.


## Licensing of the two Nextcloud components

The **Core downloader** and separately deployed **Nextcloud ExApp** source
are licensed under [Business Source License 1.1 with the owner's Additional
Use Grant](LICENSE). Free production use requires **both** whole-organization
limits: at most **20 workers** (employees and independent contractors in
total) and no more than **USD 250,000** in total revenue in the preceding
tax year. Count parent companies, subsidiaries and all affiliates under
common control together. Exceeding **either** limit requires a separately
paid commercial license from Neup123 for production use.

Distributions must retain the full [LICENSE](LICENSE) and its Required
Notice. The License specifies a Change Date of 2030-11-08 and a
GPL-3.0-or-later Change License. Normal BSL non-production rights remain.
The BSL terms are **source-available, not OSI-approved open source**.

The **native Nextcloud UI bridge** is a separate application under
[AGPL-3.0-or-later](bridge/LICENSE), due in part to the AGPL-licensed
`@nextcloud/files` dependency. Its own
[`bridge/appinfo/info.xml`](bridge/appinfo/info.xml) continues to declare
AGPL. The ExApp's `appinfo/info.xml` declares `BUSL-1.1`; it is not
a declaration of licensing for the separate native bridge.
All other third-party packages retain their respective licenses.
Prior distributed versions retain their applicable earlier license terms.
