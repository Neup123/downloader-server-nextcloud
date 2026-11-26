"""Real Chromium acceptance against disposable Nextcloud 35 + installed native PHP bridge.

Runs after the AppAPI signed gateway fixture has provisioned/entitled Alice and
completed one download. The Core is a deterministic mock; no live remote media
or production Nextcloud is contacted. Failures retain redacted page screenshots.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BROWSER_ACCEPTANCE_BASE", "http://127.0.0.1:8099").rstrip("/")
ARTIFACTS = Path(os.environ.get("BROWSER_ACCEPTANCE_ARTIFACTS", "browser-evidence"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def capture(page, name: str) -> None:
    page.screenshot(path=str(ARTIFACTS / name), full_page=True, animations="disabled")


def in_viewport(page, selector: str) -> None:
    box = page.locator(selector).first.bounding_box()
    assert box is not None, f"{selector} has no rendered bounding box"
    size = page.viewport_size
    assert size
    assert box["width"] > 10 and box["height"] > 10, (selector, box)
    assert box["x"] >= -1 and box["y"] >= -1, (selector, box)
    assert box["x"] + box["width"] <= size["width"] + 1, (selector, box, size)


def login(page) -> None:
    page.goto(BASE + "/login", wait_until="domcontentloaded")
    page.locator("input#user, input[name='user']").first.fill("alice")
    page.locator("input#password, input[name='password']").first.fill(
        os.environ["NEXTCLOUD_APP_PASSWORD"]
    )
    page.locator("button[type='submit'], input[type='submit']").first.click()
    page.wait_for_url(lambda url: "/login" not in url, timeout=45_000)
    assert "login" not in page.url, "Browser did not authenticate into disposable Nextcloud"
    # The disposable Docker default has no pretty-URL rewrite rules. Use the
    # server's normal index.php router for Files, settings and custom apps.
    page.goto(BASE + "/index.php/apps/files/", wait_until="domcontentloaded")
    assert "/login" not in page.url, "Browser session did not survive the first page navigation"
    dismiss_initial_welcome(page)



def dismiss_initial_welcome(page) -> None:
    """Nextcloud shows a first-login introduction once per disposable user."""
    welcome = page.get_by_text("A collaboration platform that puts you in control", exact=True)
    if not welcome.count() or not welcome.is_visible():
        return
    selectors = (
        "button[aria-label='Close']",
        "button[title='Close']",
        ".modal-container button.close",
        ".modal-container .modal__close",
    )
    for selector in selectors:
        item = page.locator(selector)
        if item.count() and item.first.is_visible():
            item.first.click()
            break
    if welcome.is_visible():
        page.keyboard.press("Escape")
    assert not welcome.is_visible(), "First-login welcome dialog blocks native UI click testing"


def check_library(page) -> None:
    response = page.goto(BASE + "/index.php/apps/downloader_bridge/library", wait_until="domcontentloaded")
    assert response and response.status < 400, f"Native Library HTTP {response.status if response else 'no response'}"
    root = page.locator("#downloader-library-app")
    expect(root).to_be_visible(timeout=25_000)
    # Real signed ExApp API and delivery fixture already verified a terminal job.
    expect(root.locator(".library-controls")).to_be_visible(timeout=25_000)
    expect(root.locator(".library-list")).to_be_visible()
    expect(root.get_by_role("link", name="My settings")).to_be_visible()
    in_viewport(page, "#downloader-library-app h1")
    capture(page, "01-library-desktop.png")
    name = root.locator(".library-controls input")
    if name.count():
        name.first.focus()
        assert name.first.evaluate("(el) => document.activeElement === el")
        name.first.fill("fixture")
        name.first.fill("")
    page.keyboard.press("Tab")
    assert page.evaluate("document.activeElement !== document.body")


def check_settings(page) -> None:
    page.goto(BASE + "/index.php/settings/user/downloader", wait_until="domcontentloaded")
    root = page.locator("#downloader-settings-app")
    expect(root).to_be_visible(timeout=30_000)
    expect(root.locator(".downloader-settings-grid")).to_be_visible(timeout=30_000)
    expect(root.get_by_text("Destination routing by content type")).to_be_visible()
    assert root.locator("input, select, button").count() >= 4
    # #162: one content-hugging routing group, default folder first, each
    # field followed by adjacent browse/reset icons rather than stacked buttons.
    routing = root.locator(".downloader-routing-list")
    expect(routing).to_be_visible()
    rows = routing.locator(".downloader-route-item")
    expect(rows).to_have_count(7)
    expect(rows.first.locator(".downloader-route-label")).to_have_text("Default Files folder")
    for row in rows.all():
        field = row.locator("input.downloader-route-field")
        actions = row.locator(".downloader-route-controls")
        choose = actions.get_by_role("button", name="Choose folder")
        reset = actions.get_by_role("button", name="Use default")
        expect(field).to_be_visible()
        expect(choose).to_have_attribute("title", "Choose folder")
        expect(reset).to_have_attribute("title", "Use default")
        field_box, action_box = field.bounding_box(), actions.bounding_box()
        assert field_box and action_box, "Folder input or compact toolbar not rendered"
        assert action_box["x"] >= field_box["x"] + field_box["width"] - 1, "Folder actions fell under the field"
        assert abs(action_box["y"] - field_box["y"]) <= 8, "Folder actions are not aligned to their field"
    capture(page, "02-personal-settings.png")

    # #154: inspect the real Advanced cookie-vault list/toolbar layout.
    advanced = root.locator("details.downloader-advanced")
    expect(advanced).to_be_visible()
    advanced.locator("summary").click()
    vault = root.locator("#downloader-site-cookies")
    expect(vault).to_be_visible()
    expect(vault.get_by_role("listbox", name="Saved site cookies")).to_be_visible()
    for name in ("Add site cookies", "Remove selected site cookies",
                 "Move selected site cookies up", "Move selected site cookies down"):
        expect(vault.get_by_role("button", name=name)).to_be_visible()
    expect(vault.get_by_role("button", name="Reset cookies to default")).to_be_visible()
    expect(vault.get_by_role("link", name="Get cookies.txt LOCALLY")).to_be_visible()
    vault.get_by_role("button", name="Add site cookies").click()
    expect(vault.get_by_placeholder("example.com")).to_be_focused()
    # Exercise the full existing UI with harmless synthetic cookie data;
    # the real signed AppAPI gateway forwards to the isolated metadata-only
    # mock Core. No real session, browser export or external site is used.
    site = vault.get_by_placeholder("example.com")
    paste = vault.get_by_placeholder("# Netscape HTTP Cookie File")
    save = vault.get_by_role("button", name="Save site cookies")
    for domain in ("alpha.example", "beta.example"):
        vault.get_by_role("button", name="Add site cookies").click()
        site.fill(domain)
        paste.fill("# Netscape HTTP Cookie File\n" + domain +
                   "\tFALSE\t/\tFALSE\t0\tfixture\tSYNTHETIC_ONLY")
        with page.expect_response(
            lambda response: "/user/api/cookies/" in response.url
            and response.request.method == "PUT", timeout=30_000
        ) as saved_cookie:
            save.click()
        assert saved_cookie.value.status == 200
        expect(vault.get_by_role("option", name="Select site cookies for " + domain)).to_be_visible()
        expect(paste).to_have_value("")
    rows = vault.get_by_role("option")
    expect(rows).to_have_count(2)
    expect(rows.nth(0)).to_contain_text("alpha.example")
    expect(rows.nth(1)).to_contain_text("beta.example")
    expect(rows.nth(0)).to_contain_text("Saved · validity not tested")
    expect(rows.nth(1)).to_contain_text("Saved · validity not tested")
    rows.nth(1).click()
    expect(site).to_have_value("beta.example")
    expect(paste).to_have_value("")
    vault.get_by_role("button", name="Move selected site cookies up").click()
    expect(rows.nth(0)).to_contain_text("beta.example")
    vault.get_by_role("button", name="Move selected site cookies down").click()
    expect(rows.nth(0)).to_contain_text("alpha.example")
    capture(page, "10-cookie-vault-settings.png")
    with page.expect_response(
        lambda response: "/user/api/cookies/" in response.url
        and response.request.method == "DELETE", timeout=30_000
    ) as removed_cookie:
        vault.get_by_role("button", name="Remove selected site cookies").click()
    assert removed_cookie.value.status == 200
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("alpha.example")
    with page.expect_response(
        lambda response: "/user/api/cookies/" in response.url
        and response.request.method == "DELETE", timeout=30_000
    ) as reset_cookie:
        vault.get_by_role("button", name="Reset cookies to default").click()
    assert reset_cookie.value.status == 200
    expect(rows).to_have_count(0)
    expect(vault.get_by_text("Not set — no site cookies saved.", exact=True)).to_be_visible()
    print("Real Chromium: signed cookie vault add/select/reorder/remove/reset PASS", flush=True)
    # A real signed autosave must survive a fresh page load. Source-pattern
    # assertions and a mock fetch promise do not establish persistence.
    failure_notice = root.get_by_label("Notify me if a download fails")
    expect(failure_notice).to_be_visible()
    originally_checked = failure_notice.is_checked()
    with page.expect_response(
        lambda response: response.url.endswith("/user/api/settings")
        and response.request.method == "PUT", timeout=30_000
    ) as saved:
        if originally_checked:
            failure_notice.uncheck()
        else:
            failure_notice.check()
    assert saved.value.status == 200, "Native settings autosave was rejected"
    expect(root.locator(".downloader-save-status")).to_contain_text("Saved", timeout=20_000)
    page.reload(wait_until="domcontentloaded")
    root = page.locator("#downloader-settings-app")
    expect(root).to_be_visible(timeout=30_000)
    expect(root.get_by_label("Notify me if a download fails")).to_be_checked() if not originally_checked else expect(
        root.get_by_label("Notify me if a download fails")
    ).not_to_be_checked()
    capture(page, "13-personal-settings-persisted.png")
    # Restore the disposable user's original preference so later browser
    # journeys do not depend on the test order.
    restored = root.get_by_label("Notify me if a download fails")
    with page.expect_response(
        lambda response: response.url.endswith("/user/api/settings")
        and response.request.method == "PUT", timeout=30_000
    ) as restored_save:
        if originally_checked:
            restored.check()
        else:
            restored.uncheck()
    assert restored_save.value.status == 200
    print("Real Chromium: signed autosave persisted across full Nextcloud reload PASS", flush=True)



def check_header_and_dialog(page) -> None:
    page.goto(BASE + "/index.php/apps/files/", wait_until="domcontentloaded")
    header = page.locator("#downloader-topbar-progress")
    expect(header).to_be_attached(timeout=30_000)
    trigger = header.locator("button.dl-trigger")
    expect(trigger).to_be_visible(timeout=20_000)
    trigger.focus()
    assert trigger.evaluate("(el) => document.activeElement === el")
    page.keyboard.press("Enter")
    popover = page.locator("#downloader-header-popover")
    expect(popover).to_be_visible()
    expect(trigger).to_have_attribute("aria-expanded", "true")
    capture(page, "03-files-native-progress-popover.png")
    popover.get_by_role("button", name="Add a download").click()
    modal = page.locator("dialog.dl-link-dialog")
    expect(modal).to_be_visible()
    source = modal.get_by_role("textbox", name="Source link")
    expect(source).to_be_focused()
    source.fill("not a URL")
    expect(modal.locator(".dl-detect-status")).to_be_visible(timeout=15_000)
    capture(page, "04-invalid-link-explanation.png")
    page.keyboard.press("Escape")
    expect(modal).to_have_count(0)
    # Header interaction is keyboard-operable without a mouse.
    trigger.focus()
    page.keyboard.press("Enter")
    expect(popover).to_be_visible()
    page.keyboard.press("Escape")
    expect(popover).to_be_hidden()
    expect(trigger).to_be_focused()



def check_subtitle_layout(page) -> None:
    """#166: use an intercepted deterministic media preview, real native DOM/CSS."""
    import json

    # No actual download or untrusted network call: only media preview metadata
    # is mocked. The native dialog itself is loaded from disposable Nextcloud.
    fixture = {
        "kind": "video", "title": "Browser fixture clip",
        "formats": [{"format_id": "x", "ext": "mp4", "vcodec": "avc1", "acodec": "mp4a"}],
        "subtitle_languages": [],
    }

    def preview(route):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(fixture))

    page.route("**/user/api/media-preview", preview)
    header = page.locator("#downloader-topbar-progress")
    expect(header.locator("button.dl-trigger")).to_be_visible()
    header.locator("button.dl-trigger").click()
    page.locator("#downloader-header-popover .dl-popover-add").click()
    dialog = page.locator("dialog.dl-link-dialog")
    expect(dialog).to_be_visible()
    source = dialog.get_by_role("textbox", name="Source link")
    source.fill("https://example.org/watch?v=browserfixture")
    advanced = dialog.locator("details.dl-options")
    expect(advanced).to_be_visible(timeout=20_000)
    advanced.locator("summary").click()
    frame = advanced.locator("fieldset.dl-subtitles-frame")
    expect(frame).to_be_visible()
    expect(frame.locator("legend")).to_have_text("Subtitles")
    expect(frame.get_by_text("No subtitles available.")).to_be_visible()
    language = frame.get_by_label("Subtitle language")
    expect(language).to_be_disabled()
    fmt = advanced.get_by_label("Format")
    expect(fmt).to_be_visible()
    fb, sb = fmt.bounding_box(), frame.bounding_box()
    assert fb and sb, "Format or subtitle frame is not visible"
    assert fb["x"] >= sb["x"] + sb["width"] - 1, "Format not to the right of subtitle frame"
    assert abs(fb["y"] - sb["y"]) < 45, "Format is not top-aligned"
    capture(page, "08-subtitles-unavailable-desktop.png")

    fixture["subtitle_languages"] = ["en", "fr"]
    source.fill("https://example.org/watch?v=withsubtitles")
    # Changing the link replaces the detected panel and closes Advanced.
    # Wait for the second preview response, then open its new details node.
    expect(dialog.locator("select option[value='fr']")).to_have_count(1, timeout=20_000)
    advanced.locator("summary").click()
    frame = advanced.locator("fieldset.dl-subtitles-frame")
    expect(frame).to_be_visible(timeout=20_000)
    language = frame.get_by_label("Subtitle language")
    expect(language).to_be_disabled()
    frame.get_by_label("Download subtitles").check()
    expect(language).to_be_enabled()
    capture(page, "09-subtitles-available-desktop.png")
    page.keyboard.press("Escape")
    page.unroute("**/user/api/media-preview", preview)


