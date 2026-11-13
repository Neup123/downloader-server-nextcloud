"""Integration tests for core-sync provenance against disposable Git remotes."""
from __future__ import annotations

from contextlib import contextmanager
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "record_core_sync.py"
SPEC = importlib.util.spec_from_file_location("record_core_sync", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
record_core_sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(record_core_sync)


def git(repository: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def write(repository: Path, name: str, content: str) -> None:
    destination = repository / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")


@contextmanager
def in_repository(repository: Path):
    previous = Path.cwd()
    try:
        os.chdir(repository)
        yield
    finally:
        os.chdir(previous)


class ProvenanceIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.repository = root / "downstream"
        self.repository.mkdir()
        origin = root / "origin.git"
        upstream = root / "upstream.git"
        git(root, "init", "--bare", str(origin))
        git(root, "init", "--bare", str(upstream))
        git(self.repository, "init", "-b", "main")
        git(self.repository, "config", "user.name", "Provenance Test")
        git(self.repository, "config", "user.email", "test@example.invalid")
        git(self.repository, "remote", "add", "origin", str(origin))
        git(self.repository, "remote", "add", "upstream", str(upstream))
        for name in (
            "app/delivery.py", "app/schemas.py", "app/core.py", "app/other.py",
            "web/src/App.tsx", "web/src/ui-options.ts", "web/src/Other.tsx",
            "EGRESS_GUARD.md",
        ):
            write(self.repository, name, "upstream baseline\n")
        git(self.repository, "add", ".")
        git(self.repository, "commit", "-m", "Common ancestor")
        git(self.repository, "push", "origin", "main")
        git(self.repository, "push", "upstream", "main")

        git(self.repository, "checkout", "-b", "upstream-work")
        write(self.repository, "app/core.py", "upstream new core behavior\n")
        git(self.repository, "add", ".")
        git(self.repository, "commit", "-m", "Upstream core change")
        git(self.repository, "push", "upstream", "HEAD:main")
        git(self.repository, "checkout", "main")
        git(self.repository, "fetch", "upstream", "main")

    def merge(self, *, extra: dict[str, str] | None = None, push: bool = True) -> None:
        overrides = {
            "app/delivery.py": "approved downstream delivery\n",
            "app/schemas.py": "approved downstream schemas\n",
            "web/src/ui-options.ts": "approved downstream UI options\n",
            "web/src/App.tsx": "legacy Nextcloud adapter\n",
        }
        overrides.update(extra or {})
        for path, content in overrides.items():
            write(self.repository, path, content)
        git(self.repository, "add", ".")
        git(self.repository, "commit", "-m", "Approved downstream changes")
        git(self.repository, "merge", "--no-ff", "-m", "Accepted core sync", "upstream/main")
        if push:
            git(self.repository, "push", "origin", "main")

    def test_sync_accepts_approved_divergences_and_describes_scope(self) -> None:
        self.merge()
        with in_repository(self.repository):
            record = record_core_sync.accepted_sync_record()
        self.assertEqual(record["schema_version"], 1)
        self.assertTrue(record["core_owned_files_byte_identical"])
        self.assertTrue(record["source_is_exact_second_parent"])
        self.assertIn(":(exclude)app/delivery.py", record["core_owned_paths"])
        self.assertIn(":(exclude)app/schemas.py", record["core_owned_paths"])
        self.assertIn("web/src/App.tsx", record["shared_core_ui"])
        self.assertIn("web/src/ui-options.ts", record["shared_core_ui"])

    def test_revalidation_accepts_approved_divergences(self) -> None:
        self.merge()
        with in_repository(self.repository):
            record = record_core_sync.accepted_main_revalidation_record()
        self.assertEqual(record["schema_version"], 1)
        self.assertFalse(record["source_is_exact_second_parent"])
        self.assertIn("ui-options.ts", record["shared_core_ui"])
        self.assertIn(":(exclude)app/delivery.py", record["core_owned_paths"])

    def test_non_exempt_backend_change_rejected_in_both_paths(self) -> None:
        self.merge(extra={"app/other.py": "unauthorized change\n"})
        with in_repository(self.repository):
            with self.assertRaisesRegex(ValueError, "A core-owned backend, contract or egress-policy file differs"):
                record_core_sync.accepted_sync_record()
            with self.assertRaisesRegex(ValueError, "Current main contains divergent core-owned backend files"):
                record_core_sync.accepted_main_revalidation_record()

    def test_non_exempt_web_change_rejected(self) -> None:
        self.merge(extra={"web/src/Other.tsx": "unauthorized UI change\n"})
        with in_repository(self.repository):
            with self.assertRaisesRegex(ValueError, "A core-owned backend, contract or egress-policy file differs"):
                record_core_sync.accepted_sync_record()
            with self.assertRaisesRegex(ValueError, "Current main contains divergent core-owned backend files"):
                record_core_sync.accepted_main_revalidation_record()

    def test_unpushed_merge_rejected_in_both_paths(self) -> None:
        self.merge(push=False)
        with in_repository(self.repository):
            with self.assertRaisesRegex(ValueError, "Remote main moved or never received the tested merge"):
                record_core_sync.accepted_sync_record()
            with self.assertRaisesRegex(ValueError, "Remote main changed since the tested source revision"):
                record_core_sync.accepted_main_revalidation_record()

    def test_wrong_second_parent_rejected(self) -> None:
        self.merge()
        git(self.repository, "checkout", "-b", "other-work")
        write(self.repository, "unowned-downstream.txt", "independent change\n")
        git(self.repository, "add", ".")
        git(self.repository, "commit", "-m", "Other branch")
        git(self.repository, "checkout", "main")
        git(self.repository, "merge", "--no-ff", "-m", "Not a core merge", "other-work")
        git(self.repository, "push", "origin", "main")
        with in_repository(self.repository):
            with self.assertRaisesRegex(ValueError, "exact core SHA as its second parent"):
                record_core_sync.accepted_sync_record()

    def test_later_pushed_main_can_revalidate_but_not_claim_a_new_merge(self) -> None:
        self.merge()
        write(self.repository, "unowned-downstream.txt", "later change\n")
        git(self.repository, "add", ".")
        git(self.repository, "commit", "-m", "Later downstream commit")
        git(self.repository, "push", "origin", "main")
        with in_repository(self.repository):
            record = record_core_sync.accepted_main_revalidation_record()
            with self.assertRaisesRegex(ValueError, "exact core SHA as its second parent"):
                record_core_sync.accepted_sync_record()
        self.assertFalse(record["source_is_exact_second_parent"])


if __name__ == "__main__":
    unittest.main()
