#!/usr/bin/env python3
"""Regression matrix for the GitLab core image release manifest gate."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts/ci/verify-gitlab-core-manifest.py"
SHA = "a" * 40
DIGEST_SERVER = "sha256:" + "b" * 64
DIGEST_CADDY = "sha256:" + "c" * 64
REGISTRY = "registry.example.invalid/xdrive"


def manifest(tag="sha-" + SHA[:12], channel="master", registry=REGISTRY, commit=SHA):
    return (
        f"commit\t{commit}\n"
        f"channel\t{channel}\n"
        f"image\txdrive-server\t{registry}/xdrive-server:{tag}\t{DIGEST_SERVER}\n"
        f"image\txdrive-caddy\t{registry}/xdrive-caddy:{tag}\t{DIGEST_CADDY}\n"
    )


class CoreManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="xdrive-core-image-manifest-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = self.root / "image-manifest.tsv"
        self.env = dict(os.environ, CI_COMMIT_SHA=SHA,
                        CI_COMMIT_BRANCH="master", CI_COMMIT_TAG="",
                        CI_REGISTRY_IMAGE=REGISTRY)
        self.file.write_text(manifest(), encoding="utf-8")

    def check(self, expect_good, *, env=None):
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), str(self.file)],
            cwd=self.root, env=env or self.env, text=True, capture_output=True,
            timeout=10,
        )
        if expect_good:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn("rejected", result.stderr)
        return result

    def test_valid_master_and_stable(self):
        self.check(True)
        self.file.write_text(manifest(tag="v1.2.3", channel="stable"))
        self.check(True, env=dict(self.env, CI_COMMIT_TAG="v1.2.3", CI_COMMIT_BRANCH=""))

    def test_reject_duplicate_missing_foreign_or_malformed_core_images(self):
        valid = manifest()
        rows = valid.splitlines()
        bad_cases = {
            "duplicate-server": "\n".join(rows[:3] + [rows[2]]) + "\n",
            "duplicate-caddy": "\n".join(rows[:2] + [rows[3], rows[3]]) + "\n",
            "wrong-order": "\n".join(rows[:2] + [rows[3], rows[2]]) + "\n",
            "missing-image": "\n".join(rows[:3]) + "\n",
            "extra-image": valid + rows[3] + "\n",
            "wrong-commit": valid.replace("commit\t" + SHA, "commit\t" + "d" * 40),
            "wrong-channel": valid.replace("channel\tmaster", "channel\tstable"),
            "foreign-registry": valid.replace(REGISTRY, "registry.attacker.invalid/other"),
            "foreign-tag": valid.replace(":sha-" + SHA[:12], ":sha-" + "d" * 12),
            "missing-digest": valid.replace(DIGEST_CADDY, ""),
            "short-digest": valid.replace(DIGEST_SERVER, "sha256:0123"),
            "nonhex-digest": valid.replace(DIGEST_SERVER, "sha256:" + "z" * 64),
            "empty-line": valid + "\n",
            "no-final-newline": valid.rstrip("\n"),
            "crlf": valid.replace("\n", "\r\n"),
            "nul": valid.replace("image\txdrive-caddy", "image\0xdrive-caddy"),
            "not-utf8": valid.encode()[:-1] + b"\xff\n",
        }
        for name, invalid in bad_cases.items():
            with self.subTest(case=name):
                self.file.write_bytes(invalid if isinstance(invalid, bytes) else invalid.encode())
                self.check(False)

    def test_reject_invalid_ci_environment(self):
        for case, changes in {
            "short-commit": {"CI_COMMIT_SHA": "abc"},
            "empty-registry": {"CI_REGISTRY_IMAGE": ""},
            "wrong-registry": {"CI_REGISTRY_IMAGE": "registry.example.invalid/xdrive/"},
            "unknown-branch": {"CI_COMMIT_BRANCH": "feature"},
            "invalid-stable-tag": {"CI_COMMIT_TAG": "vbad"},
        }.items():
            with self.subTest(case=case):
                self.check(False, env=dict(self.env, **changes))

    def test_reject_symlink_and_nonregular_input(self):
        other = self.root / "real"
        other.write_text(manifest())
        self.file.unlink()
        self.file.symlink_to(other)
        self.check(False)
        self.file.unlink()
        self.file.mkdir()
        self.check(False)


if __name__ == "__main__":
    unittest.main()
