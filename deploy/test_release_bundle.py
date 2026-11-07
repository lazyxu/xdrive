"""Release Bundle cache worker tests (no external network)."""
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from functools import partial
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
        self.manifest = {
            "schema_version": 1, "commit": "a" * 40,
            "artifacts": [{
                "platform": "ios", "filename": "pkg.ipa",
                "size": len(self.data), "sha256": hashlib.sha256(self.data).hexdigest(),
                "sources": {
                    "gitlab": f"http://127.0.0.1:{self.http.server_port}/pkg.ipa",
                    "github": "https://github.com/lazyxu/xdrive/releases/download/test/pkg.ipa",
                }
            }]
        }
        self.path = self.root / "manifest.json"
        self.cache = self.root / "cache"

    def run_sync(self):
        self.path.write_text(json.dumps(self.manifest))
        return sync(self.path, self.cache, self.root / "dependencies-not-busy", retries=1)

    def test_verified_publish(self):
        self.assertEqual(self.run_sync(), 0)
        self.assertEqual((self.cache / "current/pkg.ipa").read_bytes(), self.data)
        self.assertEqual(json.loads((self.cache / "status.json").read_text())["state"], "ready")

    def test_corrupt_file_not_published(self):
        self.manifest["artifacts"][0]["sha256"] = "0" * 64
        self.assertEqual(self.run_sync(), 1)
        self.assertFalse((self.cache / "current").exists())

    def test_path_traversal_rejected(self):
        self.manifest["artifacts"][0]["filename"] = "../escape"
        with self.assertRaises(ValueError):
            validate(self.manifest)

    def test_short_sha_rejected(self):
        self.manifest["commit"] = "a" * 12
        with self.assertRaises(ValueError):
            validate(self.manifest)

    def test_current_only_retention(self):
        self.assertEqual(self.run_sync(), 0)
        self.manifest["commit"] = "b" * 40
        self.assertEqual(self.run_sync(), 0)
        self.assertEqual(json.loads((self.cache / "current/manifest.json").read_text())["commit"], "b" * 40)
        self.assertFalse((self.cache / ".previous").exists())


if __name__ == "__main__":
    unittest.main()
