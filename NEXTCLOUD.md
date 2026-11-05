# Nextcloud Adaptation

## 1. Purpose and boundary

This repository contains only the Nextcloud-specific adaptation of Downloader Server. The core service, web UI, REST API, engine adapters, generic delivery implementation, tests, and engine update automation belong in the core repository:

https://github.com/Neup123/Media-Downloader-server

The Nextcloud adaptation must not contain its own downloader, duplicate engine settings, or fork the job-management implementation. Core changes are brought in through regular upstream merges.

## 2. Upstream relationship

Core repository: https://github.com/Neup123/Media-Downloader-server  
Upstream remote name: upstream  
Downstream remote name: origin

Shared Git ancestry was **already established** on the remote repository by
[bootstrap merge commit 0044d368](https://github.com/Neup123/downloader-server-nextcloud/commit/0044d3686fed9167a9268872c9b1935740e2b74a).
Its second parent is core `main` commit `06336a0b`; the downstream
`BLUEPRINT.md` matches the core source blob. The Nextcloud-specific README
intentionally remains different.

A local clone must still configure its own upstream remote (Git remote
configuration is local to each checkout, not stored in Git history):

    git remote add upstream https://github.com/Neup123/Media-Downloader-server.git
    git fetch upstream
    git merge upstream/main

Do **not** use `--allow-unrelated-histories` again: the remote repository
already has a shared ancestor with core `main`. Future core-owned changes
can be brought in with ordinary upstream merges now that core PR #2
landed on `main`. The verified core source was imported into this repository\'s `main` via ordinary merge commit `c8f81a2`; Nextcloud-owned GitHub Actions workflows are retained instead of importing duplicate core release schedules.

Do not edit or duplicate core-owned files here unless a documented Nextcloud-specific delta requires it. Prefer AppAPI packaging metadata, Nextcloud integration code, and deployment configuration in clearly separated paths.

## 3. Preferred integration: AppAPI ExApp

The preferred integration is an AppAPI External App (ExApp). AppAPI manages the lifecycle of external containerized applications and their integration with Nextcloud users and UI.

Before implementation, inspect the actual target Nextcloud instance and record:

- Exact Nextcloud server version and edition.
- Whether AppAPI is installed, enabled, and compatible with that server version.
- Whether a default Deploy Daemon is registered.
- Deploy Daemon type, reachability, and the result of its Test Deploy operation.
- Whether the host is Nextcloud AIO and already has HaRP or Docker Socket Proxy configured.
- Whether the required reverse-proxy routing is available for the selected Deploy Daemon.
- Whether WebDAV uploads work for the target user and destination folder.

AppAPI has been automatically installed by default since Nextcloud 30.0.1, but it is optional and may be disabled or unconfigured. AppAPI alone does not deploy an ExApp: a Deploy Daemon must be registered and reachable.

Nextcloud's current stable administration documentation recommends HaRP as the newer Deploy Daemon path. AIO installations with HaRP or Docker Socket Proxy may already have a configured Deploy Daemon. For other installations, registration is an administrative host-level step. Do not assume any of these conditions without checking the target.

## 4. Delivery to Nextcloud Files

Use the core repository's generic WebDAV delivery module, preconfigured for the target instance.

The standard authenticated file endpoint is:

    https://NEXTCLOUD-HOST/remote.php/dav/files/USERNAME/DESTINATION/PATH

Delivery behavior:
1. Create missing destination directories using WebDAV MKCOL where necessary.
2. Upload each completed file using WebDAV PUT.
3. Check the response and then verify the target file metadata and expected size using WebDAV. An upload HTTP status alone is not proof of delivery.
4. Preserve the original local job record and report a distinct delivery state if upload fails.
5. Never write files directly into Nextcloud's data directory and never run files:scan as a delivery mechanism.

Use a dedicated Nextcloud app password for the integration. The administrator enters the username and app password in the service UI or secret store; neither value belongs in Git, image layers, logs, or example configuration files.

Relevant documentation:
- AppAPI / ExApps: https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/AppAPIAndExternalApps.html
- WebDAV operations: https://github.com/nextcloud/documentation/blob/master/developer_manual/client_apis/WebDAV/basic.rst

## 5. Fallback order

1. AppAPI ExApp, when the target supports it and a Deploy Daemon is configured and tested.
2. Standalone service container on the same Docker host, with the official Nextcloud External Sites app embedding the service UI.
3. A thin PHP bridge only if both previous options are unavailable. The bridge may embed/proxy the UI and relay completion notifications; it must never contain download logic.

Keep the integration thin so Nextcloud major upgrades cannot break the core downloader.

## 6. Current status and blockers

- Repository initialized with the shared core overview.
- Disposable AppAPI Docker deployment CI has been added and passed using the official example ExApp. Downloader Server's own ExApp packaging is still under development.
- The actual target Nextcloud instance has not been inspected in this build session.
- AppAPI/Deploy Daemon feasibility is therefore **unverified**.
- Shared upstream Git ancestry was established by merge commit `0044d368`; the accepted core `main` was synchronized into this Nextcloud `main` by normal two-parent merge `c8f81a2`, after combined Python and production Docker acceptance.

Develop and test ExApp packaging against disposable CI independently of production. Do not claim the **real target** is supported or deploy to production until the target-instance checks in Section 3 succeed.


## WebDAV target-instance preflight (safe before selecting an integration method)

The repository provides a read-only-by-default readiness probe. It checks the live
Nextcloud `status.php` response and WebDAV authentication/PROPFIND access for the
intended user and *existing* destination folder. A separate opt-in test creates
a randomly named folder within that destination, uploads a small payload, checks
the reported WebDAV file size, downloads it to verify SHA-256, and then deletes
the test file and temporary directory. **The write check modifies the live
Nextcloud Files store temporarily; run it only after confirming the folder.**

Use a dedicated Nextcloud **app password**, not an account password. The CLI
prompts securely, or takes the password from `NEXTCLOUD_APP_PASSWORD` in the
environment. Never copy secrets into command-line flags, GitHub issues, or logs.

```bash
python3 scripts/nextcloud_preflight.py \
  --url https://cloud.example.org \
  --username example-user \
  --folder Downloader

python3 scripts/nextcloud_preflight.py \
  --url https://cloud.example.org \
  --username example-user \
  --folder Downloader \
  --write-test
```

The probe requires only Python 3.10+ standard-library modules; no extra
packages or Nextcloud shell access are needed. It uses HTTPS certificate
verification, disallows HTTP redirects, and bypasses inherited `HTTP_PROXY`,
`HTTPS_PROXY`, and related environment proxies to keep authenticated requests
on a direct connection to the configured Nextcloud origin. The probe host
must therefore be able to reach that origin directly. `--allow-http` is
intended only for a controlled local development environment. If a reverse proxy uses a
subdirectory, include it in `--url`. If the intended folder does not yet
exist, create it in Nextcloud Files before running the probe.

**What this does not prove:** WebDAV success does not establish AppAPI
compatibility or deployment readiness. On the actual Nextcloud server, an
administrator must separately record the exact version, check whether
`app_api` is enabled (`occ app:list`), list registered daemons
(`occ app_api:daemon:list`), and invoke **Test deploy** in
Settings → Administration → AppAPI. Record the daemon type, its reachability,
the Test deploy result, and whether the installation uses AIO/HaRP.
Do not publish a supported-server claim or select ExApp packaging until these
checks have actually succeeded.

References: [official Nextcloud WebDAV operations](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html),
[Deploy Daemon management](https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/ManagingDeployDaemons.html),
[Test Deploy](https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/TestDeploy.html).


## Read-only AppAPI readiness check

Run this **on the Nextcloud host** before selecting ExApp packaging. The
script invokes only `occ status`, `occ app:list`, and, when AppAPI is
enabled, `occ app_api:daemon:list`. It does not register, enable, install,
or deploy anything. It prints only a sanitized JSON summary: the raw daemon
configuration (which may include internal network details) is discarded.

For Nextcloud AIO where the Nextcloud application container has the standard
name, use:

```bash
python3 scripts/appapi_readiness.py --container nextcloud-aio-nextcloud
```

For another container use its actual name, not the example name. On a
non-Docker installation where the invoking account can run `occ` under
the correct web-server user:

```bash
python3 scripts/appapi_readiness.py \
  --occ-command 'php /var/www/html/occ'
```

If permission elevation is needed, start the script under the correct user,
or supply an appropriate `--occ-command` prefix such as
`sudo -u www-data php /var/www/html/occ`. The command is split into
arguments and executed without a shell.

The report shows the server version, whether AppAPI is enabled, and whether
the Deploy Daemon list command succeeded. For recognized Nextcloud output,
it also reports **none** or a count of registered daemon entries; it never
prints their names, network configuration, or credentials. An unknown output
format is reported as unverified, not as an available daemon. Registration
alone **does not establish** that a daemon is reachable, correctly routed,
or usable. An
administrator must inspect the registered daemons locally and run **Test
Deploy** in Settings → Administration → AppAPI. That action deploys a
temporary test ExApp; unlike the read-only probe it is not safe to treat as
inspection only. Separately run `scripts/nextcloud_preflight.py` to verify
the target WebDAV destination, and opt in to its write test only when the
destination is confirmed.

Do not select or publish a supported ExApp deployment until **the actual
target** has a successful Test Deploy and WebDAV delivery verification.
AppAPI being enabled, or a successful `occ app_api:daemon:list`, is
not sufficient evidence.

Official references: [AppAPI and External Apps](https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/AppAPIAndExternalApps.html),
[Deploy Daemon management](https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/ManagingDeployDaemons.html),
[using `occ`](https://docs.nextcloud.com/server/stable/admin_manual/occ_command.html).


## Disposable Nextcloud integration acceptance in CI

The workflow `.github/workflows/live-nextcloud-preflight.yml` builds no
Nextcloud app and makes no changes to the production installation. On PRs,
main-branch changes and manual dispatch it launches a disposable pinned
Nextcloud container with randomly generated, masked test credentials,
waits for installation, then exercises:

1. Read-only WebDAV destination validation for the test administrator's root.
2. The opt-in write preflight in **the disposable instance only**: temporary
   folder creation, file upload, exact-target metadata verification, SHA-256
   readback and cleanup.
3. The read-only AppAPI `occ` inspection on that disposable container. This
   confirms the probe can run; the output intentionally does not include
   daemon configuration or secrets.

CI uses an isolated HTTP loopback mapping with `--allow-http` and a temporary
test password. **Do not copy this HTTP/password exception to production.**
The production instance should use HTTPS, a dedicated app password, and
the specific destination path. A green disposable test **does not** establish
that the target server's AppAPI Deploy Daemon works, that Test Deploy passes,
or that its network/reverse proxy configuration permits ExApps. Those steps
still require live administrator verification before implementation or release.

## One-command target readiness summary

`python3 -m scripts.target_readiness` combines the existing host-side
`occ` inspection and authenticated WebDAV destination probe. The command
accepts the same `--container` or `--occ-command`, plus `--url`,
`--username` and optional `--folder`. It compares the Nextcloud server
versions reported by `occ` and `status.php` and rejects different
installations. By default, neither probe creates files or modifies AppAPI.
The optional `--write-test` creates a randomly named disposable WebDAV
file, downloads it to verify SHA-256, and removes it. Use this option only
after confirming the destination folder; an unexpected interruption can
leave a probe artifact for manual cleanup.

The report keeps the actual Deploy Daemon registration details private and
explicitly identifies AppAPI Test Deploy as **not verified**. A registered
daemon and successful WebDAV write check are both insufficient to publish
an ExApp compatibility claim. Test Deploy remains a separate, explicit
administrator operation on the actual Nextcloud instance.


## Disposable real AppAPI Docker-install acceptance

`.github/workflows/appapi-docker-deploy-e2e.yml` verifies more than the read-only AppAPI readiness probe. It starts a fresh Nextcloud 35.0.2 instance and an isolated Docker Socket Proxy, registers a real `docker-install` Deploy Daemon, installs Nextcloud's official Python skeleton ExApp from a source-pinned manifest, verifies that the ExApp container is running, and exercises enable/disable/unregister. The initial runs on `main` passed. This proves the **CI deployment pipeline**, not this project's Downloader Server ExApp package or administrator Test Deploy on the actual server. The Docker Socket Proxy is strictly ephemeral on the isolated GitHub Actions runner; current Nextcloud documentation recommends HaRP for new production installations. The external sample's image tag is upstream `latest`, so this test alone is not digest-locked or a production reproducibility guarantee.
