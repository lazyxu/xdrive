#!/usr/bin/env python3
"""Offline regression tests; never contact Gen10 or Docker."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("xdrive-gen10-safe-recovery.py")
spec = importlib.util.spec_from_file_location("xdrive_safe_recovery", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RecoveryTests(unittest.TestCase):
    def test_report_ignores_shared_cas_and_groups_permission(self):
        result = {
            "missing": [{"storage_key": "1/docs/f", "reason": "open: permission denied", "expected_size": 4}],
            "shared_references": [{"storage_key": "cas", "references": 2}],
        }
        counts, permissions, other = mod.issue_summary(result)
        self.assertEqual(sum(counts.values()), 1)
        self.assertEqual(len(permissions), 1)
        self.assertFalse(other)
        with self.assertRaises(RuntimeError):
            mod.issue_summary({"missing": "invalid shape"})

    def test_scope_and_actual_mount_pattern(self):
        self.assertTrue(mod.CANONICAL_BIND.fullmatch("/home/example/.xd/data/files"))
        for invalid in ("/root/.xd/data/files", "/mnt/data",
                        "/home/example/.xd/data/files/../other"):
            self.assertIsNone(mod.CANONICAL_BIND.fullmatch(invalid))
        self.assertEqual(mod.checked_parts("1/docs/a file"), ("1", "docs", "a file"))
        for invalid in ("2/docs/f", "1/../f", "1/x//f", "1/", "../1/f"):
            with self.assertRaises(RuntimeError):
                mod.checked_parts(invalid)

    def test_changes_only_verified_user_file_and_ancestors(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            file = base / "1" / "docs" / "original.bin"
            file.parent.mkdir(parents=True)
            file.write_bytes(b"content")
            os.chmod(file, 0o600)
            untouched = base / "2" / "docs" / "original.bin"
            untouched.parent.mkdir(parents=True)
            untouched.write_bytes(b"untouched")
            outside_info = untouched.stat()
            before = file.stat()
            link = base / "1" / "outside-link"
            os.symlink(untouched, link)
            updates = mod.collect_file_access_changes(
                directory, [{"storage_key": "1/docs/original.bin", "expected_size": 7}], 65532, 65532)
            self.assertEqual(set(updates), {"1", "1/docs", "1/docs/original.bin"})
            if os.geteuid() == 0:
                mod.apply_file_access_changes(directory, updates, 65532, 65532)
                after = file.stat()
                self.assertEqual(before.st_ino, after.st_ino)
                self.assertEqual(file.read_bytes(), b"content")
                self.assertEqual((after.st_uid, after.st_gid), (65532, 65532))
                self.assertEqual(untouched.stat().st_ino, outside_info.st_ino)
                self.assertEqual((untouched.stat().st_uid, untouched.stat().st_gid),
                                 (outside_info.st_uid, outside_info.st_gid))
            self.assertTrue(link.is_symlink())

    def test_rejects_symlinks_hardlinks_and_wrong_size(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            file = base / "1" / "docs" / "blob"
            file.parent.mkdir(parents=True)
            file.write_bytes(b"abc")
            os.symlink(file, base / "1" / "docs" / "link")
            for name in ("1/docs/link", "2/docs/blob"):
                with self.assertRaises((OSError, RuntimeError)):
                    mod.collect_file_access_changes(
                        directory, [{"storage_key": name, "expected_size": 3}], 65532, 65532)
            with self.assertRaises(RuntimeError):
                mod.collect_file_access_changes(
                    directory, [{"storage_key": "1/docs/blob", "expected_size": 4}], 65532, 65532)
            os.link(file, base / "1" / "docs" / "hardlink")
            with self.assertRaises(RuntimeError):
                mod.collect_file_access_changes(
                    directory, [{"storage_key": "1/docs/blob", "expected_size": 3}], 65532, 65532)


if __name__ == "__main__":
    unittest.main()
