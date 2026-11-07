"""Signed user's read-only Nextcloud Files folder picker."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from nextcloud_exapp.main import APP, user_folders
from nextcloud_exapp.user import UserContext, require_user


def folder(path: str, *, is_dir=True):
    return SimpleNamespace(user_path=path, is_dir=is_dir)


class FakeFiles:
    def __init__(self, entries):
        self.entries = entries
        self.seen = []
    async def listdir(self, path):
        self.seen.append(path)
        return list(self.entries.get(path, []))


def ctx(uid, folders):
    files = FakeFiles(folders)
    return UserContext(uid, SimpleNamespace(files=files)), files


class FolderPickerTests(TestCase):
    def test_route_requires_signed_entitled_user(self):
        route = next(item for item in APP.routes if getattr(item, "path", "") == "/user/api/folders")
        self.assertIn(require_user, {dep.call for dep in route.dependant.dependencies})
        self.assertEqual({"GET"}, route.methods)

    def test_only_immediate_directories_of_the_current_users_path(self):
        alice, fs = ctx("alice", {
            "/Documents": [
                folder("/Documents/Invoices"), folder("Documents/Photos"),
                folder("Documents/file.txt", is_dir=False),
                folder("/Documents/Invoices/private/subfolder"),
                folder("/Other/Spoof"), folder("/Documents/../Bad"),
            ]
        })
        result = asyncio.run(user_folders(path="Documents", context=alice))
        self.assertEqual(result["path"], "Documents")
        self.assertEqual(result["folders"], [
            {"name": "Invoices", "path": "Documents/Invoices"},
            {"name": "Photos", "path": "Documents/Photos"},
        ])
        self.assertEqual(fs.seen, ["/Documents"])
        self.assertFalse(result["has_more"])

    def test_each_signed_user_uses_only_their_files_context(self):
        alice, alice_files = ctx("alice", {"/": [folder("Shared-Alice")]})
        bob, bob_files = ctx("bob", {"/": [folder("Private-Bob")]})
        one = asyncio.run(user_folders(path="", context=alice))
        two = asyncio.run(user_folders(path="", context=bob))
        self.assertEqual(one["folders"], [{"name": "Shared-Alice", "path": "Shared-Alice"}])
        self.assertEqual(two["folders"], [{"name": "Private-Bob", "path": "Private-Bob"}])
        self.assertEqual(alice_files.seen, ["/"])
        self.assertEqual(bob_files.seen, ["/"])
        self.assertNotIn("Private-Bob", str(one))
        self.assertNotIn("Shared-Alice", str(two))

    def test_page_limits_and_no_cross_page_overlap(self):
        many = [folder(f"Folder-{i:03d}") for i in range(130)]
        alice, _ = ctx("alice", {"/": many})
        first = asyncio.run(user_folders(context=alice))
        second = asyncio.run(user_folders(offset=100, context=alice))
        self.assertEqual(len(first["folders"]), 100)
        self.assertTrue(first["has_more"])
        self.assertEqual(len(second["folders"]), 30)
        self.assertFalse(second["has_more"])
        self.assertFalse({i["path"] for i in first["folders"]}.intersection(
            {i["path"] for i in second["folders"]}
        ))

    def test_path_traversal_and_invalid_pagination_rejected_before_listdir(self):
        alice, files = ctx("alice", {"/": []})
        for bad in ("../Other", "Photos//Private", "Photos/./Hidden",
                    "Photos/../Other", "Photos\\Private", "Photos\x00Secret"):
            with self.subTest(path=bad), self.assertRaises(HTTPException) as error:
                asyncio.run(user_folders(path=bad, context=alice))
            self.assertEqual(error.exception.status_code, 422)
        for bad in (-1, 10001):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(user_folders(offset=bad, context=alice))
            self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(files.seen, [])

    def test_missing_or_inaccessible_user_folder_is_actionable(self):
        class BrokenFiles:
            async def listdir(self, path):
                raise RuntimeError("user folder unavailable")
        alice = UserContext("alice", SimpleNamespace(files=BrokenFiles()))
        with self.assertRaises(HTTPException) as error:
            asyncio.run(user_folders(path="Missing", context=alice))
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("your Nextcloud Files", error.exception.detail)
