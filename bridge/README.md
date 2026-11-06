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
