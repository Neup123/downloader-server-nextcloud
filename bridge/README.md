# Nextcloud Downloader UI Bridge

A thin native Nextcloud 35 PHP application, with ID downloader_bridge.
This app contains **only UI bootstrap hooks** and a browser-side menu adapter.
There is no download code, server token, file-transfer implementation, or
direct Nextcloud data-directory write in the bridge.

The app registers native Files folder-context and + New actions, media actions
used in Files and compatible Viewer versions, and an ambient header popover
after a positive, authenticated per-user ExApp entitlement check. If the
current Nextcloud user has no Downloader entitlement, the bridge installs
no menu items or buttons. Authorization is enforced again by the ExApp.

A media file whose source URL is available via permitted file metadata can
be submitted with a single click. Other Viewer files open the small
paste-URL dialog; private Nextcloud WebDAV addresses are never treated as
public source URLs. True one-click source recovery for already-delivered
files is part of the planned provenance upgrade.

## Building and installing

Run npm install, npm test and npm run build inside this bridge directory.
The Bridge package CI job creates an installable downloader_bridge directory
under the artifact named downloader-bridge-nc35.

Install the resulting downloader_bridge directory under Nextcloud custom_apps
and enable it with occ app:enable downloader_bridge after the ExApp is enabled.
It is a separate app ID from the ExApp downloader-server-nextcloud.

The bundled @nextcloud/files 4.x JavaScript dependency is AGPL; accordingly
the native UI bridge is distributed under AGPL-3.0-or-later. The standalone
downloader retains its separate MIT licensing.


## Dashboard widget

The UI-only PHP bridge registers a native My downloads widget in Nextcloud Dashboard.
The widget is server-side hidden for users without individual or group entitlement
through the standard Nextcloud app configuration. JavaScript fetches each user's
own jobs through the signed ExApp, shows progress, cancel/retry and recent history.
No download logic or file bytes are handled by this bridge.


## Unified search

Native Nextcloud Search registers a **Downloads** category containing only the
current entitled user's job-history metadata (source domain/path, engine, status
and delivered filenames). The ExApp writes a bounded, sanitized index into
Nextcloud's own per-user preferences. The UI bridge reads only that user's
preferences; it does not contact the downloader core or handle any file bytes.
Nextcloud's built-in **Files** search continues to find actual delivered files.
Search index entries update at submission, history refresh and terminal state.
Existing historical jobs become indexed when the user first opens Downloader.


## Native Activity entries

The UI bridge registers a standard Nextcloud Activity provider and a small
180-second Nextcloud timed job. It reads owner-scoped terminal job metadata
from Nextcloud's own user preferences and publishes **one Activity record per
completed/failed/cancelled download** for the affected owner; individual and
group entitlements apply. No downloader service connection, WebDAV or data
directory access exists in this PHP hook. Nextcloud's background jobs must run
for these Activity entries to appear. The stored `activity_seen` preference
limits duplicate entries across cron runs.
