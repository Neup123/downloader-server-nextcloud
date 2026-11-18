"""Evidence that browser acceptance runs against installed disposable Nextcloud."""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml"
TEST = ROOT / "tests/native_browser_acceptance.py"


def test_browser_harness_compiles_and_is_real_playwright():
    ast.parse(TEST.read_text(encoding="utf-8"))
    code = TEST.read_text(encoding="utf-8")
    assert "from playwright.sync_api import sync_playwright" in code
    assert "page.goto(BASE +" in code
    for selector in (
        "#downloader-library-app", "#downloader-settings-app",
        "#downloader-topbar-progress", "dialog.dl-link-dialog",
    ):
        assert selector in code
    for step in ("login(page)", "check_library(page)", "check_settings(page)",
                 "check_header_and_dialog(page)", "check_mobile_rtl_and_theme(page)"):
        assert step in code
    assert "page.keyboard.press(\"Escape\")" in code
    assert "getComputedStyle(el).color" in code
    assert "page.screenshot" in code
    assert "NEXTCLOUD_APP_PASSWORD" in code
    assert "MOCK_CORE_TOKEN" not in code and "APP_SECRET" not in code


def test_browser_gate_runs_before_disabling_exapp_and_artifacts_are_retained():
    source = WORKFLOW.read_text(encoding="utf-8")
    assert source.index("Install native PHP bridge into real disposable Nextcloud") < source.index(
        "Exercise real native Nextcloud UI in Chromium")
    assert source.index("Verify AppAPI signing and actual authenticated proxy forwarding") < source.index(
        "Exercise real native Nextcloud UI in Chromium")
    assert source.index("Exercise real native Nextcloud UI in Chromium") < source.index(
        "Verify ExApp can be disabled and unregistered cleanly")
    assert "python3 tests/native_browser_acceptance.py" in source
    assert "google-chrome --version" in source
    assert "playwright install" not in source
    assert "if: always()" in source
    assert "nextcloud-native-browser-evidence" in source
    assert "browser-evidence/*.png" in source
