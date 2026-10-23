#!/usr/bin/env python3
"""Real temporary files: byte preservation, CAS, staged recovery and adversarial input."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("caddy-env-config.py")
ORIGINAL = (
    "# Test deployment\nPOSTGRES_PASSWORD=do-not-touch\n"
    "XD_JWT_SECRET=do-not-touch-either\n"
    "XD_DOMAIN=initial.example.com\n"
    "XD_LAN_HTTPS_IP=192.168.1.9\n"
    "ALIYUN_ACCESS_KEY_ID=someinitialid\n"
    "ALIYUN_ACCESS_KEY_SECRET=someinitialsecret\n"
    "XD_CONNECTOR_SECRET_KEYS=1:abcdef\n"
)


class TestCaddyHostEnv(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / "xd"
        for path in (self.home, self.home / "config", self.home / "state"):
            path.mkdir(mode=0o700)
        self.env = self.home / "config" / ".env"
        self.env.write_text(ORIGINAL)
        self.env.chmod(0o600)

    def run_command(self, command, body=None):
        environment = dict(os.environ, XD_CONFIG_DIR=str(self.home))
        result = subprocess.run(
            [sys.executable, str(SCRIPT), command],
            input=(json.dumps(body) if body is not None else "").encode(),
            capture_output=True, env=environment, check=False, timeout=8,
        )
        self.assertNotIn(b"someinitialsecret", result.stdout + result.stderr)
        self.assertNotIn(b"do-not-touch", result.stdout + result.stderr)
        return result.returncode, json.loads(result.stdout)

    def request(self, state, **kw):
        return dict(operation="save", request_id="0123456789abcdef01234567",
                    expected_sha256=state["sha256"], **kw)

    def test_save_and_restore_only_four_keys(self):
        _, original = self.run_command("snapshot")
        req = self.request(original, https={
            "enabled": True, "domain": "next.example.com",
            "lan_enabled": True, "lan_ip": "192.168.1.10",
        }, alidns={"action": "replace", "access_key_secret": "updatedsecurekey"})
        code, saved = self.run_command("save", req)
        self.assertEqual(code, 0)
        self.assertEqual(saved["state"], "saved")
        self.assertEqual(saved["domain"], "next.example.com")
        self.assertNotIn("updatedsecurekey", json.dumps(saved))
        file_value = self.env.read_text()
        self.assertIn("POSTGRES_PASSWORD=do-not-touch\n", file_value)
        self.assertIn("XD_JWT_SECRET=do-not-touch-either\n", file_value)
        self.assertIn("XD_CONNECTOR_SECRET_KEYS=1:abcdef\n", file_value)
        self.assertIn("ALIYUN_ACCESS_KEY_SECRET=updatedsecurekey\n", file_value)
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)
        code, restored = self.run_command("restore", {
            "operation": "restore", "request_id": req["request_id"],
            "expected_sha256": saved["sha256"],
        })
        self.assertEqual(code, 0)
        self.assertEqual(restored["state"], "restored")
        self.assertEqual(self.env.read_text(), ORIGINAL)

    def test_multiple_saves_keep_original_rollback_anchor(self):
        _, first = self.run_command("snapshot")
        code, middle = self.run_command("save", self.request(first, https={
            "enabled": True, "domain": "middle.example.com",
            "lan_enabled": True, "lan_ip": "192.168.1.9",
        }))
        self.assertEqual(code, 0)
        code, last = self.run_command("save", self.request(middle, https={
            "enabled": True, "domain": "final.example.com",
            "lan_enabled": True, "lan_ip": "192.168.1.9",
        }))
        self.assertEqual(code, 0)
        code, _ = self.run_command("restore", {
            "operation": "restore", "request_id": "0123456789abcdef01234567",
            "expected_sha256": last["sha256"],
        })
        self.assertEqual(code, 0)
        self.assertEqual(self.env.read_text(), ORIGINAL)

    def test_commit_keeps_new_configuration(self):
        _, snap = self.run_command("snapshot")
        code, saved = self.run_command("save", self.request(snap, https={
            "enabled": False, "domain": "", "lan_enabled": True, "lan_ip": "10.0.0.2",
        }))
        self.assertEqual(code, 0)
        code, result = self.run_command("commit", {
            "operation": "commit", "request_id": "0123456789abcdef01234567",
            "expected_sha256": saved["sha256"],
        })
        self.assertEqual(code, 0)
        self.assertEqual(result["state"], "committed")
        self.assertFalse(result["pending_redeploy"])
        self.assertFalse((self.home / "state" / "caddy-env" / "previous.env").exists())

    def test_reject_stale_cas_and_injection(self):
        _, original = self.run_command("snapshot")
        request = self.request(original, https={
            "enabled": True, "domain": "good.example.com",
            "lan_enabled": True, "lan_ip": "10.0.0.3",
        })
        request["expected_sha256"] = "0" * 64
        code, _ = self.run_command("save", request)
        self.assertNotEqual(code, 0)
        request["expected_sha256"] = original["sha256"]
        request["https"]["domain"] = "$(touch /tmp/should-not-run).example.com"
        code, _ = self.run_command("save", request)
        self.assertNotEqual(code, 0)
        self.assertEqual(self.env.read_text(), ORIGINAL)

    def test_interrupted_host_save_requires_recovery(self):
        _, original = self.run_command("snapshot")
        request = self.request(original, https={
            "enabled": True, "domain": "new.example.com",
            "lan_enabled": True, "lan_ip": "192.168.1.20",
        })
        code, saved = self.run_command("save", request)
        self.assertEqual(code, 0)
        journal = self.home / "state" / "caddy-env"
        marker = journal / "pending.json"
        old_marker = {"target_sha256": original["sha256"]}
        marker.write_text(json.dumps(old_marker))
        marker.chmod(0o600)
        code, _ = self.run_command("snapshot")
        self.assertNotEqual(code, 0)
        code, _ = self.run_command("commit", {
            "operation": "commit", "request_id": request["request_id"],
            "expected_sha256": saved["sha256"],
        })
        self.assertNotEqual(code, 0)
        code, restored = self.run_command("restore", {
            "operation": "restore", "request_id": request["request_id"],
            "expected_sha256": saved["sha256"],
        })
        self.assertEqual(code, 0)
        self.assertEqual(restored["state"], "restored")
        self.assertEqual(self.env.read_text(), ORIGINAL)
        _, snap = self.run_command("snapshot")
        self.assertFalse(snap["pending_redeploy"])

    def test_reject_invalid_domain_tld_and_preserve_running_env(self):
        _, snapshot = self.run_command("snapshot")
        for name in ("a.b", "photos.example.123", "photos.example.1z", "photos.example.c"):
            code, _ = self.run_command("save", self.request(snapshot, https={
                "enabled": True, "domain": name,
                "lan_enabled": True, "lan_ip": "192.168.1.9",
            }))
            self.assertNotEqual(code, 0)
            self.assertEqual(self.env.read_text(), ORIGINAL)

    def test_explicit_cas_fenced_reveal(self):
        _, snapshot = self.run_command("snapshot")
        request = {
            "operation": "reveal", "request_id": "0123456789abcdef01234567",
            "expected_sha256": snapshot["sha256"],
        }
        env = dict(os.environ, XD_CONFIG_DIR=str(self.home))
        result = subprocess.run([sys.executable, str(SCRIPT), "reveal"],
                                input=json.dumps(request).encode(), capture_output=True,
                                env=env, timeout=8)
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertEqual(data["state"], "revealed")
        self.assertEqual(data["access_key_id"], "someinitialid")
        self.assertEqual(data["access_key_secret"], "someinitialsecret")
        self.assertEqual(data["expires_in_seconds"], 30)
        self.assertNotIn("POSTGRES_PASSWORD", result.stdout.decode())
        self.assertNotIn("XD_JWT_SECRET", result.stdout.decode())
        request["expected_sha256"] = "0" * 64
        denied = subprocess.run([sys.executable, str(SCRIPT), "reveal"],
                                input=json.dumps(request).encode(), capture_output=True,
                                env=env, timeout=8)
        self.assertNotEqual(denied.returncode, 0)
        self.assertNotIn(b"someinitialsecret", denied.stdout + denied.stderr)

    def test_reject_world_readable_symlink_and_duplicate(self):
        self.env.chmod(0o644)
        code, _ = self.run_command("snapshot")
        self.assertNotEqual(code, 0)
        self.env.chmod(0o600)
        self.env.write_text(ORIGINAL + "XD_DOMAIN=duplicate.example.com\n")
        code, _ = self.run_command("snapshot")
        self.assertNotEqual(code, 0)
        self.env.unlink()
        (self.home / "config" / "real-env").write_text(ORIGINAL)
        self.env.symlink_to("real-env")
        code, _ = self.run_command("snapshot")
        self.assertNotEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
