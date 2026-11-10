"""Preset policy and display-preference contract for the signed ExApp."""
import pytest
from fastapi import HTTPException
from nextcloud_exapp.user import (
    built_in_presets, order_presets, validate_admin_preset, validate_preset_id_list,
)

def test_builtin_catalog_is_long_meaningful_and_safe():
    entries = built_in_presets()
    assert len(entries) >= 15
    assert len({row["id"] for row in entries}) == len(entries)
    assert all(row["name"] != "Preset 1" and row["is_builtin"] for row in entries)
    assert {"yt-dlp", "gallery-dl", "generic", "aria2c"} <= {row["engine"] for row in entries}

def test_sort_keeps_unmentioned_defaults_and_hide_is_nondestructive():
    rows = [{"id": "one"}, {"id": "two"}, {"id": "three"}]
    result = order_presets(rows, ["three", "one"], ["one"])
    assert [row["id"] for row in result] == ["three", "two"]
    assert [row["id"] for row in rows] == ["one", "two", "three"]

def test_personal_id_lists_are_bounded_and_deduplicated():
    assert validate_preset_id_list(["a", "b", "a"]) == ["a", "b"]
    for invalid in ["builtin:audio", ["x"] * 301, [4], ["a\nname"], [""]]:
        with pytest.raises(HTTPException) as exc:
            validate_preset_id_list(invalid)
        assert exc.value.status_code == 422

def test_admin_preset_form_restricts_untrusted_core_options():
    good = validate_admin_preset({"name": "Audio talk", "engine": "yt-dlp",
        "format": "bestaudio/best", "description": ""})
    assert good["settings"] == {"format": "bestaudio/best"}
    for bad in [
        {"name": " ", "engine": "yt-dlp", "format": ""},
        {"name": "Proxy", "engine": "yt-dlp", "format": "", "proxy": "x"},
        {"name": "Bad engine", "engine": "shell", "format": ""},
        {"name": "Unsafe", "engine": "yt-dlp", "format": "best --exec sh"},
        {"name": "Not video", "engine": "generic", "format": "bestaudio/best"},
    ]:
        with pytest.raises(HTTPException) as exc:
            validate_admin_preset(bad)
        assert exc.value.status_code == 422


def test_identity_response_remains_backward_compatible_with_disposable_nextcloud():
    import asyncio
    from types import SimpleNamespace
    from nextcloud_exapp.main import APP, user_me
    from nextcloud_exapp.user import UserContext

    assert asyncio.run(user_me(UserContext("alice", SimpleNamespace()))) == {
        "user_id": "alice", "entitled": True,
    }
    routes = {route.path: route for route in APP.routes if hasattr(route, "dependant")}
    preset_permission = routes["/user/api/preset-permissions"]
    dependencies = {dep.call.__name__ for dep in preset_permission.dependant.dependencies}
    assert "require_user" in dependencies