def check_gallery_identity_selector(page) -> None:
    """Real native selection UI; deterministic preview and submission fixture."""
    import json
    ids = ["a" * 64, "b" * 64]
    requests = []
    submissions = []

    def preview(route):
        body = route.request.post_data_json
        requests.append(body)
        if body.get("engine") != "gallery-dl":
            route.fulfill(status=422, content_type="application/json",
                          body=json.dumps({"detail": "unsupported_domain"}))
            return
        entries = [{"index": i + 1, "title": f"Gallery photo {i + 1}",
                    "selection_id": identity, "size_bytes": 1024}
                   for i, identity in enumerate(ids)]
        if "older" in body["url"]:
            for item in entries:
                del item["selection_id"]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({
            "extractor": "gallery-dl", "kind": "playlist", "title": "Gallery fixture",
            "offset": 0, "entries": entries, "has_more": False, "next_offset": None,
        }))

    def submit(route):
        if route.request.method != "POST":
            route.continue_()
            return
        submissions.append(route.request.post_data_json)
        # Deliberately refuse fixture submission so no synthetic job is stored.
        route.fulfill(status=422, content_type="application/json",
                      body=json.dumps({"detail": "Fixture submission captured"}))

    page.route("**/user/api/media-preview", preview)
    page.route("**/user/api/jobs", submit)
    try:
        page.locator("#downloader-topbar-progress button.dl-trigger").click()
        page.locator("#downloader-header-popover .dl-popover-add").click()
        dialog = page.locator("dialog.dl-link-dialog")
        source = dialog.get_by_role("textbox", name="Source link")
        source.fill("https://example.org/gallery/identity")
        grid = dialog.locator(".dl-gallery-grid")
        expect(grid).to_be_visible(timeout=20_000)
        checks = grid.locator("input[type='checkbox']")
        expect(checks).to_have_count(2)
        download = dialog.get_by_role("button", name="Download", exact=True)
        expect(download).to_be_disabled()
        checks.nth(1).check()
        expect(download).to_be_enabled(timeout=20_000)
        expect(dialog.get_by_text("Audio only", exact=True)).to_have_count(0)
        capture(page, "18-gallery-identity-selection.png")
        with page.expect_response(lambda r: r.url.endswith("/user/api/jobs")
                                  and r.request.method == "POST"):
            download.click()
        assert submissions and submissions[-1]["engine"] == "gallery-dl"
        assert submissions[-1]["overrides"] == {"gallery_item_ids": [ids[1]]}
        source.fill("https://example.org/gallery/older")
        expect(dialog.locator(".dl-detect-status")).to_be_visible(timeout=20_000)
        expect(download).to_be_hidden()
        assert any(r.get("engine") == "gallery-dl" for r in requests)
        print("Real Chromium: identity gallery fallback, selection and old Core guard PASS", flush=True)
    finally:
        if page.locator("dialog.dl-link-dialog").count():
            page.keyboard.press("Escape")
        page.unroute("**/user/api/media-preview", preview)
        page.unroute("**/user/api/jobs", submit)


