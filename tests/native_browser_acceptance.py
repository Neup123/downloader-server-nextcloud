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


def check_library(page) -> None:
    page.goto(BASE + "/apps/downloader_bridge/library", wait_until="domcontentloaded")
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
    page.goto(BASE + "/settings/user/downloader", wait_until="domcontentloaded")
    root = page.locator("#downloader-settings-app")
    expect(root).to_be_visible(timeout=30_000)
    expect(root.locator(".downloader-settings-grid")).to_be_visible(timeout=30_000)
    expect(root.get_by_text("Destination routing by content type")).to_be_visible()
    assert root.locator("input, select, button").count() >= 4
    capture(page, "02-personal-settings.png")


def check_header_and_dialog(page) -> None:
    page.goto(BASE + "/apps/files/", wait_until="domcontentloaded")
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


def check_mobile_rtl_and_theme(page) -> None:
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/apps/downloader_bridge/library", wait_until="domcontentloaded")
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
    page.goto(BASE + "/apps/files/", wait_until="domcontentloaded")
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
            check_mobile_rtl_and_theme(page)
        except Exception:
            capture(page, "failure-last-page.png")
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
