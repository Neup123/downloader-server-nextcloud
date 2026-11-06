# Standalone Compose + official External Sites fallback

Use this route only when the actual Nextcloud target cannot use AppAPI with a
working Deploy Daemon. The preferred per-user route remains the ExApp in
[NEXTCLOUD_PER_USER_INSTALL.md](NEXTCLOUD_PER_USER_INSTALL.md).

The fallback is **one independently released downloader core container**, behind
the same kernel-level egress guard as the primary deployment, plus a link
created with Nextcloud's **official External Sites** app. No PHP bridge, ExApp,
direct data-directory writes, modified Nextcloud code, or custom downloader
engine is needed. The Nextcloud source repository remains unchanged.

**Capabilities differ:** External Sites embeds a separate website. It does
not authenticate to Downloader as the current Nextcloud user, provide per-user
Files destinations or entitlements, or supply native Files/Viewer actions,
notifications, Activity or Talk actions. The standalone UI uses its own API
token, which is visible to the browser after the operator enters it. Restrict
the External Sites link and access to the embedded site to trusted operators.
Do **not** give every Nextcloud user a shared administrator API token. If
individual users require isolated jobs, use the AppAPI integration instead.

## 1. Deploy the existing standalone core — not a second instance

If the independently installed core already works, **reuse it**. Do not run
this Compose file as a second instance: a second worker against the same
SQLite database/volume or a second binding of port 8080 would be unsafe.
Skip to step 2 and reuse the core's existing authenticated HTTPS UI URL.

For a fresh fallback installation, copy the inherited `.env.example` to a
private `.env`, generate a long random APP_API_TOKEN, and generate a stable
APP_ENCRYPTION_KEY with Fernet. Back up both securely and keep the key across
upgrades; changing the Fernet key invalidates stored WebDAV credentials.
Use a persistent volume named `downloader-server-egress-data`, consistent
with the guarded core Compose deployment. **Never** use `down --volumes`
when retaining downloaded data.

From this Nextcloud adaptation repository, using a Linux Docker engine with
working `NET_ADMIN`, iptables and ip6tables:

```sh
cp .env.example .env
# Edit .env with strong APP_API_TOKEN and APP_ENCRYPTION_KEY values.
docker pull ghcr.io/neup123/media-downloader-server:0.3.0
docker compose --env-file .env -f compose.external-sites.yaml build egress-guard
docker compose --env-file .env -f compose.external-sites.yaml up -d --no-build --wait
docker compose --env-file .env -f compose.external-sites.yaml ps
curl --fail http://127.0.0.1:8080/healthz
```

The Docker image is the standalone core, not the ExApp. The egress sidecar
must be healthy before the downloader starts. Both containers share the
guarded network namespace; media engines do not receive `NET_ADMIN`.
The guard rejects private, local and metadata destinations, including
Docker-private Nextcloud URLs. Never set
`ALLOW_PRIVATE_TARGETS`, `ALLOW_PRIVATE_WEBDAV_TARGETS` or
`ALLOW_INSECURE_WEBDAV` to true in this deployment.

**WSL/Docker Desktop and other kernels still need actual policy acceptance.**
A healthy container alone does not prove kernel isolation for all engines.

## 2. Configure an authenticated public HTTPS URL

A browser must be able to open the **same HTTPS origin** that will be
registered as an External Site. Route an existing authenticated TLS reverse
proxy to the core's loopback-bound port. If the proxy runs in another
container, localhost inside that container is **not** the host's localhost;
configure a reviewed, reachable network route without exposing the core
directly to the internet. Keep port 8080 on loopback unless a separate,
trusted network binding and access control are explicitly in place.

Open the HTTPS address directly and verify that the standalone UI loads and
can authenticate with APP_API_TOKEN. Confirm that both the HTML and its
JavaScript assets work when reached through the exact configured URL.
If an iframe is denied by the proxy's `Content-Security-Policy:
frame-ancestors` or `X-Frame-Options`, change only the **downloader UI**
framing policy to allow the actual Nextcloud HTTPS origin if the deployment's
threat model permits it. Do not disable Nextcloud's own protections.
Some browser privacy extensions may still prevent embedding.

## 3. Set generic WebDAV delivery (one trusted account)

In the standalone Downloader administrator UI, set **Delivery** to WebDAV:
use an existing dedicated Nextcloud user and app password, with an HTTPS
endpoint like `https://cloud.example.org/remote.php/dav/files/USERNAME`
and an existing writable destination folder. The core must reach this public
HTTPS origin from inside the egress-guard namespace, not only from the
operator's browser. Do not use a Docker-only hostname, LAN address, or
plain HTTP to bypass the guard. Check the downloaded file in Nextcloud Files
and compare the source's expected size/hash where available.

The fallback delivers to the configured **single** account. It does not
automatically switch credentials or folders based on which Nextcloud user
clicked the External Sites navigation entry.

## 4. Embed using the official Nextcloud app

In Nextcloud: **Apps → Customization → External sites** (install/enable the
official app), then **Settings → Administration → External sites**:

1. Add an entry named `Downloader` pointing to the verified public HTTPS
   URL of the standalone UI.
2. Limit visibility to an explicit trusted group, and configure it to be
   embedded in the main page (not a redirect) if the browser and reverse
   proxy allow safe framing.
3. Reload Nextcloud and open Downloader from its navigation. If the browser
   rejects framing, select the official **redirect** option instead; do not
   weaken Nextcloud's security headers.
4. Authenticate in the standalone UI and submit an authorized test download;
   verify job progress, completion, and WebDAV delivery in Files.

This uses the documented External Sites administrator UI; no direct database
mutation or unsupported `occ` command is required.

## 5. Acceptance and recovery

Record separately: Compose guard healthy, web UI reachable through HTTPS,
embedded or redirected Nextcloud navigation entry, core API authentication,
job submission, persisted history across a restart, WebDAV folder creation,
remote file size/hash and readable file, and a deliberately failed delivery
that remains visible with an actionable error.

Failures of iframe embedding do not prevent the redirect fallback. An absent
or untrusted TLS endpoint, a private-only WebDAV destination, or shared token
exposure to ordinary Nextcloud users blocks deployment until resolved. If
AppAPI later becomes available, follow the ExApp install guide and **reuse**
the already running core instead of starting a duplicate service.

References: [Nextcloud External Sites administration guide](https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/external_sites.html);
[official External Sites app](https://apps.nextcloud.com/apps/external);
[Nextcloud AppAPI](https://docs.nextcloud.com/server/stable/admin_manual/exapps_management/AppAPIAndExternalApps.html).
