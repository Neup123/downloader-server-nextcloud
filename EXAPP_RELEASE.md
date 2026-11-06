# Downloader Server Nextcloud ExApp — image provenance

The released AppAPI manifest uses the pullable image `ghcr.io/neup123/downloader-server-nextcloud:0.1.0`. The separately published `sha-<commit>` tags remain available for per-commit diagnostics. Release v0.1.0 is a first installable baseline; real-target installation is not asserted without operator checks.

## How images are published

A successful **push to `main`** which triggers
`Disposable AppAPI Docker ExApp deployment acceptance` can publish a Docker
image *only after that workflow succeeds*. The publishing workflow checks that
the triggering event was a push to this same repository's `main` branch,
checks out the exact accepted source commit, verifies that commit is still
reachable from `main`, builds the standalone ExApp image, and verifies its
importable bridge and frontend assets.

The image reference is `ghcr.io/neup123/downloader-server-nextcloud:sha-<40-char-commit>`.
The publisher never overwrites a pre-existing SHA tag. It pulls the tagged
image back from GHCR, validates its source-revision label, resolves the
registry OCI digest, then pulls that digest to verify the actual published
binary's source identity. The workflow artifact named
`downloader-exapp-provenance-<commit>` contains:

- `info.xml`: an AppAPI manifest targeting the exact source-commit tag;
- `image-provenance.json`: the source SHA, tag, digest-addressed OCI image
  reference and XML SHA-256 checksum.

The GitHub Actions `GITHUB_TOKEN` needs `packages: write` access to the
repository's GHCR package. If an existing GHCR package is unlinked from this
repository, GitHub may reject the upload; **do not bypass** it by inserting a
personal access token into source code. Use GitHub package access settings.

The image's source/build inputs are **not fully digest-locked** (base-image
tags and some transitive packages remain mutable). Separate CI acceptance
rebuilds from the same source SHA, but that is not a bit-for-bit reproducible
image guarantee. Use the OCI digest from the record to inspect the published
artifact itself.

## Important AppAPI limitation

The standard AppAPI Docker install path currently constructs image references
as `registry/image:tag` (see
[Nextcloud AppAPI DockerActions.php](https://github.com/nextcloud/app_api/blob/3f0ef8ed2823be8b50982aa7c5e2d70e3c9b7d03/lib/DeployActions/DockerActions.php#L434-L437)).
The `info.xml` tag is source-addressed, but **is not a digest pin**. The
provenance JSON supplies a separate pull-by-digest reference, for example:

```sh
docker pull ghcr.io/neup123/downloader-server-nextcloud@sha256:<64-hex-digest>
```

Do not substitute `@sha256` into `<image-tag>` and claim that AppAPI will
interpret it as an OCI digest. Native digest-addressed ExApp deployment would
require documented Nextcloud AppAPI support or a separately verified deploy
mechanism.

## Real target deployment and follow-up

This workflow does not install the ExApp on the user's Nextcloud server. The
actual Nextcloud version, AppAPI/HaRP Deploy Daemon, administrator Test Deploy,
Docker registry authentication, service origin/TLS and WebDAV delivery must
first be checked as tracked by issue #19. The core downloader is not approved
for untrusted users until network egress restrictions have been proven
(`Media-Downloader-server` issue #72). ExApp routes are limited to Nextcloud
administrators, and core API tokens must remain server-side.

If digest publication fails, preserve the previous image by digest; never
silently republish a different binary under a previously issued SHA tag.