def assert_compact_torrent_folder_totals(picker) -> None:
    # Check real layout, not a CSS source substring. Works in either direction.
    for row in picker.locator("details.dl-torrent-folder > summary").all():
        name = row.locator(".dl-torrent-folder-name")
        total = row.locator(".dl-torrent-folder-size")
        if not name.is_visible() or not total.is_visible():
            continue
        a, b = name.bounding_box(), total.bounding_box()
        assert a and b, "Folder name/total missing layout"
        if a["x"] <= b["x"]:
            gap = b["x"] - (a["x"] + a["width"])
        else:
            gap = a["x"] - (b["x"] + b["width"])
        assert -1 <= gap <= 14, ("Folder total separated from its name", gap)
        box = row.bounding_box()
        assert box and b["x"] >= box["x"] - 1 and (
            b["x"] + b["width"] <= box["x"] + box["width"] + 1
        ), "Folder total overflows its summary"


def check_torrent_selector(page) -> None:
    """#170: real magnet file-selection layout and controls, fixture manifest."""
    import json

    manifest = {"file_count": 3, "files": [
        {"index": 1, "path": "Album/first.mp3", "name": "first.mp3", "size_bytes": 1048576},
        {"index": 2, "path": "Album/second.mp3", "name": "second.mp3", "size_bytes": 2097152},
        {"index": 3, "path": "Cover.jpg", "name": "Cover.jpg", "size_bytes": 1048576},
    ]}

    fail_manifest = False

    def respond(route):
        if fail_manifest:
            route.fulfill(status=422, content_type="application/json",
                          body=json.dumps({"detail": "Fixture metadata unavailable"}))
        else:
            route.fulfill(status=200, content_type="application/json", body=json.dumps(manifest))

    page.route("**/user/api/torrent-manifest", respond)
    trigger = page.locator("#downloader-topbar-progress .dl-trigger")
    expect(trigger).to_be_visible()
    trigger.click()
    page.locator("#downloader-header-popover .dl-popover-add").click()
    dialog = page.locator("dialog.dl-link-dialog")
    expect(dialog).to_be_visible()
    source = dialog.get_by_role("textbox", name="Source link")
    source.fill("magnet:?xt=urn:btih:0123456789012345678901234567890123456789")
    picker = dialog.locator(".dl-torrent-picker")
    expect(picker).to_be_visible(timeout=20_000)
    count = dialog.locator(".dl-torrent-selection .dl-picker-count")
    expect(count).to_contain_text("3 of 3 files selected")
    expect(count).to_contain_text("4.0 MiB total")

    # No redundant upload or Advanced disclosure in a magnet journey.
    expect(dialog.get_by_text("Advanced", exact=True)).to_have_count(0)
    expect(dialog.get_by_role("button", name="Choose .torrent file…")).to_have_count(0)
    expect(dialog.locator("input[type=file]")).to_have_count(0)
    root = picker.get_by_role("checkbox", name="Select files in All files")
    root.uncheck()
    expect(count).to_contain_text("0 of 3 files selected")
    root.check()
    expect(count).to_contain_text("3 of 3 files selected")
    folder = picker.locator("details.dl-torrent-folder").filter(
        has=page.get_by_role("checkbox", name="Select files in Album", exact=True)
    ).last
    heading = folder.locator("summary").first
    expander = heading.locator(".dl-torrent-expander")
    # The CSS chevron rotates over 150 ms; check the actual endpoints rather
    # than sampling computed style on the same frame as the click.
    chevron = expander.element_handle()
    assert chevron is not None
    page.wait_for_function("(el) => new DOMMatrix(getComputedStyle(el).transform).b > 0.70",
                           arg=chevron)
    expander.click()
    expect(folder).not_to_have_attribute("open", "")
    page.wait_for_function("(el) => new DOMMatrix(getComputedStyle(el).transform).b < -0.70",
                           arg=chevron)
    expander.click()
    expect(folder).to_have_attribute("open", "")
    page.wait_for_function("(el) => new DOMMatrix(getComputedStyle(el).transform).b > 0.70",
                           arg=chevron)

    second = picker.locator(".dl-torrent-file").filter(has_text="second.mp3").locator("input")
    second.uncheck()
    expect(count).to_contain_text("2 of 3 files selected")
    assert root.evaluate("(el) => el.indeterminate")
    name_filter = picker.get_by_role("searchbox", name="Filter by file name")
    name_filter.fill("first")
    expect(picker.locator(".dl-torrent-file")).to_have_count(1)
    expect(root).to_be_checked()
    album = picker.get_by_role("checkbox", name="Select files in Album", exact=True)
    expect(album).to_be_checked()
    album.uncheck()
    expect(count).to_contain_text("1 of 3 files selected")
    capture(page, "18-torrent-filtered-scope.png")
    name_filter.fill("")
    assert root.evaluate("(el) => el.indeterminate")
    expect(picker.locator(".dl-torrent-file").filter(has_text="Cover.jpg").locator("input")).to_be_checked()
    # Latest owner round 4 deliberately treats All files as full-manifest
    # selection, unlike individual folders, even under a filter.
    name_filter.fill("first")
    root.check()
    expect(count).to_contain_text("3 of 3 files selected")
    expect(count).to_contain_text("4.0 MiB total")
    name_filter.fill("")
    picker.get_by_role("checkbox", name="jpg", exact=True).uncheck()
    minimum = picker.get_by_placeholder("Min", exact=True)
    minimum.fill("1.5")
    path_filter = picker.get_by_role("searchbox", name="Filter by partial path segment")
    path_filter.fill("Album")
    expect(picker.locator(".dl-torrent-file")).to_have_count(1)
    expect(picker.locator(".dl-torrent-file").first).to_contain_text("second.mp3")
    path_filter.fill("missing")
    expect(picker.get_by_text("No files match the current filter.", exact=True)).to_be_visible()
    path_filter.fill("")
    minimum.fill("")
    picker.get_by_role("checkbox", name="jpg", exact=True).check()
    expect(picker.locator(".dl-torrent-file")).to_have_count(3)
    assert_compact_torrent_folder_totals(picker)
    capture(page, "19-torrent-tree-desktop.png")

    flat = picker.get_by_role("button", name="Flat list")
    flat.click()
    expect(flat).to_have_attribute("aria-pressed", "true")
    expect(picker.locator(".dl-torrent-file")).to_have_count(3)
    order = picker.get_by_role("button", name="Order by")
    order.click()
    picker.get_by_role("menuitemradio", name="Size").click()
    # The menu closes after choice; inspect its retained DOM state, not a
    # hidden-by-default accessibility-tree locator.
    size_option = picker.locator('.dl-torrent-sort-menu [role="menuitemradio"]').filter(has_text="Size")
    expect(size_option).to_have_attribute("aria-checked", "true")
    order.click()
    capture(page, "20-torrent-sort-menu.png")
    picker.get_by_role("menuitemradio", name="Descending (Z–A)").click()
    expect(picker.locator(".dl-torrent-file").first).to_contain_text("second.mp3")
    capture(page, "11-torrent-selector-desktop.png")

    # The primary action must stay inside the visible dialog at a narrow width.
    page.set_viewport_size({"width": 390, "height": 844})
    expect(picker).to_be_visible()
    in_viewport(page, "dialog.dl-link-dialog")
    submit = dialog.get_by_role("button", name="Download", exact=True)
    expect(submit).to_be_visible()
    in_viewport(page, "dialog.dl-link-dialog button.dl-primary")
    assert_compact_torrent_folder_totals(picker)
    capture(page, "12-torrent-selector-mobile.png")
    fail_manifest = True
    source.fill("magnet:?xt=urn:btih:1123456789012345678901234567890123456789")
    expect(dialog.get_by_text("Could not load the torrent file list. Check the magnet link.",
                              exact=True)).to_be_visible(timeout=20_000)
    expect(picker).to_have_count(0)
    expect(submit).to_be_hidden()
    capture(page, "21-torrent-manifest-failure.png")
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1360, "height": 900})
    page.unroute("**/user/api/torrent-manifest", respond)
    print("Real Chromium: torrent filters, selected sizes, root/folder scope and failure controls PASS", flush=True)



