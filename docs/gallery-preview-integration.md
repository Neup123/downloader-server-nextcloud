# Explicit flat-gallery preview integration

Core PR #231 extends the existing authenticated preview endpoint with
`engine: "gallery-dl"`. The signed Nextcloud ExApp forwards that additive
selector and the existing bounded source-order window. Default callers
continue to omit the selector and receive yt-dlp previews. The gateway accepts
only the declared extractor names and does not accept caller identity, cookies
or arbitrary engine options in preview requests. It verifies the gallery
response's extractor and list kind so an older Core that ignores the selector
cannot silently impersonate gallery-dl.

Core owns the stricter gallery paging bound, DNS and extractor policy. This
does not replace host egress enforcement. The signed gateway acceptance step
in `.github/workflows/appapi-docker-deploy-e2e.yml` exercises Alice's real
AppAPI entitlement, Bob's denial, exact window forwarding to the deterministic
Core fixture, invalid fields and older-Core compatibility. It does not fetch a
real gallery or submit a download. No new native UI or selection behavior is
enabled yet. The UI must wait for compatible signed submission and honest
source-identity semantics before offering a selected-file download.

Installation: use a compatible Core containing #231 and the accepted ExApp
build. No additional secrets, containers or settings are needed. Test the
existing signed gateway and verify that gallery responses identify their real
extractor. A failing preview does not imply a successful download.
