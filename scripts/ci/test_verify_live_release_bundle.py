"""Deterministic acceptance-gate tests; no production GitHub/Host mutation."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).with_name("verify-live-release-bundle.py")
SPEC = importlib.util.spec_from_file_location("verify_live_bundle", HERE)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
COMMIT = "a" * 40


class LiveReleaseBundleGateTests(unittest.TestCase):
    def setUp(self):
        self.payload = b"verified-package" * 20
        self.sha = hashlib.sha256(self.payload).hexdigest()
        self.item = {
            "platform": "linux", "filename": "xdrive-linux-amd64.deb",
            "build_commit": COMMIT, "size": len(self.payload), "sha256": self.sha,
            "install_mode": "manual",
            "sources": {
                "gitlab": ("http://gitlab.t-fluid.com:1080/api/v4/projects/"
                           "xuliang%2Fxdrive/packages/generic/xdrive-build-packages/"
                           "sha-" + COMMIT + "/xdrive-linux-amd64.deb"),
                "github": ("https://github.com/lazyxu/xdrive/releases/download/"
                           "bundle-" + COMMIT + "/xdrive-linux-amd64.deb"),
            },
        }
        self.manifest = {"schema_version": 1, "commit": COMMIT,
                         "channel": "master", "artifacts": [self.item]}
        self.raw = (json.dumps(self.manifest, sort_keys=True,
                               separators=(",", ":")) + "\n").encode()
        self.ref = {"ref": "refs/tags/bundle-" + COMMIT,
                    "object": {"type": "commit", "sha": COMMIT}}
        self.release = {"tag_name": "bundle-" + COMMIT, "draft": False, "prerelease": True,
                        "assets": [
                            {"name": "release-bundle.json", "size": len(self.raw),
                             "digest": "sha256:" + hashlib.sha256(self.raw).hexdigest()},
                            {"name": self.item["filename"], "size": len(self.payload),
                             "digest": "sha256:" + self.sha},
                        ]}

    def check(self):
        def fake_json(url):
            return self.ref if "/git/ref/" in url else self.release
        return audit.check_release(COMMIT, fake_json, lambda _url: self.raw)

    def test_release_exact_commit_and_asset_inventory(self):
        manifest, raw = self.check()
        self.assertEqual(manifest, self.manifest)
        self.assertEqual(raw, self.raw)

    def test_platform_immutable_release_required_for_production_acceptance(self):
        self.release["immutable"] = False
        def json_data(url):
            return self.ref if "/git/ref/" in url else self.release
        with self.assertRaisesRegex(audit.GateError, "mutable"):
            audit.check_release(COMMIT, json_data, lambda _url: self.raw,
                                require_immutable=True)
        # A source-level no-clobber publisher is not an immutable GitHub
        # Release. Only the platform's explicit immutable=true is accepted.
        self.release["immutable"] = True
        manifest, _ = audit.check_release(COMMIT, json_data,
                                           lambda _url: self.raw,
                                           require_immutable=True)
        self.assertEqual(manifest["commit"], COMMIT)

    def test_reject_wrong_commit_or_changed_remote_digest(self):
        self.ref["object"]["sha"] = "b" * 40
        with self.assertRaises(ValueError):
            self.check()
        self.ref["object"]["sha"] = COMMIT
        self.release["assets"][1]["digest"] = "sha256:" + "0" * 64
        with self.assertRaises(ValueError):
            self.check()

    def test_api_refuses_stale_or_cross_commit_and_wrong_package_hash(self):
        item = dict(self.item)
        item.update({"cached": True, "download_urls": [
            "/api/v1/release-bundles/current/artifacts/" + self.item["filename"],
            self.item["sources"]["gitlab"], self.item["sources"]["github"],
        ]})
        listing = {"commit": COMMIT, "artifacts": [item]}
        self.assertEqual(audit.check_server_listing(COMMIT, self.manifest, listing), 1)
        listing["commit"] = "b" * 40
        with self.assertRaises(audit.GateError):
            audit.check_server_listing(COMMIT, self.manifest, listing)
        listing["commit"] = COMMIT
        item["sha256"] = "0" * 64
        with self.assertRaises(audit.GateError):
            audit.check_server_listing(COMMIT, self.manifest, listing)
        item["sha256"] = self.sha
        item["download_urls"] = [
            self.item["sources"]["github"], self.item["sources"]["gitlab"],
        ]
        with self.assertRaisesRegex(audit.GateError, "source order"):
            audit.check_server_listing(COMMIT, self.manifest, listing)
        item["download_urls"] = ["https://untrusted.example.invalid/swap"]
        with self.assertRaisesRegex(audit.GateError, "source order"):
            audit.check_server_listing(COMMIT, self.manifest, listing)
        item["cached"] = False
        item["download_urls"] = [self.item["sources"]["gitlab"],
                                  self.item["sources"]["github"]]
        self.assertEqual(audit.check_server_listing(COMMIT, self.manifest, listing), 1)
        item["cached"] = True
        with self.assertRaisesRegex(audit.GateError, "source order"):
            audit.check_server_listing(COMMIT, self.manifest, listing)

    def test_host_ready_requires_actual_bytes_and_install_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cache = home / "data/release-bundles"
            (home / "config").mkdir(parents=True)
            (home / "config/.env").write_text("XD_RELEASE_COMMIT=" + COMMIT + "\n")
            (cache / "manifests").mkdir(parents=True)
            (cache / "packages" / COMMIT).mkdir(parents=True)
            (cache / "manifests" / (COMMIT + ".json")).write_bytes(self.raw)
            (cache / "current.json").write_text(json.dumps({"commit": COMMIT}))
            (cache / "status.json").write_text(json.dumps({
                "commit": COMMIT, "state": "ready",
                "artifacts": {self.item["filename"]: "verified"},
            }))
            dest = cache / "packages" / COMMIT / self.item["filename"]
            dest.write_bytes(self.payload)
            self.assertEqual(audit.check_host(home, COMMIT, self.manifest),
                             [self.item["filename"]])
            dest.write_bytes(b"X" * len(self.payload))
            with self.assertRaisesRegex(audit.GateError, "bytes changed"):
                audit.check_host(home, COMMIT, self.manifest)
            dest.write_bytes(self.payload)
            (home / "config/.env").write_text("XD_RELEASE_COMMIT=" + "b" * 40 + "\n")
            with self.assertRaisesRegex(audit.GateError, "differs"):
                audit.check_host(home, COMMIT, self.manifest)

    def test_host_partial_current_commit_is_usable_without_faking_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cache = home / "data/release-bundles"
            (home / "config").mkdir(parents=True)
            (home / "config/.env").write_text("XD_RELEASE_COMMIT=" + COMMIT + "\n")
            (cache / "manifests").mkdir(parents=True)
            (cache / "packages" / COMMIT).mkdir(parents=True)
            second = dict(self.item, filename="other-platform.exe", platform="windows")
            second["sources"] = {
                "gitlab": self.item["sources"]["gitlab"].replace(
                    "xdrive-linux-amd64.deb", "other-platform.exe"),
                "github": self.item["sources"]["github"].replace(
                    "xdrive-linux-amd64.deb", "other-platform.exe"),
            }
            manifest = dict(self.manifest, artifacts=[self.item, second])
            (cache / "manifests" / (COMMIT + ".json")).write_text(
                json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n")
            (cache / "current.json").write_text(json.dumps({"commit": COMMIT}))
            status = {"commit": COMMIT, "state": "retry_needed",
                      "artifacts": {self.item["filename"]: "verified",
                                    second["filename"]: "missing_upstream"}}
            (cache / "status.json").write_text(json.dumps(status))
            (cache / "packages" / COMMIT / self.item["filename"]).write_bytes(self.payload)
            self.assertEqual(audit.check_host(home, COMMIT, manifest),
                             [self.item["filename"]])
            with self.assertRaisesRegex(audit.GateError, "partially verified"):
                audit.check_host(home, COMMIT, manifest, require_complete=True)
            (cache / "packages" / COMMIT / second["filename"]).write_bytes(self.payload)
            with self.assertRaisesRegex(audit.GateError, "unverified package"):
                audit.check_host(home, COMMIT, manifest)
            (cache / "packages" / COMMIT / second["filename"]).unlink()
            status["artifacts"][self.item["filename"]] = "verification_failed"
            (cache / "status.json").write_text(json.dumps(status))
            # Even a correct-size file must be rejected if the Host marks its
            # provenance as unverified; it must never be exposed to clients.
            with self.assertRaisesRegex(audit.GateError, "unverified package"):
                audit.check_host(home, COMMIT, manifest)
            (cache / "packages" / COMMIT / self.item["filename"]).unlink()
            # An empty retry-needed cache is not a usable verified subset.
            with self.assertRaisesRegex(audit.GateError, "no verified subset"):
                audit.check_host(home, COMMIT, manifest)

    def test_sigstore_requires_verifier_without_trust_downgrade(self):
        with patch.object(audit.shutil, "which", return_value=None):
            with self.assertRaisesRegex(audit.GateError, "gh CLI"):
                audit.check_sigstore(COMMIT, self.raw)


    def test_authenticated_resume_download_requires_exact_ranges_and_digest(self):
        payload = self.payload
        commit = COMMIT
        calls = []
        class Server(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return
            def do_GET(self):
                calls.append((self.path, self.headers.get("Range"),
                              self.headers.get("Authorization")))
                if self.headers.get("Authorization") != "Bearer live-test-owner":
                    self.send_error(401)
                    return
                if not self.path.endswith("xdrive-linux-amd64.deb"):
                    self.send_error(404)
                    return
                requested = self.headers["Range"]
                first, last = (int(x) for x in requested.removeprefix("bytes=").split("-"))
                chunk = payload[first:last + 1]
                self.send_response(206)
                self.send_header("Content-Range",
                                 "bytes %d-%d/%d" % (first, last, len(payload)))
                self.send_header("Content-Length", str(len(chunk)))
                self.end_headers()
                self.wfile.write(chunk)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Server)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            item = dict(self.item, cached=True)
            origin = "http://127.0.0.1:" + str(server.server_port)
            self.assertTrue(audit.check_authenticated_range_download(
                origin, "live-test-owner", item))
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0][1], "bytes=0-" + str(len(payload)//2-1))
            self.assertEqual(calls[1][1], "bytes=" + str(len(payload)//2) + "-" +
                             str(len(payload)-1))
            item["sha256"] = "0" * 64
            with self.assertRaisesRegex(audit.GateError, "SHA-256"):
                audit.check_authenticated_range_download(origin, "live-test-owner", item)
        finally:
            server.shutdown()
            server.server_close()

    def test_sigstore_requires_master_ref_and_never_passes_owner_token(self):
        from types import SimpleNamespace
        proof = {"verificationResult": {"signature": {"certificate": {
            "sourceRepositoryIdentifier": audit.REPO_ID,
        }}}}
        with patch.object(audit.shutil, "which", return_value="/usr/bin/gh"), \
             patch.object(audit.subprocess, "run", return_value=SimpleNamespace(
                 returncode=0, stdout=json.dumps([proof]), stderr="")) as run, \
             patch.dict(audit.os.environ, {"XD_BUNDLE_OWNER_TOKEN": "secret-test-token"}):
            audit.check_sigstore(COMMIT, self.raw)
            command = run.call_args.args[0]
            self.assertEqual(command[command.index("--source-ref") + 1],
                             "refs/heads/master")
            self.assertEqual(command[command.index("--source-digest") + 1], COMMIT)
            self.assertNotIn("XD_BUNDLE_OWNER_TOKEN", run.call_args.kwargs["env"])


    def test_mirror_origin_guards_block_private_redirect_and_unpinned_sources(self):
        from urllib.request import Request
        github = audit.PinnedPublicRedirect("github")
        good = Request("https://github.com/lazyxu/xdrive/releases/download/bundle-" +
                       COMMIT + "/xdrive-linux-amd64.deb")
        self.assertIsNotNone(github.redirect_request(
            good, None, 302, "Found", {}, "https://release-assets.githubusercontent.com/object?sig=a"))
        with self.assertRaisesRegex(audit.GateError, "unapproved redirect"):
            github.redirect_request(good, None, 302, "Found", {},
                                    "http://127.0.0.1:8888/private")
        with self.assertRaisesRegex(audit.GateError, "unapproved redirect"):
            github.redirect_request(good, None, 302, "Found", {},
                                    "https://attacker.example.invalid/x")
        gitlab = audit.PinnedPublicRedirect("gitlab")
        start = Request(self.item["sources"]["gitlab"])
        self.assertIsNotNone(gitlab.redirect_request(
            start, None, 302, "Found", {}, "http://gitlab.t-fluid.com:1080/asset"))
        with self.assertRaisesRegex(audit.GateError, "unapproved redirect"):
            gitlab.redirect_request(start, None, 302, "Found", {}, "http://localhost:9999/x")
        forged = dict(self.item, sources={
            "gitlab": "http://127.0.0.1:88/private",
            "github": "https://attacker.example.invalid/asset",
        })
        with self.assertRaisesRegex(audit.GateError, "pinned Commit"):
            audit.check_remote_bytes(forged, "github")
        with self.assertRaisesRegex(audit.GateError, "pinned Commit"):
            audit.check_remote_bytes(forged, "gitlab")

    def test_unsigned_ipa_never_an_auto_install_admission(self):
        item = dict(self.item, platform="ios", filename="xDrive-unsigned.ipa",
                    install_mode="manual")
        item["sources"] = {
            "github": "https://github.com/lazyxu/xdrive/releases/download/bundle-" +
                      COMMIT + "/xDrive-unsigned.ipa",
            "gitlab": "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/packages/generic/xdrive-build-packages/sha-" +
                      COMMIT + "/xDrive-unsigned.ipa",
        }
        doc = dict(self.manifest, artifacts=[item])
        with self.assertRaisesRegex(ValueError, "testing only"):
            audit.validate(doc, expected_commit=COMMIT)


    def test_live_download_requires_a_real_cached_package_and_respects_partial_cache(self):
        cached = dict(self.item, cached=True)
        upstream_only = dict(self.item, filename="optional-dsm.spk", cached=False)
        self.assertEqual(audit.require_verified_cached_artifacts(
            {"artifacts": [cached, upstream_only]}), [cached])
        for items in ([], [upstream_only]):
            with self.assertRaisesRegex(audit.GateError, "no verified"):
                audit.require_verified_cached_artifacts({"artifacts": items})

    def test_live_cli_never_calls_range_on_upstream_only_platform(self):
        from io import StringIO
        cached = dict(self.item, cached=True)
        pending = dict(self.item, filename="optional-dsm.spk", cached=False)
        listing = {"commit": COMMIT, "artifacts": [cached, pending]}
        with patch.object(audit, "check_release", return_value=(self.manifest, self.raw)), \
             patch.object(audit, "server_listing", return_value=listing), \
             patch.object(audit, "check_server_listing", return_value=2), \
             patch.object(audit, "check_authenticated_range_download", return_value=True) as transfer, \\
             patch.object(audit, "check_unauthenticated_denial", return_value=2) as denial, \\
             patch.dict(audit.os.environ, {"XD_BUNDLE_OWNER_TOKEN": "fixture"}), \
             patch("sys.stdout", new_callable=StringIO) as output:
            result = audit.main(["--commit", COMMIT, "--server-url", "https://example.test",
                                 "--check-server-download", "--check-auth-denial"])
            self.assertEqual(result, 0)
            self.assertEqual(transfer.call_count, 1)
            self.assertEqual(transfer.call_args.args[2]["filename"], cached["filename"])
            self.assertEqual(denial.call_count, 1)
            report = json.loads(output.getvalue())
            self.assertEqual(report["range_verified_packages"], 1)
            self.assertEqual(report["guest_denial"], "verified")
        listing["artifacts"] = [dict(cached, cached=False)]
        with patch.object(audit, "check_release", return_value=(self.manifest, self.raw)), \
             patch.object(audit, "server_listing", return_value=listing), \
             patch.object(audit, "check_server_listing", return_value=1), \
             patch.object(audit, "check_authenticated_range_download") as transfer, \\
             patch("sys.stderr", new_callable=StringIO) as errors:
            result = audit.main(["--commit", COMMIT, "--server-url", "https://example.test",
                                 "--check-server-download"])
            self.assertEqual(result, 1)
            transfer.assert_not_called()
            self.assertIn("no verified", errors.getvalue())

    def test_real_guest_metadata_and_cached_installer_are_denied(self):
        requests = []
        class Server(BaseHTTPRequestHandler):
            expose = False
            missing = False
            def log_message(self, *_args):
                return
            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                if self.expose and self.path.endswith("/current"):
                    self.send_response(200)
                elif self.missing and "/artifacts/" in self.path:
                    self.send_response(404)
                else:
                    self.send_response(401)
                self.end_headers()
        server = ThreadingHTTPServer(("127.0.0.1", 0), Server)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = "http://127.0.0.1:" + str(server.server_port)
            self.assertEqual(audit.check_unauthenticated_denial(
                origin, sample_cached=self.item), 2)
            self.assertEqual(len(requests), 2)
            self.assertTrue(all(auth is None for _, auth in requests))
            Server.expose = True
            with self.assertRaisesRegex(audit.GateError, "exposed"):
                audit.check_unauthenticated_denial(origin, sample_cached=self.item)
            Server.expose = False
            Server.missing = True
            with self.assertRaisesRegex(audit.GateError, "HTTP 404"):
                audit.check_unauthenticated_denial(origin, sample_cached=self.item)
        finally:
            server.shutdown()
            server.server_close()



if __name__ == "__main__":
    unittest.main()
