# Install the per-user Downloader integration (Nextcloud 35)

If the target cannot deploy AppAPI ExApps, use the separately tested [official External Sites fallback](NEXTCLOUD_EXTERNAL_SITES_FALLBACK.md); it is a standalone, administrator-scoped UI, **not** per-user SSO.


## Release images

- Standalone Downloader Server: ghcr.io/neup123/media-downloader-server:0.3.1
- Nextcloud AppAPI ExApp: ghcr.io/neup123/downloader-server-nextcloud:0.5.3
- Native UI-only PHP bridge: downloader-bridge-0.5.3.zip attached to the Nextcloud v0.5.3 GitHub Release.

The v0.5.3 release retains administrator protections and adds a native Talk link action plus the bridge's first-use destination fix; use the matching versioned bridge ZIP.

The v0.1.0 release remains the administrator-only baseline and cannot accept
per-user job submissions. **Core 0.3.1 and ExApp 0.5.3 are required** for the
per-user UI. Never write directly into Nextcloud's data directory.

## Step 1 — verify connectivity and published tags

On the Docker host, pull the images:

    docker pull ghcr.io/neup123/media-downloader-server:0.3.1
    docker pull ghcr.io/neup123/downloader-server-nextcloud:0.5.3

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
    DOWNLOADER_IMAGE=ghcr.io/neup123/media-downloader-server:0.3.1 docker compose -f compose.egress.yaml up -d --no-build

The core must be reachable from the ExApp network at a known HTTPS URL, or
at internal HTTP with explicit DOWNLOADER_ALLOW_TRUSTED_HTTP=true. It must
also be able to reach the Nextcloud WebDAV URL reported to the ExApp. Do not
expose APP_API_TOKEN to end users or to any JavaScript.

### Optional internal AppAPI-to-core Docker network route

A core API bound to host `127.0.0.1:8080` is **not** automatically reachable
at `127.0.0.1` from a separately deployed ExApp. If the ExApp and core are
on the same Docker host, the checked-in
[Compose network overlay](compose.nextcloud-network.yaml) can attach only
the existing `egress-guard` service to the **already existing** network of
the Nextcloud AppAPI Deploy Daemon. It adds no second core container, no
new privileged egress exception and no new published port.

First determine the actual network from the Nextcloud Deploy Daemon
configuration, not from a guessed network name. **From the original core
repository directory**, with its existing `.env`, Compose project and data
volume, supply the overlay as a second `-f` file:

```sh
export NEXTCLOUD_DOCKER_NETWORK=THE_EXISTING_NEXTCLOUD_NETWORK
export DOWNLOADER_IMAGE=ghcr.io/neup123/media-downloader-server:0.3.1
docker compose -f compose.egress.yaml -f /path/to/downloader-server-nextcloud/compose.nextcloud-network.yaml config --quiet
docker compose -f compose.egress.yaml -f /path/to/downloader-server-nextcloud/compose.nextcloud-network.yaml up -d --no-build --wait
```

The **first** `-f` file must remain the core repository's existing
`compose.egress.yaml` so the original Compose project and persistent volume
are reused. Never launch the Nextcloud checkout's inherited core Compose as
a second project while another core instance is running.

When the tested AppAPI daemon attaches its ExApps to that same network,
configure ExApp `DOWNLOADER_API_URL=http://downloader-core:8080` and
`DOWNLOADER_ALLOW_TRUSTED_HTTP=true` server-side. This is a trusted
container-to-container API route, not a public HTTP exception. Test ExApp
connectivity over that route and confirm the Docker network excludes
untrusted clients.

The guarded core still cannot reach Docker-private Nextcloud WebDAV hosts;
use the reachable public HTTPS `DOWNLOADER_WEBDAV_ORIGIN` setting described
below. If the host cannot route to that HTTPS origin, do **not** disable
the egress policy: the real-install test must report the blocker.

## Step 3 — register the 0.5.3 ExApp

Download the appinfo/info.xml attached to the tagged Nextcloud v0.5.3
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

For an installation that supports the AppAPI CLI, the **command shape** is
shown below. Do **not** run it without first configuring
`DOWNLOADER_API_URL` and `DOWNLOADER_API_TOKEN`: the ExApp validates them at
startup and registration will fail when they are absent. The supported
`app_api:app:register` command accepts repeatable `--env NAME=VALUE`
arguments (including `DOWNLOADER_WEBDAV_ORIGIN` if required). However,
command-line secrets can appear in shell history and process listings, so
**prefer AppAPI's administrator deployment options UI** to enter the secret
and register the manifest.

    docker cp info.xml CONTAINER:/tmp/downloader-info.xml
    # Supply required --env NAME=VALUE options when using the CLI.
    docker exec -u www-data CONTAINER php occ app_api:app:register downloader-server-nextcloud YOUR_DAEMON --info-xml /tmp/downloader-info.xml --wait-finish --env DOWNLOADER_API_URL=https://YOUR-CORE-ORIGIN --env DOWNLOADER_API_TOKEN=REPLACE_WITH_REAL_SECRET
    docker exec -u www-data CONTAINER php occ app_api:app:enable downloader-server-nextcloud

Never paste a real token in a shared terminal, issue, log, or test transcript.
Register the required environment values in the administrator UI.
Confirm the ExApp container is running and AppAPI reports it enabled.

### Verify the exact deployed image against the release

