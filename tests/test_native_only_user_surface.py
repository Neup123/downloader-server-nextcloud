"""All ExApp browser entry points must land in Nextcloud, never Core UI."""
from __future__ import annotations
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

from fastapi import HTTPException
from starlette.requests import Request
from nextcloud_exapp.main import APP, dashboard, reference, user_page
from nextcloud_exapp.user import UserContext


def test_legacy_admin_entrypoints_redirect_to_nextcloud_settings():
    admin=UserContext("admin",SimpleNamespace())
    for endpoint in (dashboard,reference):
        response=asyncio.run(endpoint(admin))
        assert response.status_code == 303
        assert response.headers["location"] == "/settings/admin/declarative_settings"
        assert response.headers["cache-control"] == "no-store"


def test_signed_user_entrypoint_redirects_to_native_library_not_raw_proxy():
    request=Request({"type":"http","headers":[],"username":"alice"})
    with patch("nextcloud_exapp.main.require_user",new=AsyncMock(
        return_value=UserContext("alice",SimpleNamespace())
    )) as authorized:
        response=asyncio.run(user_page(request))
    assert authorized.await_count == 1
    assert response.status_code == 303
    assert response.headers["location"] == "/apps/downloader_bridge/library"


def test_unsigned_identity_does_not_redirect_to_unscoped_user_data():
    request=Request({"type":"http","headers":[],"username":""})
    with patch("nextcloud_exapp.main.require_user",new=AsyncMock(
        side_effect=HTTPException(status_code=401,detail="Missing signed identity")
    )):
        try:
            asyncio.run(user_page(request))
        except HTTPException as error:
            assert error.status_code == 401
        else:
            raise AssertionError("Unsigned user unexpectedly redirected")


def test_browser_routes_never_serve_old_bundled_html_or_core_api_keys():
    main=(Path(__file__).resolve().parents[1]/"nextcloud_exapp/main.py").read_text()
    assert 'DIST / "user.html"' not in main
    assert 'DIST / "admin.html"' not in main
    assert 'DIST / "api-reference.html"' not in main
    assert '"/apps/downloader_bridge/library"' in main
    assert '"/settings/admin/declarative_settings"' in main
    assert 'os.environ.get("DOWNLOADER_API_TOKEN"' in main
    assert "url: str" not in main  # no browser-supplied service origin


def test_core_admin_proxy_cannot_be_accessed_by_regular_user():
    paths={route.path:route for route in APP.routes if hasattr(route,"dependant")}
    for protected in ("/","/api-reference","/api/v1/{path:path}"):
        assert any(dep.call.__name__=="require_admin" for dep in paths[protected].dependant.dependencies)
    for personal in ("/user/api/me","/user/api/settings","/user/api/library"):
        assert any(dep.call.__name__=="require_user" for dep in paths[personal].dependant.dependencies)
