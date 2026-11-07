"""Release Bundle worker contract and local HTTP transfer tests."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import fcntl
import json
from pathlib import Path
import tempfile
import threading
import unittest

from release_bundle import validate, sync


class BundleCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = b"xdrive-package" * 80
        (self.root / "pkg.ipa").write_bytes(self.data)
        handler = partial(SimpleHTTPRequestHandler, directory=str(self.root))
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)
        url = f"http://127.0.0.1:{self.http.server_port}/pkg.ipa"
        self.manifest = {
            "schema_version": 1, "commit": "a" * 40, "channel": "master",
            "artifacts": [{
                "platform": "ios", "filename": "pkg.ipa", "build_commit": "a" * 40,
                "size": len(self.data), "sha256": hashlib.sha256(self.data).hexdigest(),
                "sources": {"gitlab": url, "github": url},
            }]
        }
        self.cache = self.root / "cache"

    def sync(self):
        return sync(self.manifest, self.cache, retries=1, allow_local=True)

    def test_verified_publish(self):
        self.assertEqual(self.sync(), 0)
        self.assertEqual((self.cache / "packages" / ("a" * 40) / "pkg.ipa").read_bytes(), self.data)
        self.assertEqual(json.loads((self.cache / "status.json").read_text())["state"], "ready")
        self.assertEqual(json.loads((self.cache / "current.json").read_text())["commit"], "a" * 40)

    def test_corrupt_file_not_published(self):
        self.manifest["artifacts"][0]["sha256"] = "0" * 64
        self.assertEqual(self.sync(), 1)
        self.assertFalse((self.cache / "current.json").exists())

    def test_path_traversal_rejected(self):
        self.manifest["artifacts"][0]["filename"] = "../escape"
        with self.assertRaises(ValueError):
            validate(self.manifest, allow_local=True)

    def test_short_sha_rejected(self):
        self.manifest["commit"] = "a" * 12
        with self.assertRaises(ValueError):
            validate(self.manifest, allow_local=True)

    def test_current_only_retention(self):
        self.assertEqual(self.sync(), 0)
        self.manifest["commit"] = "b" * 40
        self.manifest["artifacts"][0]["build_commit"] = "b" * 40
        self.assertEqual(self.sync(), 0)
        self.assertEqual(json.loads((self.cache / "current.json").read_text())["commit"], "b" * 40)
        self.assertFalse((self.cache / "packages" / ("a" * 40)).exists())
        self.assertTrue((self.cache / "manifests" / ("a" * 40 + ".json")).exists())

    def test_failed_new_target_preserves_previous(self):
        self.assertEqual(self.sync(), 0)
        self.manifest["commit"] = "b" * 40
        self.manifest["artifacts"][0]["build_commit"] = "b" * 40
        self.manifest["artifacts"][0]["sha256"] = "0" * 64
        self.assertEqual(self.sync(), 1)
        self.assertEqual(json.loads((self.cache / "current.json").read_text())["commit"], "a" * 40)


    def test_server_install_lock_out_ranks_client_download(self):
        from release_bundle import _install_busy
        lock = self.root / "install.lock"
        with lock.open("a+b") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertTrue(_install_busy(lock))
            fcntl.flock(held, fcntl.LOCK_UN)
        self.assertFalse(_install_busy(lock))

    def test_gitlab_failure_falls_back_to_verified_github(self):
        url = f"http://127.0.0.1:{self.http.server_port}/"
        self.manifest["artifacts"][0]["sources"]["gitlab"] = url + "missing.ipa"
        self.manifest["artifacts"][0]["sources"]["github"] = url + "pkg.ipa"
        self.assertEqual(self.sync(), 0)
        self.assertEqual(
            (self.cache / "packages" / ("a" * 40) / "pkg.ipa").read_bytes(), self.data,
        )

    def test_reject_changed_immutable_manifest(self):
        self.assertEqual(self.sync(), 0)
        self.manifest["channel"] = "stable"
        with self.assertRaises(ValueError):
            self.sync()

    def test_published_permissions_allow_read_only_server(self):
        self.assertEqual(self.sync(), 0)
        root = self.cache / "packages"
        sha = root / ("a" * 40)
        package = sha / "pkg.ipa"
        self.assertEqual(root.stat().st_mode & 0o777, 0o755)
        self.assertEqual(sha.stat().st_mode & 0o777, 0o755)
        self.assertEqual(package.stat().st_mode & 0o777, 0o644)

    def test_external_origins_rejected(self):
        self.manifest["artifacts"][0]["sources"]["github"] = "https://evil.example/pkg.ipa"
        with self.assertRaises(ValueError):
            validate(self.manifest)

    def test_build_commit_mismatch_rejected(self):
        self.manifest["artifacts"][0]["build_commit"] = "b" * 40
        with self.assertRaises(ValueError):
            validate(self.manifest, allow_local=True)


if __name__ == "__main__":
    unittest.main()
