#!/usr/bin/env python3
"""Real temporary files: byte preservation, CAS, staged recovery and adversarial input."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

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



class TestCaddyDeployArchiveBounded(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.control = Path(self.tmp.name) / "control"
        self.control.mkdir(mode=0o700)
        self.control.chmod(0o2770)

    def archive(self, n, extra=None):
        data = dict(protocol="xdrive.caddy.host-env.v1", state="deployed",
                    request_id=f"{n:024x}", sha256="b" * 64)
        if extra:
            data.update(extra)
        env = dict(os.environ, XD_CADDY_DEPLOY_RECEIPT_DIR=str(self.control))
        return subprocess.run(
            [sys.executable, str(SCRIPT), "archive-deploy"],
            input=json.dumps(data).encode(), capture_output=True,
            env=env, timeout=8,
        )

    def test_seven_day_ttl_and_max_64_immutable_results(self):
        # Archive retention is bounded even when the Host does many deploys.
        for n in range(1, 69):
            result = self.archive(n)
            self.assertEqual(result.returncode, 0, f"{n}: {result.stdout!r}")
        folder = self.control / "caddy-deploy-results"
        records = list(folder.glob("*.json"))
        self.assertEqual(len(records), 64)
        self.assertEqual(folder.stat().st_mode & 0o7777, 0o2750)
        self.assertFalse((folder / f"{1:024x}.json").exists())
        self.assertTrue((folder / f"{68:024x}.json").exists())
        self.assertTrue(all((f.stat().st_mode & 0o777) == 0o640 for f in records))
        stale = folder / f"{6:024x}.json"
        day8 = time.time() - 8 * 24 * 60 * 60
        os.utime(stale, (day8, day8))
        self.assertEqual(self.archive(69).returncode, 0)
        self.assertFalse(stale.exists())
        self.assertEqual(len(list(folder.glob("*.json"))), 64)
        for receipt in folder.glob("*.json"):
            content = receipt.read_text()
            self.assertNotIn("ALIYUN_ACCESS_KEY", content)
            self.assertNotIn("POSTGRES_PASSWORD", content)

    def test_private_retired_proof_gc_never_deletes_live_or_unsafe_evidence(self):
        # A crashed Host can create a private record before a terminal. Keep
        # it for the 7-day recovery horizon; remove only stale *orphans*.
        spec = importlib.util.spec_from_file_location("caddy_gc_source", SCRIPT)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        previous = {
            "XD_DOMAIN": "old.example.com",
            "XD_LAN_HTTPS_IP": "192.168.1.9",
            "ALIYUN_ACCESS_KEY_ID": "exampleid123",
            "ALIYUN_ACCESS_KEY_SECRET": "do-not-store-this",
        }
        current = dict(previous, XD_DOMAIN="new.example.com")
        sha = helper.fingerprint(current)
        orphan, linked, fresh = ("a" * 24, "b" * 24, "e" * 24)
        with mock.patch.dict(os.environ, XD_CADDY_DEPLOY_RECEIPT_DIR=str(self.control)):
            for request in (orphan, linked, fresh):
                proof = helper.archive_retired_targets(request, sha, previous, current)
                if request == linked:
                    linked_digest = proof
            helper.archive_deploy({
                "protocol": "xdrive.caddy.host-env.v1", "state": "deployed",
                "request_id": linked, "sha256": sha,
                "host_local_generation_sha256": "1" * 64,
                "host_local_live_config_sha256": "2" * 64,
                "retired_targets_sha256": linked_digest,
            })
        private = self.control / "caddy-retired-targets"
        day8 = time.time() - 8 * 24 * 60 * 60
        for request in (orphan, linked):
            os.utime(private / (request + ".json"), (day8, day8))
        self.assertEqual(self.archive(31).returncode, 0)
        self.assertFalse((private / (orphan + ".json")).exists())
        self.assertTrue((private / (linked + ".json")).exists())
        # Fresh private records without a terminal are crash recovery input.
        self.assertTrue((private / (fresh + ".json")).exists())
        with mock.patch.dict(os.environ, XD_CADDY_DEPLOY_RECEIPT_DIR=str(self.control)):
            helper.verify_retired_targets_digest(str(self.control), linked, sha, linked_digest)
        # A malicious or incomplete private object must not be followed.
        outside = self.control / "not-private"
        outside.write_text("do not delete me")
        attack = private / ("c" * 24 + ".json")
        attack.symlink_to(outside)
        self.assertEqual(self.archive(32).returncode, 0)
        self.assertTrue(attack.is_symlink())
        self.assertEqual(outside.read_text(), "do not delete me")
        attack.unlink()
        # An inode with multiple directory links is not safe to prune.
        aliased = private / ("d" * 24 + ".json")
        os.link(private / (linked + ".json"), aliased)
        self.assertEqual(self.archive(33).returncode, 0)
        self.assertTrue(aliased.exists())
        aliased.unlink()
        # The orphan only expires when it actually passes the recovery TTL.
        os.utime(private / (fresh + ".json"), (day8, day8))
        self.assertEqual(self.archive(34).returncode, 0)
        self.assertFalse((private / (fresh + ".json")).exists())
        self.assertTrue((private / (linked + ".json")).exists())

    def test_local_runtime_witness_requires_pair_and_does_not_change_legacy(self):
        # The Host publishes only digest pairs in a completed local-window
        # observation; old deployed receipts without a pair remain readable.
        self.assertEqual(self.archive(21).returncode, 0)
        self.assertEqual(self.archive(22, {
            "host_local_generation_sha256": "c" * 64,
            "host_local_live_config_sha256": "d" * 64,
        }).returncode, 0)
        directory = self.control / "caddy-deploy-results"
        old = json.loads((directory / f"{21:024x}.json").read_text())
        modern = json.loads((directory / f"{22:024x}.json").read_text())
        self.assertNotIn("host_local_generation_sha256", old)
        self.assertEqual(modern["host_local_generation_sha256"], "c" * 64)
        self.assertEqual(modern["host_local_live_config_sha256"], "d" * 64)
        self.assertEqual(set(modern), {
            "protocol", "request_id", "sha256", "state",
            "host_local_generation_sha256", "host_local_live_config_sha256",
        })
        for number, extra in (
            (23, {"host_local_generation_sha256": "c" * 64}),
            (24, {"host_local_generation_sha256": "INVALID",
                  "host_local_live_config_sha256": "d" * 64}),
            (25, {"host_local_generation_sha256": "c" * 64,
                  "host_local_live_config_sha256": "d" * 64,
                  "state": "failed"}),
        ):
            response = self.archive(number, extra)
            self.assertNotEqual(response.returncode, 0)
            self.assertFalse((directory / f"{number:024x}.json").exists())

    def test_duplicate_and_secret_injection_refused_without_overwrite(self):
        self.assertEqual(self.archive(1).returncode, 0)
        receipt = self.control / "caddy-deploy-results" / f"{1:024x}.json"
        original = receipt.read_bytes()
        self.assertNotEqual(self.archive(1).returncode, 0)
        self.assertEqual(receipt.read_bytes(), original)
        injected = self.archive(2, {"access_key_secret": "DONT-STORE"})
        self.assertNotEqual(injected.returncode, 0)
        self.assertFalse((receipt.parent / f"{2:024x}.json").exists())
        self.assertNotIn(b"DONT-STORE", injected.stdout + injected.stderr)

    def test_immutable_private_retired_targets_bound_to_real_host_success(self):
        spec = importlib.util.spec_from_file_location("caddy_host_retired_source", SCRIPT)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        previous = {
            "XD_DOMAIN": "former.example.com",
            "XD_LAN_HTTPS_IP": "192.168.1.9",
            "ALIYUN_ACCESS_KEY_ID": "LTAIExampleSecretIdentifier",
            "ALIYUN_ACCESS_KEY_SECRET": "never-store-this-alidns-secret",
        }
        current = dict(previous)
        current["XD_DOMAIN"] = "current.example.com"
        op = "abcdefabcdefabcdefabcdef"
        sha = helper.fingerprint(current)
        with mock.patch.dict(os.environ, XD_CADDY_DEPLOY_RECEIPT_DIR=str(self.control)):
            proof = helper.archive_retired_targets(op, sha, previous, current)
            self.assertRegex(proof, "^[0-9a-f]{64}$")
            helper.verify_retired_targets_digest(str(self.control), op, sha, proof)
            # Crash recovery for the same exact original writer is idempotent.
            self.assertEqual(helper.archive_retired_targets(op, sha, previous, current), proof)
            path = self.control / "caddy-retired-targets" / (op + ".json")
            raw = path.read_bytes()
            record = json.loads(raw)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o077, 0)
            self.assertEqual(record["retired_domain"], "former.example.com")
            self.assertEqual(record["retired_lan_ip"], "")
            self.assertEqual(record["target_sha256"], sha)
            self.assertEqual(record["request_id"], op)
            for forbidden in ("never-store-this-alidns-secret", "LTAIExampleSecretIdentifier",
                              "ALIYUN_ACCESS_KEY", "POSTGRES_PASSWORD"):
                self.assertNotIn(forbidden.encode(), raw)
            # A receipt's claimed digest is not sufficient without the
            # separate immutable, private, original Host record.
            helper.archive_deploy({
                "protocol": "xdrive.caddy.host-env.v1", "state": "deployed",
                "request_id": op, "sha256": sha,
                "host_local_generation_sha256": "a" * 64,
                "host_local_live_config_sha256": "b" * 64,
                "retired_targets_sha256": proof,
            })
            archived = json.loads((self.control / "caddy-deploy-results" / (op + ".json")).read_text())
            self.assertEqual(archived["retired_targets_sha256"], proof)
            for bad in (dict(previous, XD_DOMAIN="attacker.example.com"),
                        dict(previous, XD_LAN_HTTPS_IP="127.0.0.1")):
                with self.assertRaises(helper.Restricted):
                    helper.archive_retired_targets(op, sha, bad, current)
            with self.assertRaises(helper.Restricted):
                helper.verify_retired_targets_digest(str(self.control), op, sha, "0" * 64)
            # Even a seemingly valid SHA attached to a failed terminal or
            # a legacy result without generation proof must be refused.
            for bad_extra in (
                {"state": "failed", "retired_targets_sha256": proof},
                {"state": "deployed", "retired_targets_sha256": proof},
            ):
                bad_op = "1234567890abcdef12345678"
                with self.assertRaises(helper.Restricted):
                    helper.archive_deploy({
                        "protocol": "xdrive.caddy.host-env.v1", "state": "failed",
                        "request_id": bad_op, "sha256": sha, **bad_extra,
                    })

    def test_private_retired_target_symlink_and_corruption_fail_closed(self):
        spec = importlib.util.spec_from_file_location("caddy_host_retired_fault", SCRIPT)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        before = {
            "XD_DOMAIN": "retired.example.com", "XD_LAN_HTTPS_IP": "192.168.1.9",
            "ALIYUN_ACCESS_KEY_ID": "someidsecret", "ALIYUN_ACCESS_KEY_SECRET": "privateexample",
        }
        after = dict(before, XD_DOMAIN="new.example.com")
        op = "1234567890abcdef12345678"
        with mock.patch.dict(os.environ, XD_CADDY_DEPLOY_RECEIPT_DIR=str(self.control)):
            folder = self.control / "caddy-retired-targets"
            folder.mkdir(mode=0o700)
            path = folder / (op + ".json")
            path.symlink_to(self.control / "other.txt")
            with self.assertRaises((helper.Restricted, OSError)):
                helper.archive_retired_targets(op, helper.fingerprint(after), before, after)
            path.unlink()
            expected = helper.archive_retired_targets(op, helper.fingerprint(after), before, after)
            path.write_bytes(b'{"corrupted":true}')
            with self.assertRaises(helper.Restricted):
                helper.verify_retired_targets_digest(str(self.control), op, helper.fingerprint(after), expected)


if __name__ == "__main__":
    unittest.main()
