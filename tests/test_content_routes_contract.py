"""One content-type routing taxonomy for the signed ExApp and native plugin."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

from nextcloud_exapp.content_routes import (
    DEFAULT_FOLDER, ROUTE_SUBFOLDERS, ROUTE_LABELS, SOURCE_KIND_TO_ROUTE,
)
from nextcloud_exapp.user import default_destination_routes

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "bridge/src/content-routes.contract.json"


def native_routes():
    node = shutil.which("node")
    assert node, "Node.js is required to verify native plugin cross-stack mapping"
    script = (
        "import {CONTENT_ROUTES, DEFAULT_FOLDER, SUPPORTED_SOURCE_KINDS, "
        "contentCategoryFor} from './bridge/src/content-routes.mjs';"
        "console.log(JSON.stringify({routes:CONTENT_ROUTES,defaultFolder:DEFAULT_FOLDER,"
        "kinds:Object.fromEntries(SUPPORTED_SOURCE_KINDS.map(kind=>"
        "[kind,contentCategoryFor(kind)])),"
        "audio:Object.fromEntries(SUPPORTED_SOURCE_KINDS.map(kind=>"
        "[kind,contentCategoryFor(kind,true)]))}));"
    )
    run = subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=ROOT, check=True, capture_output=True, text=True, timeout=15,
    )
    return json.loads(run.stdout)


def test_signed_gateway_and_native_plugin_share_exact_routing_rows():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    native = native_routes()
    assert native["routes"] == source["categories"]
    assert native["defaultFolder"] == DEFAULT_FOLDER == source["default_folder"]
    assert ROUTE_SUBFOLDERS == {
        row["id"]: row["subfolder"] for row in source["categories"]
    }
    assert ROUTE_LABELS == {
        row["id"]: row["label"] for row in source["categories"]
    }
    actual_kinds = {
        kind: row["id"] for row in source["categories"] for kind in row["source_kinds"]
    }
    assert SOURCE_KIND_TO_ROUTE == native["kinds"] == actual_kinds
    assert all(category == "audio" for category in native["audio"].values())


def test_shared_routes_apply_base_folder_and_reject_unknown_category():
    assert default_destination_routes("Projects") == {
        kind: "Projects/" + suffix for kind, suffix in ROUTE_SUBFOLDERS.items()
    }
    assert len(ROUTE_SUBFOLDERS) == 6
    assert "synthetic-unknown-kind" not in SOURCE_KIND_TO_ROUTE
    assert "synthetic-unknown-category" not in ROUTE_SUBFOLDERS


def test_consumers_do_not_define_parallel_content_taxonomies():
    native = (ROOT / "bridge/src/settings.ts").read_text(encoding="utf-8")
    payload = (ROOT / "bridge/src/files-dialog-payload.mjs").read_text(encoding="utf-8")
    gateway = (ROOT / "nextcloud_exapp/user.py").read_text(encoding="utf-8")
    assert "CONTENT_ROUTES.map(route=>[route.id,route.subfolder])" in native
    assert "CONTENT_ROUTES.map(route=>[route.id,route.label])" in native
    assert "contentCategoryFor(kind, audioOnly)" in payload
    assert "SUPPORTED_SOURCE_KINDS.includes(kind)" in payload
    assert "ROUTE_SUBFOLDERS = {" not in gateway
    assert "from nextcloud_exapp.content_routes import DEFAULT_FOLDER, ROUTE_SUBFOLDERS" in gateway
    docker = (ROOT / "nextcloud_exapp/Dockerfile").read_text(encoding="utf-8")
    assert "COPY nextcloud_exapp/content-routes.contract.json" in docker
