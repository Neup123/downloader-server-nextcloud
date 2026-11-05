# Nextcloud Adaptation

## 1. Purpose and boundary

This repository contains only the Nextcloud-specific adaptation of Downloader Server. The core service, web UI, REST API, engine adapters, generic delivery implementation, tests, and engine update automation belong in the core repository:

https://github.com/Neup123/Media-Downloader-server

The Nextcloud adaptation must not contain its own downloader, duplicate engine settings, or fork the job-management implementation. Core changes are brought in through regular upstream merges.

## 2. Upstream relationship

Core repository: https://github.com/Neup123/Media-Downloader-server  
Upstream remote name: upstream  
Downstream remote name: origin

This repository was empty before initialization. Its first README commit intentionally matches the core README so the initial history import can be made without a README content conflict. The first local checkout must establish shared Git ancestry:

    git remote add upstream https://github.com/Neup123/Media-Downloader-server.git
    git fetch upstream
    git merge --allow-unrelated-histories upstream/main

Resolve any initial Git-history conflict, keep the core files identical to upstream, and commit the merge. After that one-time bootstrap, use normal upstream merges:

    git fetch upstream
    git merge upstream/main

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
- Nextcloud-specific code and container packaging have not been added.
- The actual target Nextcloud instance has not been inspected in this build session.
- AppAPI/Deploy Daemon feasibility is therefore **unverified**.
- The first upstream history merge described above has not yet been performed.

Do not begin ExApp packaging or declare a supported Nextcloud version until the target-instance checks in Section 3 are complete.
