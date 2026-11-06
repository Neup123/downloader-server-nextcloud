# Install Downloader Server Nextcloud v0.1.0 on a real instance

This release uses **two** services: standalone Downloader Server
(`ghcr.io/neup123/media-downloader-server:0.1.0`) and the thin AppAPI ExApp
(`ghcr.io/neup123/downloader-server-nextcloud:0.1.0`). Only the standalone
service downloads media and uploads over WebDAV; the ExApp forwards authenticated
API traffic. Neither component should write to Nextcloud's data directory.

## Prerequisites

- Nextcloud **35**, with `app_api` enabled and a working Docker/HaRP Deploy
  Daemon. Existing other versions require explicit compatibility testing.
- A server-reachable Downloader Server HTTPS origin, or trusted internal HTTP
  with the ExApp's `DOWNLOADER_ALLOW_TRUSTED_HTTP=true` override.
- The standalone core is running behind Linux kernel egress isolation, with
  persistent data volume and a randomly generated server-only `APP_API_TOKEN`.
- GHCR pulls from the deployment host are permitted. If the registry package
  is private, supply a read-only registry credential to the Deploy Daemon.
- A Nextcloud app password with WebDAV access to the intended user's Files.

## Exact, versioned deployment

1. On the **Docker host**, verify both release images are pullable:

   ```sh
   docker pull ghcr.io/neup123/media-downloader-server:0.1.0
   docker pull ghcr.io/neup123/downloader-server-nextcloud:0.1.0
   ```

2. Start the core from the core repository's guarded `compose.egress.yaml`
   with `DOWNLOADER_IMAGE=ghcr.io/neup123/media-downloader-server:0.1.0`.
   Build the `egress-guard` sidecar first; use `up -d --no-build`.
   Test the core health endpoint from the same network as the ExApp.

3. In Nextcloud, enable AppAPI and select a **tested** Deploy Daemon under
   Administration → AppAPI. On a host with CLI access:

   ```sh
   docker exec --user www-data NEXTCLOUD_CONTAINER php occ app:enable app_api
   docker exec --user www-data NEXTCLOUD_CONTAINER php occ app_api:daemon:list
   ```

   Run the daemon's **Test Deploy** in the administration UI. Do not assume
   that a disposable GitHub Actions pass covers this host's daemon or network.

4. Download `appinfo/info.xml` from the tagged **Nextcloud v0.1.0 release**.
   In the administration AppAPI UI register the ExApp using that manifest,
   select the tested daemon, and supply these values **server-side**:

   - `DOWNLOADER_API_URL`: core API origin reachable from the ExApp.
   - `DOWNLOADER_API_TOKEN`: the exact core `APP_API_TOKEN` (never browser JS).
   - `DOWNLOADER_ALLOW_TRUSTED_HTTP`: `true` only for isolated internal HTTP.

   Alternatively, on a host with an existing `occ` and daemon named
   `DEPLOY_DAEMON`, register via:

   ```sh
   docker cp appinfo/info.xml NEXTCLOUD_CONTAINER:/tmp/downloader-info.xml
   docker exec --user www-data -it NEXTCLOUD_CONTAINER php occ app_api:app:register \
     downloader-server-nextcloud DEPLOY_DAEMON --info-xml /tmp/downloader-info.xml \
     --env "DOWNLOADER_API_URL=https://YOUR-CORE-ORIGIN" \
     --env "DOWNLOADER_API_TOKEN=YOUR-SECRET" --wait-finish
   docker exec --user www-data NEXTCLOUD_CONTAINER php occ app_api:app:enable downloader-server-nextcloud
   ```

   Avoid entering a real token in shell history or shared terminals; the
   administration UI is preferable for secrets.

5. Configure the core's **WebDAV delivery** to your Nextcloud Files using an
   app password. Never point the core at a mounted Nextcloud data directory.
   Verify a real download, WebDAV upload, and the resulting file in Files.
   Use `python3 scripts/target_readiness.py` with `--write-test` to confirm
   a controlled temporary WebDAV upload/readback to the actual instance.

## Current scope

The initial v0.1.0 app is still administrator-scoped. Per-user entitlement,
personal settings, Files/Viewer actions, progress and notification integration
are the next upgrade and must not be claimed as present in this baseline.