def fixture_core_transition(action: str) -> None:
    """Test runner drives only a disposable Docker fixture, never Production."""
    import subprocess
    assert action in {"mark-delivering", "complete-after-dav-readback"}
    script = (
        "import json,os;from urllib.request import Request,urlopen;"
        "url='http://127.0.0.1:8080/fixture/" + action + "';"
        "request=Request(url,method='POST',headers={'X-API-Key':os.environ['MOCK_CORE_TOKEN']});"
        "response=urlopen(request,timeout=20);assert response.status==200;"
        "assert next(iter(json.load(response).values())) is True"
    )
    subprocess.run(
        ["docker", "exec", "downloader-test-core", "python", "-c", script],
        check=True, capture_output=True, text=True, timeout=30,
    )


def verify_disposable_dav_fixture() -> None:
    """Create, upload, and re-read bytes at the route selected by the UI."""
    import base64
    import hashlib
    from urllib.request import Request, urlopen

    data = b"%PDF-1.4\n" + b"Verified disposable Nextcloud fixture\n"
    data += b"X" * (13264 - len(data))
    authorization = "Basic " + base64.b64encode(
        ("alice:" + os.environ["NEXTCLOUD_APP_PASSWORD"]).encode()
    ).decode()
    directory = (BASE + "/remote.php/dav/files/alice/Downloads/"
                 "Direct%20files/ci-first-use-user-job/")
    with urlopen(Request(
        directory, headers={"Authorization": authorization}, method="MKCOL"
    ), timeout=25) as response:
        assert response.status == 201
    with urlopen(Request(
        directory + "dummy.pdf", data=data, method="PUT",
        headers={"Authorization": authorization, "Content-Type": "application/pdf"},
    ), timeout=25) as response:
        assert response.status in (201, 204)
    with urlopen(Request(
        directory + "dummy.pdf", headers={"Authorization": authorization}, method="GET"
    ), timeout=25) as response:
        actual = response.read()
    assert len(actual) == 13264
    assert hashlib.sha256(actual).digest() == hashlib.sha256(data).digest()
    assert actual == data



