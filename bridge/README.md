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
this **separate** native PHP/JavaScript bridge is distributed under
[AGPL-3.0-or-later](LICENSE) (also declared in bridge/appinfo/info.xml).
The separately deployed Core downloader and Nextcloud ExApp are
source-available under [Business Source License 1.1](../LICENSE), with the
specific small-organization Additional Use Grant and Required Notice there.
The BUSL terms do **not** replace this bridge's AGPL license or the licenses
of its third-party dependencies. Preserve both notices when distributing the
two separately identified apps.


## Dashboard widget

The UI-only PHP bridge registers a native My downloads widget in Nextcloud Dashboard.
The widget is server-side hidden for users without individual or group entitlement
through the standard Nextcloud app configuration. JavaScript fetches each user's
own jobs through the signed ExApp, shows progress, cancel/retry and recent history.
No download logic or file bytes are handled by this bridge.


The Dashboard shows compact scrolling download rows with status, media icons,
accessible icon actions, a three-dot menu, and Nextcloud-native details. A
periodic refresh preserves its scroll, expanded menus and dialog state.

The **Open downloads history** action opens the native Nextcloud Library route
`/apps/downloader_bridge/library` (not the raw AppAPI proxy UI). The route
is registered by this PHP bridge and rendered inside the standard Nextcloud
page layout. It requires the same per-user entitlement as the Dashboard.
The Library supports owner-scoped search, status filtering, pagination,
retry-all-failed, and clearing visible terminal history. **Clearing history
only hides entries for the current user and never deletes downloaded Files
or the Core records needed for file provenance.** The browser uses only
signed AppAPI user routes, never the Core API key.

Native Nextcloud Notifications and Activity remain platform-native views
rather than rendering React cards inside notifications; they use the same
human download-status semantics and link to a verified file when available.
The Talk menu action, native Files context action, and provenance sidebar
already use the matching language and confirmation flow.

## Native Library and unified search

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


## Nextcloud Talk message action

On Nextcloud 35 with Talk enabled, the UI bridge registers Talk's supported
`OCA.Talk.registerMessageAction` menu action **Download linked URL into my Files**.
It is shown only to Downloader-entitled signed-in users; Talk itself hides
third-party actions in classified conversations. On a message with exactly
one HTTP(S) link, selecting the action opens the usual download confirmation
dialog with the source prefilled, quality/Audio only controls and the user's
configured Files destination. The user must press **Download** to submit.
No Talk messages are sent to a bot, scraped from the DOM or downloaded
without confirmation. Messages with zero or multiple distinct links do not
start any download. Talk 35's message-action API has no per-message visibility
predicate, so the menu action may also appear on messages without links;
clicking it simply explains that one link is required.

This uses the native Talk 35 JavaScript API; it is not a verified browser test
on the owner's target server. After installing the bridge, verify the action
in an actual non-classified Talk conversation and confirm the destination in
Files. A fresh user who has no /Downloads folder must still be able to submit
using their implicit default destination; the signed ExApp creates that folder
only when its default is Downloads. Explicit paths must already exist.


## Header display and personal preferences

Personal settings → **Downloader** provides a default Files destination,
video/audio quality defaults, notification preferences, Files connection,
and header display preferences. Existing legacy user preset records are
left untouched in Nextcloud user storage, but cannot be selected, created,
edited, or applied. The download dialog contains Quality and Audio only;
the signed submission derives engine/format directly from those choices.

The downloads arrow appears only while a download is active by default;
choose **Always show** to keep it visible when idle without a progress
frame. Its dropdown can show only active jobs or active jobs followed by
finished history. Library history stays independent.

## Link-first content inspection (issue #138)

The shared Nextcloud Files/Talk/Viewer/header dialog opens with a single URL field
and no submission button. After pasting, the signed ExApp sends a bounded request
to **Core's existing** `POST /api/v1/preview` yt-dlp extractor (24 entries
initially; maximum 100), which retains Core's URL, DNS and egress protections.
No separate browser-side engine and no preset catalog are used.

Single-video and audio previews offer quality, Audio only (video), and advanced
container/subtitle choices. yt-dlp playlists use its supported
`allow_playlist`/`playlist_items` selection contract. A recognized channel
can progressively re-request bounded prefixes (24 entries per step, at most 100)
and offers a multi-select gallery with placeholder tiles when Core does not
provide thumbnails. Exact newest-first ordering requires extractor timestamps,
which are **not** exposed by the current Core preview. Bounded-prefix requests
are not genuine offset pagination.

The present Core preview does not provide gallery-dl album/manga metadata,
chapter covers, CBZ packaging, torrent file metadata, or HTTP direct-file
headers. These are shown as unsupported or unavailable rather than inventing
entries, file sizes, or thumbnails. A link with an apparent direct-file
extension can be explicitly tried with Core's generic engine, but its MIME
and size remain unverified. Torrent selection and CBZ packaging are blocked
when unsupported. The existing Core preview also does not expose a live
broadcast flag, so live badges only appear if an extractor provides one.

**Torrent seeding inspection:** `app/adapters/aria2.py` does not set a
`seed-time` startup default, and the Core admin/API can accept nonzero
overrides. The signed Nextcloud ExApp now overrides `seed-time=0` on
aria2 submissions (including magnet links), which aria2 documents as disabling
seeding once complete. Zero `seed-ratio` is **not** the disable switch.
This is not a guarantee for direct Core administrator submissions. Core-owned
server-level enforcement must be addressed separately before claiming the
whole instance is incapable of seeding.

## Downloads header and compact layouts

The header uses a fixed-width, transparent **down-arrow icon** matching the
neighbouring Nextcloud actions, with a numbered unfinished-download badge.
When there are active jobs, a thin rounded-square border sweeps from
bottom-centre in the header's foreground colour. The border aggregates
progress across all unfinished jobs by the download/extraction/delivery
stages; progress is not written as text in the header. With no active jobs,
the default personal setting hides the button while keeping the header slot
stable, so neighbouring icons do not jump. The optional always-show setting
leaves the arrow visible without the border when idle.

Clicking the arrow opens a compact square-edged popover. Its small **+**
opens the same download confirmation dialog as the Files action. Each row
uses a small verified-file thumbnail (or type icon), title/subtitle, a
percentage, and a subtle progress fill. The Personal settings **Dropdown
content** choice controls active-only vs active-first with finished history
ordered by finish timestamp. A separate native Library page retains the
full download history, regardless of this choice.

Dashboard and Library rows are compact by default. Their bold vertical
**⋮** overflow control sits at the row edge without a surrounding box;
actions remain in an accessible menu rather than occupying separate
full-size buttons.

**Pause limitation:** the currently deployed Core/ExApp action contract
exposes cancel, retry and redeliver, but no pause/resume operation. The row
retains the requested **Ⅱ** icon, disabled with an explicit explanation for
active jobs, rather than making cancellation look like a reversible pause.
The API must gain true suspend/resume before this action can be enabled.
No production Nextcloud instance was used for these changes.
