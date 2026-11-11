#!/usr/bin/env python3
"""Synthetic integrity negatives; actual NAS/HEIC/video restore remains physical D."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib

SCRIPT = Path(__file__).with_name("verify-nas-photo-original.py")


def _crc(data):
    return f"{zlib.crc32(data) & 0xffffffff:08x}"


class NASOriginalProofTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = self.root / "original.zip"
        self.still = b"synthetic-still-not-a-real-HEIC"
        self.motion = b"synthetic-motion-not-a-real-MOV"

    def make_live(self, tamper=False, extra=False, bad_name=False):
        entries = [
            {"role": "still", "path": "media/still.heic",
             "originalFilename": "test.heic", "bytes": len(self.still),
             "crc32": _crc(self.still)},
            {"role": "motion", "path": "../motion.mov" if bad_name else "media/motion.mov",
             "originalFilename": "test.mov", "bytes": len(self.motion),
             "crc32": _crc(self.motion)},
        ]
        if tamper:
            entries[1]["crc32"] = "00000000"
        manifest = {"format": "xdrive-live-originals", "version": 1,
                    "resources": entries}
        with zipfile.ZipFile(self.original, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("media/still.heic", self.still)
            archive.writestr("media/motion.mov", self.motion)
            archive.writestr("manifest.json", json.dumps(manifest))
            if extra:
                archive.writestr("private.txt", "unexpected")

    def run_check(self, kind="live", size=None, sha=None, file=None):
        path = file or self.original
        data = path.read_bytes() if path.exists() and not path.is_symlink() else b""
        argv = [sys.executable, str(SCRIPT), "--file", str(path),
                "--expected-sha256", sha or hashlib.sha256(data).hexdigest(),
                "--expected-bytes", str(size if size is not None else len(data)),
                "--kind", kind]
        return subprocess.run(argv, capture_output=True, text=True, check=False)

    def test_valid_two_resource_live_archive(self):
        self.make_live()
        proc = self.run_check()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["live_parts"], 2)
        self.assertFalse(result["full_decode"])

    def test_node_hash_or_size_mismatch_rejected(self):
        self.make_live()
        self.assertNotEqual(self.run_check(sha="0"*64).returncode, 0)
        self.assertNotEqual(self.run_check(size=1).returncode, 0)

    def test_corrupt_manifest_crc_rejected(self):
        self.make_live(tamper=True)
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_unexpected_member_and_path_escape_rejected(self):
        self.make_live(extra=True)
        self.assertNotEqual(self.run_check().returncode, 0)
        self.make_live(bad_name=True)
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_symlink_original_denied(self):
        self.make_live()
        link = self.root / "shortcut"
        link.symlink_to(self.original)
        self.assertNotEqual(self.run_check(file=link).returncode, 0)

    def test_plain_media_hash_is_not_decoder_proof(self):
        path = self.root / "video.mov"
        path.write_bytes(b"invalid-video")
        proc = self.run_check(kind="video", file=path)
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stdout)["full_decode"])


if __name__ == "__main__":
    unittest.main()