def check_real_native_job_journey(page) -> None:
    """One real UI POST -> signed ExApp -> mock Core state -> native progress.

    The fixture does not actually download remote media or perform a HEAD.
    Metadata, submission and status polling traverse the real installed
    Nextcloud AppAPI and ExApp, reaching a deterministic mock Core.
    """

    page.goto(BASE + "/index.php/apps/files/", wait_until="domcontentloaded")
    trigger = page.locator("#downloader-topbar-progress .dl-trigger")
    expect(trigger).to_be_visible(timeout=25_000)

    def metadata_response(response):
        return response.url.endswith("/user/api/direct-metadata") and response.request.method == "POST"

    try:
        trigger.click()
        page.locator("#downloader-header-popover .dl-popover-add").click()
        dialog = page.locator("dialog.dl-link-dialog")
        expect(dialog).to_be_visible()
        source = dialog.get_by_role("textbox", name="Source link")
        # No Playwright route interception: the actual signed ExApp proxy
        # must forward both requests with its server-only Core API key.
        with page.expect_response(metadata_response, timeout=30_000) as denied_file:
            source.fill("https://example.test/not-a-file.pdf")
        assert denied_file.value.status == 200
        expect(dialog.get_by_text("Not a direct file", exact=True)).to_be_visible()
        expect(dialog.get_by_role("button", name="Download", exact=True)).to_be_hidden()
        with page.expect_response(metadata_response, timeout=30_000) as verified_file:
            source.fill("https://example.test/dummy.pdf")
        assert verified_file.value.status == 200
        assert verified_file.value.json() == {
            "filename": "dummy.pdf", "mime": "application/pdf", "size": 13264,
        }
        expect(dialog.get_by_text("Name: dummy.pdf", exact=True)).to_be_visible()
        expect(dialog.get_by_text("Type: application/pdf", exact=True)).to_be_visible()
        expect(dialog.get_by_text("Size: 13.0 KiB", exact=True)).to_be_visible()
        expect(dialog.locator(".dl-detect-status")).to_be_hidden()
        capture(page, "17-signed-direct-metadata.png")
        print("Real Chromium: signed direct metadata route and HTML rejection PASS", flush=True)
        download = dialog.get_by_role("button", name="Download", exact=True)
        expect(download).to_be_enabled(timeout=20_000)
        with page.expect_response(
            lambda response: response.url.endswith("/user/api/jobs")
            and response.request.method == "POST", timeout=45_000
        ) as accepted:
            download.click()
        assert accepted.value.status == 202
        queued = accepted.value.json()
        assert queued["id"] == "ci-first-use-user-job"
        assert queued["status"] == "queued"
        expect(dialog).to_have_count(0)
        header = page.locator("#downloader-topbar-progress")
        expect(header).to_contain_text("Queued", timeout=25_000)
        capture(page, "14-native-real-job-queued.png")

        fixture_core_transition("mark-delivering")
        expect(header).to_contain_text("Delivering to your destination", timeout=25_000)
        capture(page, "15-native-real-job-delivering.png")

        # Core cannot claim verification until the actual owner-scoped DAV
        # bytes are read back from the disposable Nextcloud server.
        verify_disposable_dav_fixture()
        fixture_core_transition("complete-after-dav-readback")
        expect(header).to_contain_text("Delivered", timeout=25_000)
        capture(page, "16-native-real-job-completed.png")
        print("Real Chromium: signed UI submit -> queued -> delivering -> verified DAV completion PASS", flush=True)
    finally:
        if page.locator("dialog.dl-link-dialog").count():
            page.keyboard.press("Escape")


