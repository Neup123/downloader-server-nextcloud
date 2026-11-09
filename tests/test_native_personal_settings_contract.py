"""Native Personal settings serves owner-scoped typed settings only."""
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
JS=(ROOT/"bridge/src/settings.ts").read_text()
PHP=(ROOT/"bridge/lib/Settings/PersonalSettings.php").read_text()
XML=(ROOT/"bridge/appinfo/info.xml").read_text()

def test_nextcloud_profile_section_is_registered_and_entitled():
    assert "OCA\\DownloaderBridge\\Settings\\PersonalSettings" in XML
    assert "OCA\\DownloaderBridge\\Settings\\PersonalSection" in XML
    assert "EntitlementPolicy::allows" in PHP
    assert "new TemplateResponse(Application::APP_ID, 'personal'" in PHP

def test_standard_form_never_requires_core_key_or_raw_json():
    assert "Default preset" in JS
    assert "Advanced — technical engine settings" in JS
    assert "Browse my Files folders" in JS
    assert "DOWNLOADER_API_TOKEN" not in JS
    assert "X-API-Key" not in JS
