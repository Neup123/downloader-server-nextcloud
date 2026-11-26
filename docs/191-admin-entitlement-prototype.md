# Administrator entitlement directory picker — prototype decision record

Status: **HTML-only mock; no Nextcloud API, backend writes, or production deployment.**
Tracking: [issue #191](https://github.com/Neup123/downloader-server-nextcloud/issues/191)
Prototype: [nextcloud-admin-entitlements.html](../prototypes/nextcloud-admin-entitlements.html)

## Existing boundary and reason

`nextcloud_exapp/main.py::enabled_handler` registers two AppAPI declarative
string fields (`allowed_users`, `allowed_groups`). The ExApp's
`nextcloud_exapp/user.py::entitlement` grants access only to an exact
allowlisted user or one of the user's verified group memberships. It
**fails closed** when membership cannot be retrieved. That server-side
entitlement logic remains authoritative.

The operator cannot reasonably discover internal IDs from the current two
free-text inputs. Typing one wrong character silently denies the intended
person. The ordinary path therefore needs a Nextcloud-directory-backed
picker; manually typed IDs belong behind advanced diagnostics, not as a
regular control.

## Prototype interactions and states

- Two separate frames: **individual access** and **group-based access**;
  they produce the same underlying entitlement concepts as the current
  `allowed_users` / `allowed_groups`, rather than inventing a second ACL.
- One search field over people and groups, an explicit filter, and inline
  **checkboxes** to add/remove entitlement. The checkbox reflects the
  current state; removals are also possible from compact chips.
- Directory results carry a human-readable name, a category, and minimal
  context. Internal IDs appear only behind an **Advanced** disclosure.
- Membership in an allowed group remains dynamic: the user is not stored
  separately just because they currently belong to the group.
- An explicit **Save access changes** applies the edited set because
  changing access is consequential and spans several controls; a visible
  unsaved state and **Discard** avoid silent permission changes.
- Empty/no-results messaging, dark mode, responsive narrow layout,
  visible focus, Tab/Space controls, synthetic RTL toggle, and a
  demonstration-only save receipt are represented in one HTML file.

All names, IDs and group sizes are synthetic. The demo intentionally uses
no authentication, Nextcloud SDK, ExApp API calls or persistent
browser storage. The external Tailwind CDN script may be fetched when the
prototype opens; no actual user records or credentials are embedded in the demo. Save changes only to in-memory test data. A browser reload
restores the baseline. An actual query error, user deletion, directory
pagination, delegated administrators, ACL conflicts and real native i18n
are **not** simulated and must be designed and tested during implementation.

## Architecture / release gate

1. Confirm the actual Nextcloud 35 AppAPI declarative-settings widget
   capabilities and the permissions of any available directory search
   endpoint. Do **not** assume a declarative field supports custom chips.
2. Prefer the native admin surface only if AppAPI cannot express the
   selection control. A signed admin ExApp endpoint must perform the
   directory query and entitlement save; the browser never gets the
   Core administrator token. Reject unverified IDs before saving.
3. Preserve the one authoritative `allowed_users` /
   `allowed_groups` config and existing `require_admin` / `entitlement`
   checks. Do not create a parallel entitlement writer or fall back
   to broad access on directory failure. Search must be bounded and
   cannot return private user attributes not necessary for selection.
4. The current mock **is not a proposed production implementation**.
   Owner reviews actual mobile/desktop, dark/light, keyboard and RTL
   behavior before code is connected to real permissions. Follow with
   a disposable real Nextcloud AppAPI + browser acceptance and access-denial
   regression before release.

Why a single mock now: the existing UI standard is prototype-first, and
getting the permission-management interaction right without backend
changes is cheaper and safer than simultaneously redesigning it and
mutating production access policy.
