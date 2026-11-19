"""Single machine-readable Nextcloud plugin content routing taxonomy."""
from __future__ import annotations

import json
from pathlib import Path

# The native plugin is buildable in isolation; its JSON is the source artifact.
# The ExApp Docker build copies the same bytes beside this module for runtime.
_BUNDLED = Path(__file__).with_name("content-routes.contract.json")
_SOURCE = Path(__file__).resolve().parents[1] / "bridge/src/content-routes.contract.json"
_CONTRACT = _BUNDLED if _BUNDLED.is_file() else _SOURCE
_data = json.loads(_CONTRACT.read_text(encoding="utf-8"))
_rows = _data["categories"]
if (not isinstance(_rows, list) or not _rows or
        not isinstance(_data.get("default_folder"), str) or
        any(not isinstance(row, dict) or
            any(not isinstance(row.get(key), str) or not row[key]
                for key in ("id", "label", "subfolder")) or
            not isinstance(row.get("source_kinds"), list) or
            not row["source_kinds"] or
            any(not isinstance(kind, str) or not kind for kind in row["source_kinds"])
            for row in _rows)):
    raise ValueError("Invalid content-route contract")
if len({row["id"] for row in _rows}) != len(_rows):
    raise ValueError("Duplicate content-route category")
_kinds = [kind for row in _rows for kind in row["source_kinds"]]
if len(set(_kinds)) != len(_kinds) or "auto" not in _kinds:
    raise ValueError("Duplicate or absent source-kind mapping")
ROUTE_SUBFOLDERS = {row["id"]: row["subfolder"] for row in _rows}
ROUTE_LABELS = {row["id"]: row["label"] for row in _rows}
SOURCE_KIND_TO_ROUTE = {kind: row["id"] for row in _rows for kind in row["source_kinds"]}
DEFAULT_FOLDER = _data["default_folder"]