def configure_disposable_appearance(*, dark: bool, arabic: bool) -> None:
    """Use Nextcloud 35's supported server settings, not synthetic CSS/dir."""
    import subprocess

    app = "downloader-appapi-nextcloud"
    settings = (("enforce_theme", "dark" if dark else None),
                ("force_language", "ar" if arabic else None))
    for name, value in settings:
        action = ["config:system:set", name, "--value=" + value] if value else [
            "config:system:delete", name
        ]
        subprocess.run(
            ["docker", "exec", "--user", "www-data", app, "php", "occ", *action],
            check=True, capture_output=True, text=True, timeout=35,
        )
    # Read only the non-secret effective language setting. Nextcloud may
    # load additional *.config.php files that override config.php; the
    # normal CLI write succeeding is not evidence that the effective value
    # reaches the web app. Do not dump system config or other credentials.
    system_language = subprocess.run(
        ["docker", "exec", "--user", "www-data", app, "php", "occ",
         "config:system:get", "force_language"],
        check=False, capture_output=True, text=True, timeout=35,
    )
    effective = system_language.stdout.strip() if system_language.returncode == 0 else None
    print("Nextcloud effective force_language: "
          + ("ar" if effective == "ar" else "missing-or-unexpected"), flush=True)
    assert effective == ("ar" if arabic else None), (
        "Effective system language diverged from the test configuration",
        "expected Arabic" if arabic else "expected unforced default",
        "ar" if effective == "ar" else "missing-or-unexpected",
    )
    if arabic:
        # Nextcloud validates a requested language against its installed
        # JSON catalog, not just against the force_language config value.
        # Report only presence, never dump environment or config values.
        for catalog in ("core", "lib"):
            check = subprocess.run(
                ["docker", "exec", app, "sh", "-c",
                 "test -f /var/www/html/" + catalog + "/l10n/ar.json"],
                check=False, capture_output=True, text=True, timeout=35,
            )
            print("Nextcloud " + catalog + " Arabic catalog: "
                  + ("present" if check.returncode == 0 else "missing"),
                  flush=True)
    # Use the documented real Nextcloud per-user locale setting as well.
    # That setting is read for signed-in users independently of the global
    # default/force language; never simulate RTL by editing the DOM.
    subprocess.run(
        ["docker", "exec", "--user", "www-data", app, "php", "occ",
         "user:setting", "alice", "core", "lang", "ar" if arabic else "en"],
        check=True, capture_output=True, text=True, timeout=35,
    )
    value = subprocess.run(
        ["docker", "exec", "--user", "www-data", app, "php", "occ",
         "user:setting", "alice", "core", "lang"],
        check=True, capture_output=True, text=True, timeout=35,
    ).stdout.strip()
    assert value == ("ar" if arabic else "en"), (
        "Nextcloud did not persist the requested user language", value
    )
    # The disposable Apache PHP process can cache system config across
    # requests; reload the same temporary container and preserve its volume.
    import time
    from urllib.request import urlopen
    subprocess.run(
        ["docker", "restart", app],
        check=True, capture_output=True, text=True, timeout=65,
    )
    for attempt in range(40):
        try:
            with urlopen(BASE + "/status.php", timeout=3) as response:
                if response.status == 200:
                    break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise AssertionError("Disposable Nextcloud did not restart after appearance update")


