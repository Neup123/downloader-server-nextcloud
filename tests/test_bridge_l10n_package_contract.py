"""Full-checkout contract for native Nextcloud translation delivery.

The isolated bridge package test has no .github/ directory; this check runs in
Nextcloud preflight CI where complete release and disposable install workflows
are available. It does not render a real Hebrew Nextcloud browser session.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_native_l10n_catalogs_enter_both_install_paths() -> None:
    release = (ROOT / ".github/workflows/bridge-package.yml").read_text()
    disposable = (ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml").read_text()
    listener = (ROOT / "bridge/lib/Listener/AssetsListener.php").read_text()
    assert "bridge/l10n package/downloader_bridge/" in release
    assert "bridge/l10n bridge-install/downloader_bridge/" in disposable
    assert "Util::addTranslations(Application::APP_ID);" in listener
    assert listener.index("Util::addTranslations") < listener.index("Util::addInitScript")
    assert (ROOT / "bridge/l10n/he.js").is_file()
    assert (ROOT / "bridge/l10n/he.json").is_file()