The host-side `scripts/verify_deployed_exapp.py` script checks that the
AppAPI-created Docker container is actually running the manifest's GHCR
image, that its OCI source-revision label matches the **GitHub Release target
commit**, and that Docker has a single valid GHCR digest for the image.

From this repository, with the downloaded release `info.xml`:

```sh
release_sha="$(gh release view v0.5.3 --repo Neup123/downloader-server-nextcloud \
  --json targetCommitish --jq .targetCommitish)"
python3 scripts/verify_deployed_exapp.py \
  --manifest info.xml \
  --expected-source "$release_sha"
```

The `release_sha` variable is the GitHub Release's exact target commit. Do not
reuse the commit from an earlier release or substitute the mutable branch head.
For stronger independent attestation, take `container_image_digest` from the
matching source-SHA publisher
workflow's `image-provenance.json` artifact and add
`--expected-digest ghcr.io/neup123/downloader-server-nextcloud@sha256:...`.
This independently compares the installed Docker digest with the
CI-published digest; do not infer immutability from a tag alone.

The script prints no credentials or container environment. It is read-only,
and it does **not** change Nextcloud's AppAPI limitation: the docker-install
manifest still uses a tag instead of a native `@sha256` reference. Report
that separately under [issue #24](https://github.com/Neup123/downloader-server-nextcloud/issues/24)
rather than calling it natively digest-pinned.

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

Extract downloader-bridge-0.5.3.zip under the instance's custom_apps
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

The Nextcloud 0.5.3 integration includes per-user jobs, personal settings,
Files/+New/Viewer and progress UI, failure notifications, provenance details,
Dashboard, unified search, native Activity entries, and the opt-in Talk 35
message-menu download action. The standalone core remains version 0.3.1.
Nextcloud's background jobs must be enabled for Activity events.
A Talk message with exactly one HTTP(S) link opens the download dialog; no
download begins before confirmation. Verify the action in the operator's real
Nextcloud/Talk browser before claiming target acceptance.
Files without stored provenance cannot be re-downloaded without supplying
their source URL.


### Shared administrator presets and private personal presets

Core's administrator may mark a validated preset **Available to everyone**.
Only explicitly marked, non-sensitive presets appear for signed-in,
Downloader-entitled Nextcloud users. Existing Core presets remain private
by default, including after database migration. The user's preset list
combines those read-only shared choices with personal presets saved in that
user's Nextcloud preferences; personal presets never leave their owner scope.

Shared choices are labeled **Shared by administrator** and cannot be edited
or deleted by ordinary Nextcloud users. Selection may be saved as the user's
default or chosen for an individual download. The ExApp resolves the approval
against the current Core `GET /presets/shared` collection on each submission,
merges the approved options into that user's signed per-job settings and
**never forwards the global Core preset ID** as a Core `preset_id`.
Unshared, revoked, guessed or cross-user personal IDs fail closed.
When Core is older and does not support the shared endpoint, personal presets
still work and the shared list stays empty.

The shared feature requires a Core deployment containing the new opt-in
endpoint; it is **not** included in older tagged Core v0.3.1. It does not
remove the need to verify a real Nextcloud target, AppAPI/HaRP routing,
TLS/WebDAV delivery and entitlement behavior under #19.


### Visual personal settings and safe automatic saving

The Nextcloud **My settings** page groups three tasks: **Where your downloads go**
(including **Your defaults**), **Files connection**, and **Notifications**.
The destination folder may be typed or selected using **Browse my Files folders**.
The picker reads only existing directories from the signed-in, entitled
Nextcloud user's own Files through a read-only, paginated endpoint.
It does not create folders and never accepts another user's ID or file path.

Changing a destination, default preset or notification toggle saves
automatically and shows **Saving… / Saved ✓ / Changes not saved** with retry.
Changes affect new downloads, not already-running transfers. Invalid
destination paths never enter the autosave queue. An initial preferences
read does **not** write them back to Nextcloud.

**Passwords are not autosaved.** Creating or replacing the dedicated
WebDAV app password requires an explicit **Connect my Files** action.
This patch changes only the sensitive credential field; ordinary autosave
patches contain only destination, default preset and notification booleans,
so they cannot silently clear or expose the password. The Core API token
is never sent to the user's browser.

On a missing or inaccessible Nextcloud Files folder, select an existing
folder using the picker; the default first-use Downloads folder may also
be created by the signed submission flow as documented above.


### Administrator: which entitled users have connected Files?

Open **Nextcloud → Downloader administration → Who can download**, then
select **Check Files connections**. This read-only report checks the **saved**
user/group entitlements, displays each entitled user as **Connected ✓**,
**Not connected**, or **Status unavailable**, and summarizes each
entitled group's connection status.

Only a signed Nextcloud administrator can request this report. It asks
Nextcloud whether each granted user has saved a dedicated WebDAV app
password; neither the password nor any API token is ever returned to the
administrator's browser. **Status unavailable** means Nextcloud could
not read the user's readiness; it is not equivalent to no connection.
For large installations, group membership inspection is capped at 250
directory users per refresh. If Nextcloud cannot provide that directory
or the scan is incomplete, the admin screen explicitly marks group
counts **partial**; missing names must not be treated as disconnected.
The report does not itself grant or revoke any Downloader access.

The two-step first-run guide remains visible to entitled users until
their Files connection is configured and a download has actually
completed with verified WebDAV delivery. A non-entitled user's direct
link gets the existing friendly access message rather than the admin
connection report.