def check_mobile_rtl_and_theme(page) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    response = page.goto(BASE + "/index.php/apps/downloader_bridge/library", wait_until="domcontentloaded")
    assert response and response.status < 400, "Native Library did not open"
    expect(page.locator("#downloader-library-app .library-list")).to_be_visible(timeout=25_000)

    # Switch through real Nextcloud config and a full page load rather than
    # setting the DOM dir attribute or fake theme variables in JavaScript.
    try:
        configure_disposable_appearance(dark=False, arabic=True)
        # Nextcloud chooses the signed-in user's language when a session is
        # established. A simple reload can keep the original English locale.
        page.context.clear_cookies()
        login(page)
        # Determine whether Nextcloud itself, before Downloader Bridge's
        # Library loads, has activated the stored Arabic preference.
        platform_locale = page.evaluate("""() => ({
            htmlLanguage: document.documentElement.lang,
            htmlDirection: getComputedStyle(document.documentElement).direction,
            nextcloudLanguage: window.OC?.getLanguage?.() ?? null,
        })""")
        print("Stock Nextcloud Files locale after actual Arabic configuration: "
              + str(platform_locale), flush=True)
        page.goto(BASE + "/index.php/apps/downloader_bridge/library", wait_until="domcontentloaded")
        expect(page.locator("#downloader-library-app .library-list")).to_be_visible(timeout=25_000)
        appearance = page.evaluate("""() => ({
            language: document.documentElement.lang,
            attributeDirection: document.documentElement.getAttribute('dir'),
            htmlDirection: getComputedStyle(document.documentElement).direction,
            bodyDirection: getComputedStyle(document.body).direction,
            appDirection: getComputedStyle(document.querySelector('#downloader-library-app')).direction,
            nextcloudLanguage: window.OC?.getLanguage?.() ?? null,
            nextcloudLocale: window.OC?.getLocale?.() ?? null,
        })""")
        assert appearance["language"].lower().startswith("ar"), (
            "Nextcloud did not apply Arabic language", appearance
        )
        assert "rtl" in {appearance["attributeDirection"], appearance["htmlDirection"],
                         appearance["bodyDirection"], appearance["appDirection"]}, (
            "Genuine Arabic Nextcloud locale did not produce RTL", appearance
        )
        in_viewport(page, "#downloader-library-app h1")
        # Nextcloud 35 currently exposes the theme via its computed CSS
        # variables rather than a guaranteed theme--dark HTML class.
        # Capture the real light value before toggling the server setting.
        theme_js = """() => ['html','body','#body-user','#content','#downloader-library-app'].map(selector => {
            const el=document.querySelector(selector);
            if(!el)return [selector, null];
            const style=getComputedStyle(el);
            const before=getComputedStyle(el,'::before');
            return [selector, [style.backgroundColor,style.backgroundImage,style.color,
                style.getPropertyValue('--color-primary-element').trim(),
                style.getPropertyValue('--color-main-text').trim(),
                before.backgroundColor,before.backgroundImage]];
        })"""
        light_theme = page.evaluate(theme_js)
        capture(page, "05-library-mobile-rtl.png")

        configure_disposable_appearance(dark=True, arabic=True)
        page.context.clear_cookies()
        login(page)
        page.goto(BASE + "/index.php/apps/downloader_bridge/library", wait_until="domcontentloaded")
        expect(page.locator("#downloader-library-app .library-list")).to_be_visible(timeout=25_000)
        computed_direction = page.locator("#downloader-library-app").evaluate(
            "(element) => getComputedStyle(element).direction"
        )
        assert computed_direction == "rtl", "Dark theme lost genuine Arabic RTL in Library"
        dark_theme = page.evaluate(theme_js)
        changes = [(a[0],a[1],b[1]) for a,b in zip(light_theme,dark_theme)
                   if a[1] is not None and b[1] is not None and a[1] != b[1]]
        assert changes, (
            "No real computed Nextcloud background, foreground or accent style changed",
            light_theme, dark_theme,
        )
        print("Nextcloud real light-to-dark computed style transition: "
              + ", ".join(item[0] for item in changes), flush=True)
        contrast = page.locator("#downloader-library-app").evaluate(
            "(element) => getComputedStyle(element).color"
        )
        assert contrast, "Native Library has no text color in Nextcloud dark mode"
        capture(page, "06-library-mobile-rtl-dark.png")

        page.goto(BASE + "/index.php/apps/files/", wait_until="domcontentloaded")
        trigger = page.locator("#downloader-topbar-progress .dl-trigger")
        expect(trigger).to_be_visible(timeout=25_000)
        trigger.click()
        page.locator("#downloader-header-popover .dl-popover-add").click()
        expect(page.locator("dialog.dl-link-dialog")).to_be_visible()
        in_viewport(page, "dialog.dl-link-dialog")
        in_viewport(page, "dialog.dl-link-dialog input[aria-label='Source link']")
        capture(page, "07-link-dialog-mobile-rtl.png")
        # Use the real Nextcloud RTL shell, with a deterministic manifest.
        def rtl_manifest(route):
            route.fulfill(json={"files": [{"index": 1, "path": "Album/file.mp3",
                                           "name": "file.mp3", "size_bytes": 1024}]})
        page.route("**/user/api/torrent-manifest", rtl_manifest)
        try:
            dialog = page.locator("dialog.dl-link-dialog")
            dialog.locator("input[aria-label='Source link']").fill(
                "magnet:?xt=urn:btih:0123456789012345678901234567890123456789")
            segment = dialog.locator(".dl-segmented-toggle")
            expect(segment).to_be_visible(timeout=20_000)
            assert segment.evaluate("(el) => getComputedStyle(el).direction") == "rtl"
            slider = segment.locator(".dl-segmented-slider")
            flat = segment.locator("button").last
            initial_x = slider.bounding_box()["x"]
            flat.click()
            expect(flat).to_have_attribute("aria-pressed", "true")
            page.wait_for_function("(el) => new DOMMatrix(getComputedStyle(el).transform).e < -1",
                                   arg=slider.element_handle())
            assert slider.bounding_box()["x"] < initial_x
            capture(page, "07b-torrent-selector-rtl.png")
        finally:
            page.unroute("**/user/api/torrent-manifest", rtl_manifest)
        page.keyboard.press("Escape")
        print("Real Nextcloud 35 Arabic RTL and dark theme config across pages PASS", flush=True)
    finally:
        configure_disposable_appearance(dark=False, arabic=False)



def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1360, "height": 900})
        page = context.new_page()
        page.set_default_timeout(15_000)
        try:
            login(page)
            check_library(page)
            check_settings(page)
            check_header_and_dialog(page)
            check_subtitle_layout(page)
            check_gallery_identity_selector(page)
            check_torrent_selector(page)
            check_real_native_job_journey(page)
            check_mobile_rtl_and_theme(page)
        except Exception:
            capture(page, "failure-last-page.png")
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
