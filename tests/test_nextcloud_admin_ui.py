"""Native administrator UI never requests or renders the core API token."""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.requests import Request

from nextcloud_exapp.main import APP, admin_connection_status, dashboard
from nextcloud_exapp.proxy import ProxySettings
from nextcloud_exapp.user import UserContext

ROOT = Path(__file__).resolve().parents[1]


def test_built_admin_entrypoint_is_separate_and_token_free():
    config = (ROOT / "web/vite.config.ts").read_text()
    html = (ROOT / "web/admin.html").read_text()
    ui = (ROOT / "web/src/AdminApp.tsx").read_text()
    backend = (ROOT / "nextcloud_exapp/main.py").read_text()
    assert "'admin.html'" in config
    assert 'src="/src/admin-main.tsx"' in html
    assert 'RedirectResponse(' in backend
    assert 'url="/settings/admin/declarative_settings"' in backend
    assert 'DIST / "admin.html"' not in backend
    assert 'url="/apps/downloader_bridge/library"' in backend
    assert "/admin/api/entitlements" in backend
    assert "Check connection" in ui
    assert "Who can download" in ui
    assert "requestToken" in ui and "OCS-APIRequest" in ui
    for secret in ("DOWNLOADER_API_TOKEN", "APP_API_TOKEN", "X-API-Key"):
        assert secret not in ui


def test_signed_administrator_connection_check_never_exposes_core_token():
    admin = UserContext("admin", SimpleNamespace())
    settings = ProxySettings("https://core.example.org", "some-secret-token-never-to-browser")
    with patch("nextcloud_exapp.main.config", return_value=settings), patch(
        "nextcloud_exapp.main.core_json",
        new=AsyncMock(return_value=[{"installed": True}, {"installed": False}]),
    ):
        result = asyncio.run(admin_connection_status(admin))
    assert result == {
        "connected": True,
        "core_origin": "https://core.example.org",
        "token_configured": True,
        "engines_ready": 1,
        "message": "Connected to Downloader Server",
    }
    assert settings.token not in str(result)
    with patch("nextcloud_exapp.main.config", return_value=settings), patch(
        "nextcloud_exapp.main.core_json",
        new=AsyncMock(side_effect=HTTPException(status_code=502, detail="server not reachable")),
    ):
        failed = asyncio.run(admin_connection_status(admin))
    assert failed["connected"] is False
    assert failed["engines_ready"] == 0
    assert settings.token not in str(failed)


def test_admin_paths_are_authorized_separately_from_per_user_app():
    routes = {route.path: route for route in APP.routes if hasattr(route, "dependant")}
    assert "/" in routes and "/admin/api/connection" in routes
    for path in ("/", "/admin/api/connection", "/admin/api/entitlements"):
        names = {dependency.call.__name__ for dependency in routes[path].dependant.dependencies}
        assert "require_admin" in names, (path, names)
    personal = {dependency.call.__name__ for dependency in routes["/user/api/me"].dependant.dependencies}
    assert "require_user" in personal
    assert "require_admin" not in personal
