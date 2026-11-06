# Install the per-user Downloader integration (Nextcloud 35)

## Release images

- Standalone Downloader Server: ghcr.io/neup123/media-downloader-server:0.3.0
- Nextcloud AppAPI ExApp: ghcr.io/neup123/downloader-server-nextcloud:0.5.0
- Native UI-only PHP bridge: downloader-bridge-0.5.0.zip attached to the Nextcloud v0.5.0 GitHub Release.

The v0.1.0 release remains the administrator-only baseline and cannot accept
per-user job submissions. **Core 0.3.0 and ExApp 0.5.0 are required** for the
per-user UI. Never write directly into Nextcloud's data directory.

## Step 1 — verify connectivity and published tags

On the Docker host, pull the images:

    docker pull ghcr.io/neup123/media-downloader-server:0.3.0
    docker pull ghcr.io/neup123/downloader-server-nextcloud:0.5.0

For private GHCR packages give the AppAPI Deploy Daemon a read-only registry
credential, or make the package public. Do not reuse the downloader API token
as a registry credential.

On Nextcloud, verify AppAPI is installed and enabled, that a Deploy Daemon is
registered and its Test Deploy succeeds, and that the Nextcloud version is 35.
For a Docker Nextcloud instance (replace CONTAINER):

    docker exec -u www-data CONTAINER php occ status
    docker exec -u www-data CONTAINER php occ app:enable app_api
    docker exec -u www-data CONTAINER php occ app_api:daemon:list

Use the official Nextcloud admin UI to register a functional Docker or HaRP
Deploy Daemon if none exists. For HaRP, the Nextcloud reverse proxy must
forward /exapps/ to the HaRP server. Inspect your Docker network and port
rules; passing an unrelated WebDAV test does not prove AppAPI connectivity.

## Step 2 — deploy the core server

Use the core repository's guarded compose.egress.yaml on a Linux-compatible
Docker host. Create .env with APP_API_TOKEN and APP_ENCRYPTION_KEY and keep the
existing keys and persistent data volume when upgrading from 0.1.0.

    docker compose -f compose.egress.yaml build egress-guard
    DOWNLOADER_IMAGE=ghcr.io/neup123/media-downloader-server:0.3.0 docker compose -f compose.egress.yaml up -d --no-build

The core must be reachable from the ExApp network at a known HTTPS URL, or
at internal HTTP with explicit DOWNLOADER_ALLOW_TRUSTED_HTTP=true. It must
also be able to reach the Nextcloud WebDAV URL reported to the ExApp. Do not
expose APP_API_TOKEN to end users or to any JavaScript.

## Step 3 — register the 0.5.0 ExApp

Download the appinfo/info.xml attached to the tagged Nextcloud v0.5.0
release. In the Nextcloud AppAPI administrator page, select the tested
Deploy Daemon and register the ExApp using that manifest. Supply environment
variables on the server only:

- DOWNLOADER_API_URL: URL of the core (origin only, without /api/v1).
- DOWNLOADER_API_TOKEN: exactly the core APP_API_TOKEN.
- DOWNLOADER_ALLOW_TRUSTED_HTTP: true only for trusted internal HTTP.
- DOWNLOADER_WEBDAV_ORIGIN: the actual public HTTPS origin of this same
  Nextcloud installation (for example `https://cloud.example.org`). Set this
  when AppAPI is internally reachable at `http://nextcloud` or another private
  host. The guarded core deliberately rejects private-address or plaintext
  WebDAV destinations. Ensure DNS/hairpin routing from the core container to
  this HTTPS origin actually works. This value is server-side only.

For an installation that supports the AppAPI CLI, the command shape is:

    docker cp info.xml CONTAINER:/tmp/downloader-info.xml
    docker exec -u www-data CONTAINER php occ app_api:app:register downloader-server-nextcloud YOUR_DAEMON --info-xml /tmp/downloader-info.xml --wait-finish
    docker exec -u www-data CONTAINER php occ app_api:app:enable downloader-server-nextcloud

Prefer the administrator UI when supplying the secret so it does not enter
shell history. Register the required environment values in that UI.
Confirm the ExApp container is running and AppAPI reports it enabled.

## Step 4 — assign user entitlement

Nextcloud Administration > Downloader access: add the entitled Nextcloud user
IDs and/or group IDs (comma-separated). Everyone else remains denied and sees
no UI actions in the native bridge. The ExApp also authorizes every user API
request separately using the signed AppAPI identity.

Nextcloud Personal settings > Downloader: each entitled user chooses a
destination folder and default preset, enters their own dedicated Nextcloud
WebDAV app password, and configures per-engine options and cookies.
This password is stored as a sensitive Nextcloud preference; it is not the
core APP_API_TOKEN. The defaults are private and user-scoped.

## Step 5 — install native Files/header UI integration

Extract downloader-bridge-0.5.0.zip under the instance's custom_apps
directory, producing custom_apps/downloader_bridge/appinfo/info.xml and
custom_apps/downloader_bridge/js/bridge.js. Enable it:

    docker exec -u www-data CONTAINER php occ app:enable downloader_bridge

The PHP bridge does not execute jobs. It loads Nextcloud's supported Files
actions script; the script checks entitlement before showing any action.
Expect folder context-menu and + New actions, a small URL+engine+preset
dialog, and an ambient topbar progress/cancel/retry popover. The Viewer
media action submits immediately only when a source URL is available in
metadata, otherwise it opens the URL dialog.

## Step 6 — check two real users and delivery failures

1. Log in as an entitled user A. Submit a legal test URL into an existing
   folder. Confirm it completes and the result appears in A's Files.
2. Log in as a distinct entitled user B. Confirm B cannot view/cancel/retry
   A's job, and submit a job into B's own Files.
3. Confirm neither user can access the other's cookie files or presets.
4. Log in as a non-entitled user C. Confirm no bridge actions/topbar appear
   and a direct request to the ExApp user API returns 403.
5. Force quota exceeded, missing destination, and unwritable destination
   failures. Confirm job status remains FAILED with an actionable error and
   that the affected user receives a Nextcloud notification.
6. Restart the ExApp and core with persistent volumes. Verify history,
   credentials, notification tracking and per-job delivery remain intact.

If any step fails, do not claim the target instance is installed and ready.
The disposable CI test does not prove network reachability or group assignment
on the operator's actual Nextcloud deployment.

## Limits

The Nextcloud 0.5.0 integration includes per-user jobs, personal settings,
Files/+New/Viewer and progress UI, failure notifications, provenance details,
Dashboard, unified search, and native Activity entries. The standalone core remains version 0.3.0.
Nextcloud's background jobs must be enabled for Activity events.
Talk link integration is deliberately deferred until a production instance is verified.
Files without stored provenance cannot be re-downloaded without supplying their source URL.
