"""The separately licensed native Nextcloud plugin must use immutable npm inputs."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_native_bridge_has_real_registry_lock_and_exact_declared_roots():
    package = json.loads((ROOT / "bridge/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "bridge/package-lock.json").read_text(encoding="utf-8"))
    assert lock["lockfileVersion"] == 3
    assert lock["name"] == package["name"]
    assert lock["version"] == package["version"]
    assert len(lock["packages"]) > 10
    root = lock["packages"][""]
    for key in ("dependencies", "devDependencies"):
        assert root[key] == package[key]
    for name in (*package["dependencies"], *package["devDependencies"]):
        pinned = lock["packages"].get("node_modules/" + name)
        assert pinned and pinned.get("version")
        assert pinned.get("resolved", "").startswith("https://")
        assert pinned.get("integrity", "").startswith("sha512-")


def test_every_bridge_packaging_gate_uses_npm_ci_without_bootstrap_or_mutable_install():
    workflows = (
        ROOT / ".github/workflows/bridge-package.yml",
        ROOT / ".github/workflows/appapi-docker-deploy-e2e.yml",
        ROOT / ".github/workflows/publish-exapp-commit-image.yml",
    )
    for workflow in workflows:
        text = workflow.read_text(encoding="utf-8")
        assert "npm ci --no-audit --no-fund" in text, workflow.name
        assert "npm install" not in text, workflow.name
        assert "BRIDGE_LOCK_PART" not in text
        assert "BRIDGE_LOCK_BEGIN" not in text
    native = workflows[0].read_text(encoding="utf-8")
    assert native.count("npm ci --no-audit --no-fund") == 2
    assert 'cp -a bridge/. "$isolated/bridge/"' in native
    assert "npm test" in native and "npm run build" in native
