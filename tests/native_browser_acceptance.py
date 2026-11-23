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
    # The menu closes after choice; inspect its retained DOM state, not a
    # hidden-by-default accessibility-tree locator.
    size_option = picker.locator('.dl-torrent-sort-menu [role="menuitemradio"]').filter(has_text="Size")
    expect(size_option).to_have_attribute("aria-checked", "true")
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

    The fixture does not actually download remote media. Only preview metadata
    and Core's transition clock are deterministic; authenticated submission
    and status polling use the real PHP bridge and ExApp.
    """
    import json

    page.goto(BASE + "/index.php/apps/files/", wait_until="domcontentloaded")
    trigger = page.locator("#downloader-topbar-progress .dl-trigger")
    expect(trigger).to_be_visible(timeout=25_000)

    def preview(route):
        route.fulfill(
            status=200, content_type="application/json",
            body=json.dumps({"kind": "direct", "title": "dummy.pdf", "filename": "dummy.pdf",
                             "mime": "application/pdf", "size": 13264}),
        )

    page.route("**/user/api/media-preview", preview)
    try:
        trigger.click()
        page.locator("#downloader-header-popover .dl-popover-add").click()
        dialog = page.locator("dialog.dl-link-dialog")
        expect(dialog).to_be_visible()
        dialog.get_by_role("textbox", name="Source link").fill("https://example.test/dummy.pdf")
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
        page.unroute("**/user/api/media-preview", preview)


def configure_disposable_appearance(*, dark: bool, hebrew: bool) -> None:
    """Use Nextcloud 35's supported server settings, not synthetic CSS/dir."""
    import subprocess

    app = "downloader-appapi-nextcloud"
    settings = (("enforce_theme", "dark" if dark else None),
                ("force_language", "he" if hebrew else None))
    for name, value in settings:
        action = ["config:system:set", name, "--value=" + value] if value else [
            "config:system:delete", name
        ]
        subprocess.run(
            ["docker", "exec", "--user", "www-data", app, "php", "occ", *action],
            check=True, capture_output=True, text=True, timeout=35,
        )
    # Use the documented real Nextcloud per-user locale setting as well.
    # That setting is read for signed-in users independently of the global
    # default/force language; never simulate RTL by editing the DOM.
    subprocess.run(
        ["docker", "exec", "--user", "www-data", app, "php", "occ",
         "user:setting", "alice", "core", "lang", "he" if hebrew else "en"],
        check=True, capture_output=True, text=True, timeout=35,
    )
    value = subprocess.run(
        ["docker", "exec", "--user", "www-data", app, "php", "occ",
         "user:setting", "alice", "core", "lang"],
        check=True, capture_output=True, text=True, timeout=35,
    ).stdout.strip()
    assert value == ("he" if hebrew else "en"), (
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
        configure_disposable_appearance(dark=False, hebrew=True)
        # Nextcloud chooses the signed-in user's language when a session is
        # established. A simple reload can keep the original English locale.
        page.context.clear_cookies()
        login(page)
        # Determine whether Nextcloud itself, before Downloader Bridge's
        # Library loads, has activated the stored Hebrew preference.
        platform_locale = page.evaluate("""() => ({
            htmlLanguage: document.documentElement.lang,
            htmlDirection: getComputedStyle(document.documentElement).direction,
            nextcloudLanguage: window.OC?.getLanguage?.() ?? null,
        })""")
        print("Stock Nextcloud Files locale after actual Hebrew configuration: "
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
        assert appearance["language"].lower().startswith("he"), (
            "Nextcloud did not apply Hebrew language", appearance
        )
        assert "rtl" in {appearance["attributeDirection"], appearance["htmlDirection"],
                         appearance["bodyDirection"], appearance["appDirection"]}, (
            "Genuine Hebrew Nextcloud locale did not produce RTL", appearance
        )
        in_viewport(page, "#downloader-library-app h1")
        capture(page, "05-library-mobile-rtl.png")

        configure_disposable_appearance(dark=True, hebrew=True)
        page.context.clear_cookies()
        login(page)
        page.goto(BASE + "/index.php/apps/downloader_bridge/library", wait_until="domcontentloaded")
        expect(page.locator("#downloader-library-app .library-list")).to_be_visible(timeout=25_000)
        computed_direction = page.locator("#downloader-library-app").evaluate(
            "(element) => getComputedStyle(element).direction"
        )
        assert computed_direction == "rtl", "Dark theme lost genuine Hebrew RTL in Library"
        theme_class = page.locator("html").get_attribute("class") or ""
        body_class = page.locator("body").get_attribute("class") or ""
        assert "theme--dark" in theme_class or "theme--dark" in body_class, (
            "Nextcloud did not apply its enforced dark theme", theme_class, body_class
        )
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
        page.keyboard.press("Escape")
        print("Real Nextcloud 35 Hebrew RTL and dark theme config across pages PASS", flush=True)
    finally:
        configure_disposable_appearance(dark=False, hebrew=False)



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
            check_real_native_job_journey(page)
            check_mobile_rtl_and_theme(page)
        except Exception:
            capture(page, "failure-last-page.png")
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
