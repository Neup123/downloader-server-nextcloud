# Unsupported legacy approach — do not deploy

This document previously described embedding a standalone Downloader web page
using Nextcloud External Sites. That approach is **not supported** by the
Downloader Nextcloud product.

The product requires all user-facing Downloader UI inside Nextcloud. External
Sites embedding/redirects would expose a separate website, bypass native
personal settings and per-user identity boundaries, and risk revealing
shared administrator API credentials.

Install the AppAPI ExApp and matching native PHP bridge using
[NEXTCLOUD_PER_USER_INSTALL.md](NEXTCLOUD_PER_USER_INSTALL.md). If AppAPI or the
bridge is unavailable, report the deployment as blocked. Do not link users or
administrators to the standalone Core UI from within Nextcloud.
