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
    assert "Default download quality" in JS
    assert "preset" not in JS.lower()
    assert "Advanced — technical engine settings" in JS
    assert "Browse my Files folders" in JS
    assert "DOWNLOADER_API_TOKEN" not in JS
    assert "X-API-Key" not in JS


def test_header_dropdown_preferences_use_signed_user_preference_storage():
    source=(ROOT/"nextcloud_exapp/user.py").read_text()
    for key, fallback in (("header_indicator_visibility", "active"), ("dropdown_content", "active")):
        assert f'preferences.get_value("{key}", "{fallback}")' in source
        assert f'pref.set_value(name, patch[name])' in source
    assert '"header_indicator_visibility", {"active", "always"}' in source
    assert '"dropdown_content", {"active", "all"}' in source
