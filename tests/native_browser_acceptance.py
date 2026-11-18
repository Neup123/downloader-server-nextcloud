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
    capture(page, "10-cookie-vault-settings.png")


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


def check_torrent_selector(page) -> None:
    """#170: real magnet file-selection layout and controls, fixture manifest."""
    import json

    manifest = {"file_count": 3, "files": [
        {"index": 1, "path": "Album/first.mp3", "name": "first.mp3", "size_bytes": 1048576},
        {"index": 2, "path": "Album/second.mp3", "name": "second.mp3", "size_bytes": 2097152},
        {"index": 3, "path": "Cover.jpg", "name": "Cover.jpg", "size_bytes": 1048576},
    ]}

    def respond(route):
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

    root = picker.get_by_role("checkbox", name="Select files in All files")
    root.uncheck()
    expect(count).to_contain_text("0 of 3 files selected")
    root.check()
    expect(count).to_contain_text("3 of 3 files selected")
    flat = picker.get_by_role("button", name="Flat list")
    flat.click()
    expect(flat).to_have_attribute("aria-pressed", "true")
    expect(picker.locator(".dl-torrent-file")).to_have_count(3)
    order = picker.get_by_role("button", name="Order by")
    order.click()
    picker.get_by_role("menuitemradio", name="Size").click()
    expect(picker.get_by_role("menuitemradio", name="Size")).to_have_attribute("aria-checked", "true")
    capture(page, "11-torrent-selector-desktop.png")

    # The primary action must stay inside the visible dialog at a narrow width.
    page.set_viewport_size({"width": 390, "height": 844})
    expect(picker).to_be_visible()
    in_viewport(page, "dialog.dl-link-dialog")
    submit = dialog.get_by_role("button", name="Download", exact=True)
    expect(submit).to_be_visible()
    in_viewport(page, "dialog.dl-link-dialog button.dl-primary")
    capture(page, "12-torrent-selector-mobile.png")
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1360, "height": 900})
    page.unroute("**/user/api/torrent-manifest", respond)


def check_mobile_rtl_and_theme(page) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    response = page.goto(BASE + "/index.php/apps/downloader_bridge/library", wait_until="domcontentloaded")
    assert response and response.status < 400, f"Native Library HTTP {response.status if response else 'no response'}"
    expect(page.locator("#downloader-library-app .library-list")).to_be_visible(timeout=25_000)
    page.evaluate("document.documentElement.setAttribute('dir', 'rtl')")
    in_viewport(page, "#downloader-library-app h1")
    capture(page, "05-library-mobile-rtl.png")
    # Test actual inherited CSS variables after switching the page to dark.
    page.evaluate("""() => {
      document.documentElement.classList.add('theme--dark');
      document.documentElement.style.setProperty('--color-main-background', '#171717');
      document.documentElement.style.setProperty('--color-main-text', '#f4f4f4');
    }""")
    styles = page.locator("#downloader-library-app").evaluate(
        "(el) => getComputedStyle(el).color"
    )
    assert styles, "Dark theme inherited no computed text color"
    capture(page, "06-library-mobile-rtl-dark.png")
    page.goto(BASE + "/index.php/apps/files/", wait_until="domcontentloaded")
    # The native shared dialog is also operable at a narrow RTL viewport.
    page.evaluate("document.documentElement.setAttribute('dir', 'rtl')")
    trigger = page.locator("#downloader-topbar-progress .dl-trigger")
    expect(trigger).to_be_visible(timeout=25_000)
    trigger.click()
    page.locator("#downloader-header-popover .dl-popover-add").click()
    expect(page.locator("dialog.dl-link-dialog")).to_be_visible()
    in_viewport(page, "dialog.dl-link-dialog")
    in_viewport(page, "dialog.dl-link-dialog input[aria-label='Source link']")
    capture(page, "07-link-dialog-mobile-rtl.png")
    page.keyboard.press("Escape")


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
            check_torrent_selector(page)
            check_mobile_rtl_and_theme(page)
        except Exception:
            capture(page, "failure-last-page.png")
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
