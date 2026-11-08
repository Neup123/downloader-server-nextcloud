"""ExApp supply-chain manifest must fail closed for floating dependencies."""
from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
import unittest

from scripts.exapp_build_inputs import parse_pin_file, prepare_build_inputs
from scripts.exapp_wheel_hashes import parse_pins, render_hash_lock, wheel_hashes


ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40


class ExAppBuildInputsTests(unittest.TestCase):
    def test_full_build_inputs_are_digest_and_version_pinned(self):
        record = prepare_build_inputs(ROOT, SHA)
        self.assertEqual(record["source_commit"], SHA)
        self.assertTrue(record["base_images_digest_pinned"])
        self.assertTrue(record["python_versions_fully_pinned"])
        self.assertFalse(record["python_wheel_hashes_verified"])
        self.assertFalse(record["native_appapi_manifest_digest_pinned"])
        self.assertGreaterEqual(record["python_dependency_count"], 25)
        self.assertEqual(set(record["base_images"]), {"web-build", "runtime"})
        for image in record["base_images"].values():
            self.assertRegex(image, r"@sha256:[0-9a-f]{64}$")
        for filename in ("dockerfile_sha256", "python_lock_sha256", "npm_lock_sha256"):
            self.assertRegex(record[filename], r"^[0-9a-f]{64}$")

    def test_direct_requirements_match_transitive_lock_exactly(self):
        direct = parse_pin_file((ROOT / "nextcloud_exapp/requirements.txt").read_text())
        locked = parse_pin_file((ROOT / "nextcloud_exapp/requirements.lock").read_text())
        self.assertTrue(set(direct) <= set(locked))
        for package, pin in direct.items():
            self.assertEqual(locked[package], pin)
        self.assertEqual(locked["uvicorn"][1], "[standard]")
        self.assertEqual(locked["nc-py-api"][1], "[app]")

    def test_bad_lock_entries_are_rejected(self):
        for bad in (
            "fastapi>=0.1", "fastapi", "fastapi==", "-e git+https://example.org",
            "fastapi==0.1\\nfastapi==0.2", "fastapi==0.1; python_version>'3'",
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_pin_file(bad)
        with self.assertRaises(ValueError):
            parse_pin_file("# no dependencies")

    def test_mutated_base_image_and_direct_pin_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "nextcloud_exapp").mkdir()
            (root / "web").mkdir()
            for name in ("Dockerfile", "requirements.txt", "requirements.lock"):
                shutil.copy(ROOT / "nextcloud_exapp" / name, root / "nextcloud_exapp" / name)
            shutil.copy(ROOT / "web/package-lock.json", root / "web/package-lock.json")
            docker = root / "nextcloud_exapp/Dockerfile"
            docker.write_text(docker.read_text().replace("node:22-alpine@sha256:", "node:22-alpine:"))
            with self.assertRaises(ValueError):
                prepare_build_inputs(root, SHA)
            shutil.copy(ROOT / "nextcloud_exapp/Dockerfile", docker)
            lock = root / "nextcloud_exapp/requirements.lock"
            lock.write_text(lock.read_text().replace("fastapi==0.139.2", "fastapi==0.139.1"))
            with self.assertRaises(ValueError):
                prepare_build_inputs(root, SHA)

    def test_wheel_candidate_generator_is_deterministic_and_strict(self):
        pins = parse_pins("# pinned\nfastapi==0.139.2\nnc_py_api[app]==0.30.3\n")
        self.assertEqual(len(pins), 2)
        wheel = lambda sha: {"packagetype": "bdist_wheel", "filename": "sample.whl",
                             "digests": {"sha256": sha}, "yanked": False}
        response = {"urls": [wheel("f" * 64), wheel("a" * 64),
                             {"packagetype": "sdist", "filename": "source.tar.gz"}]}
        output = render_hash_lock(pins, fetch=lambda *_: response)
        self.assertIn("fastapi==0.139.2", output)
        self.assertIn("nc_py_api[app]==0.30.3", output)
        self.assertLess(output.index("--hash=sha256:" + "a" * 64),
                        output.index("--hash=sha256:" + "f" * 64))
        self.assertEqual(wheel_hashes(response), ["a" * 64, "f" * 64])
        with self.assertRaises(ValueError):
            parse_pins("fastapi>=0.1")
        with self.assertRaises(ValueError):
            parse_pins("fastapi==1.0\nfastapi==2.0")
        with self.assertRaises(ValueError):
            wheel_hashes({"urls": [{"packagetype": "bdist_wheel",
                                   "filename": "bad.whl",
                                   "digests": {"sha256": "not-a-hash"}}]})
        with self.assertRaises(ValueError):
            wheel_hashes({"urls": [{"packagetype": "sdist",
                                   "filename": "source.tar.gz"}]})

    def test_bad_source_commit_is_rejected(self):
        for bad in ("a" * 39, "A" * 40, "z" * 40):
            with self.assertRaises(ValueError):
                prepare_build_inputs(ROOT, bad)


if __name__ == "__main__":
    unittest.main()
