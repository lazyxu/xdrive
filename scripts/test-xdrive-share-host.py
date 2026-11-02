#!/usr/bin/env python3
"""Exercise the installed Host CLI's Share dispatch without a network or Docker."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HOST = Path(__file__).resolve().with_name("xdrive-server-host.sh")


class ShareHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="xdrive-share-host-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        (self.home / "bin").mkdir(parents=True)
        (self.home / "config").mkdir()
        (self.home / "config/.env").write_text(
            "XD_UPDATE_SOURCE=xdrive\nXD_RELEASE_CHANNEL=master\n", encoding="utf-8")
        self.receipt = self.root / "helper-args.json"
        self.helper = self.home / "bin/xdrive-share-update.py"
        self.helper.write_text(
            "import json,os,sys\nfrom pathlib import Path\n"
            "Path(os.environ['TEST_RECEIPT']).write_text(json.dumps(sys.argv[1:]))\n"
            "sys.exit(int(os.environ.get('TEST_HELPER_STATUS','0')))\n", encoding="utf-8")
        self.env = dict(os.environ, XD_CONFIG_DIR=str(self.home), TEST_RECEIPT=str(self.receipt),
                        XD_INSTALLER_URL="https://must-not-fetch.invalid/install.sh")

    def run_host(self, *args, **env):
        return subprocess.run(["bash", str(HOST), "update", *args],
                              env=dict(self.env, **env), stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=20)

    def test_dispatches_installed_helper_and_forwards_backup(self):
        result = self.run_host("--source", "xdrive", "--channel", "master", "--backup-file-data")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.receipt.read_text()), [
            "--config", str(self.home / "config/xdrive-share-update.json"),
            "--home", str(self.home), "--channel", "master", "--backup-file-data"])

    def test_persisted_source_and_prefetch_use_same_helper(self):
        result = self.run_host("--prefetch-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--prefetch-only", json.loads(self.receipt.read_text()))

    def test_stable_and_unknown_flags_fail_before_helper(self):
        for args in (("--source", "xdrive", "--channel", "stable"),
                     ("--source", "xdrive", "--shell", "arbitrary")):
            with self.subTest(args=args):
                self.assertEqual(self.run_host(*args).returncode, 2)
                self.assertFalse(self.receipt.exists())

    def test_failure_is_returned_without_provider_fallback(self):
        result = self.run_host(TEST_HELPER_STATUS="42")
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertTrue(self.receipt.exists())

    def test_missing_or_symlink_helper_is_refused(self):
        self.helper.unlink()
        self.assertNotEqual(self.run_host().returncode, 0)
        other = self.root / "untrusted.py"
        other.write_text("raise SystemExit(0)\n", encoding="utf-8")
        self.helper.symlink_to(other)
        self.assertNotEqual(self.run_host().returncode, 0)
        self.assertFalse(self.receipt.exists())


if __name__ == "__main__":
    unittest.main()
