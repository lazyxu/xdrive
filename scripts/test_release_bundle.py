"""Release Bundle worker contract and local HTTP transfer tests."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import fcntl
import json
import os
from pathlib import Path
import subprocess
import time
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

    def test_superseded_installed_commit_cannot_publish_stale_packages(self):
        from release_bundle import sync
        self.assertEqual(self.sync(), 0)
        current = self.cache / "current.json"
        self.manifest["commit"] = "b" * 40
        self.manifest["artifacts"][0]["build_commit"] = "b" * 40
        env = self.root / ".env"
        env.write_text("XD_RELEASE_COMMIT=" + ("c" * 40) + "\n", encoding="utf-8")
        self.assertEqual(sync(self.manifest, self.cache, retries=1, allow_local=True, installed_env=env), 0)
        self.assertEqual(json.loads(current.read_text())["commit"], "a" * 40)

    def test_github_commit_tag_and_all_asset_digests_anchor_manifest(self):
        from release_bundle import _verify_published_release
        commit = self.manifest["commit"]
        raw = json.dumps(self.manifest, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        ref = {"ref": "refs/tags/bundle-" + commit,
               "object": {"type": "commit", "sha": commit}}
        release = {
            "tag_name": "bundle-" + commit,
            "draft": False, "prerelease": True,
            "assets": [
                {"name": "release-bundle.json", "size": len(raw),
                 "digest": "sha256:" + hashlib.sha256(raw).hexdigest()},
                {"name": "pkg.ipa", "size": len(self.data),
                 "digest": "sha256:" + hashlib.sha256(self.data).hexdigest()},
            ],
        }
        _verify_published_release(commit, raw, self.manifest, ref, release)
        changed = json.loads(json.dumps(release))
        changed["assets"][1]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            _verify_published_release(commit, raw, self.manifest, ref, changed)
        changed = json.loads(json.dumps(ref))
        changed["object"]["sha"] = "b" * 40
        with self.assertRaisesRegex(ValueError, "source commit"):
            _verify_published_release(commit, raw, self.manifest, changed, release)
        changed = json.loads(json.dumps(release))
        changed["assets"].pop()
        with self.assertRaisesRegex(ValueError, "asset"):
            _verify_published_release(commit, raw, self.manifest, ref, changed)
        changed = json.loads(json.dumps(release))
        changed["draft"] = True
        with self.assertRaisesRegex(ValueError, "identity"):
            _verify_published_release(commit, raw, self.manifest, ref, changed)

    def test_external_origins_rejected(self):
        self.manifest["artifacts"][0]["sources"]["github"] = "https://evil.example/pkg.ipa"
        with self.assertRaises(ValueError):
            validate(self.manifest)

    def test_build_commit_mismatch_rejected(self):
        self.manifest["artifacts"][0]["build_commit"] = "b" * 40
        with self.assertRaises(ValueError):
            validate(self.manifest, allow_local=True)


    def test_partial_current_commit_publish_and_retry(self):
        other_data = b"second-platform-installer" * 40
        second = {
            "platform": "windows", "filename": "missing.exe",
            "build_commit": self.manifest["commit"], "size": len(other_data),
            "sha256": hashlib.sha256(other_data).hexdigest(),
            "sources": {
                "gitlab": f"http://127.0.0.1:{self.http.server_port}/missing.exe",
                "github": f"http://127.0.0.1:{self.http.server_port}/missing.exe",
            },
        }
        self.manifest["artifacts"].append(second)
        self.assertEqual(self.sync(), 1)
        sha = self.manifest["commit"]
        self.assertEqual(json.loads((self.cache / "current.json").read_text())["commit"], sha)
        self.assertEqual((self.cache / "packages" / sha / "pkg.ipa").read_bytes(), self.data)
        self.assertFalse((self.cache / "packages" / sha / "missing.exe").exists())
        status = json.loads((self.cache / "status.json").read_text())
        self.assertEqual(status["state"], "retry_needed")
        self.assertEqual(status["artifacts"]["pkg.ipa"], "verified")
        self.assertEqual(status["artifacts"]["missing.exe"], "missing_upstream")
        # A later upstream publication must not mutate immutable metadata;
        # only the missing package's verified bytes are added to the cache.
        (self.root / "missing.exe").write_bytes(other_data)
        self.assertEqual(self.sync(), 0)
        self.assertEqual((self.cache / "packages" / sha / "missing.exe").read_bytes(), other_data)
        status = json.loads((self.cache / "status.json").read_text())
        self.assertEqual(status["state"], "ready")
        self.assertTrue(all(value == "verified" for value in status["artifacts"].values()))

    def test_dependency_phase_finishes_before_install_lock_is_released(self):
        from release_bundle import _install_busy
        lock = self.root / "install.lock"
        marker = self.root / "dependency-busy"
        ready = self.root / "dependency-ready"
        with lock.open("a+b") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Missing busy marker cannot let packages compete during startup.
            self.assertTrue(_install_busy(lock, marker))
            marker.write_text("installing", encoding="utf-8")
            self.assertTrue(_install_busy(lock, marker))
            ready.write_text("dependencies ready", encoding="utf-8")
            self.assertTrue(_install_busy(lock, marker))
            marker.unlink()
            self.assertFalse(_install_busy(lock, marker))
            # A new dependency phase revokes the permission immediately.
            marker.touch()
            self.assertTrue(_install_busy(lock, marker))
            ready.unlink()
            marker.unlink()
            self.assertTrue(_install_busy(lock, marker))
            fcntl.flock(held, fcntl.LOCK_UN)
        self.assertFalse(_install_busy(lock, marker))

    def test_active_transfer_pauses_and_resumes_from_partial(self):
        from unittest.mock import patch
        from release_bundle import _download
        payload = b"xdrive-resume-verification" * 80
        checksum = hashlib.sha256(payload).hexdigest()
        target = self.root / "resume.ipa"
        marker = self.root / "dependency-busy"

        class FakeResponse:
            def __init__(self, status, body, headers=None, busy_after_first_read=False):
                self.status = status
                self.headers = headers or {}
                self.body = body
                self.cursor = 0
                self.busy_after_first_read = busy_after_first_read

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, count):
                if self.cursor >= len(self.body):
                    return b""
                n = min(count, 125, len(self.body) - self.cursor)
                data = self.body[self.cursor:self.cursor+n]
                self.cursor += n
                if self.busy_after_first_read:
                    self.busy_after_first_read = False
                    marker.touch()
                return data

        with patch("release_bundle.OPENER.open", return_value=FakeResponse(
            200, payload, busy_after_first_read=True
        )):
            with self.assertRaises(InterruptedError):
                _download("http://127.0.0.1/test", target, len(payload), checksum, None, marker)
        partial = target.with_name(target.name + ".part")
        self.assertEqual(partial.read_bytes(), payload[:125])
        self.assertFalse(target.exists())
        marker.unlink()
        with patch("release_bundle.OPENER.open", return_value=FakeResponse(
            206, payload[125:], {"Content-Range": f"bytes 125-{len(payload)-1}/{len(payload)}"}
        )):
            _download("http://127.0.0.1/test", target, len(payload), checksum, None, marker)
        self.assertEqual(target.read_bytes(), payload)
        self.assertFalse(partial.exists())


    def test_host_control_explicit_retry_rechecks_ready_cache(self):
        """The admin retry must not be swallowed by the ready-status fast path."""
        home = self.root / "host-home"
        for name in ("bin", "config", "logs", "state", "data/release-bundles"):
            (home / name).mkdir(parents=True, exist_ok=True)
        commit = "a" * 40
        cache = home / "data" / "release-bundles"
        (cache / "current.json").write_text(
            json.dumps({"commit": commit}, separators=(",", ":")), encoding="utf-8",
        )
        (cache / "status.json").write_text(
            json.dumps({"commit": commit, "state": "ready"}, separators=(",", ":")),
            encoding="utf-8",
        )
        (home / "config" / ".env").write_text(
            f"XD_RELEASE_COMMIT={commit}\\n"
            f"XD_RELEASE_BUNDLE_HOST_DIR={cache}\\n", encoding="utf-8",
        )
        # The runner uses a tiny inert worker, rather than contacting GitHub.
        # It records only invocation, so this test cannot publish packages.
        (home / "bin" / "release_bundle.py").write_text(
            "import os\\nfrom pathlib import Path\\n"
            "Path(os.environ['XD_RELEASE_TEST_MARKER']).write_text('called')\\n",
            encoding="utf-8",
        )
        launched = self.root / "worker-invoked"
        env = {**os.environ, "XD_CONFIG_DIR": str(home),
               "XD_HOST_CONTROL_SOURCE_ONLY": "1",
               "XD_RELEASE_TEST_MARKER": str(launched)}
        script = Path(__file__).resolve().parents[1] / "scripts" / "server-control.sh"
        for mode in ("", "true"):
            run = subprocess.run(
                ["bash", "-c", 'source "$1"; release_bundle_enqueue "$2"', "test",
                 str(script), mode],
                cwd=self.root, env=env, capture_output=True, text=True, timeout=8,
            )
            self.assertEqual(run.returncode, 0, run.stderr)
            if not mode:
                self.assertFalse(launched.exists(), "normal ready-cache poll spawned worker")
            else:
                deadline = time.monotonic() + 3
                while not launched.exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(launched.exists(),
                    "admin retry was silently ignored for a ready cache")


if __name__ == "__main__":
    unittest.main()
