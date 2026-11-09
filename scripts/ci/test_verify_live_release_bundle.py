"""Deterministic acceptance-gate tests; no production GitHub/Host mutation."""
import hashlib
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

    def test_sigstore_requires_verifier_without_trust_downgrade(self):
        with patch.object(audit.shutil, "which", return_value=None):
            with self.assertRaisesRegex(audit.GateError, "gh CLI"):
                audit.check_sigstore(COMMIT, self.raw)

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


if __name__ == "__main__":
    unittest.main()
