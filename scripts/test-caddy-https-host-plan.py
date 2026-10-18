#!/usr/bin/env python3
"""Offline negative-by-default NET-M5-B2 host plan fixture. No Docker/network."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import stat
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("caddy-https-host-plan.py")
BASE = {
    "protocol": "xdrive.caddy.https.host-plan.v1",
    "desired_revision": 7,
    "credential_revision": 0,
    "domain_enabled": False,
    "domain": "",
    "lan_enabled": True,
    "lan_ip": "192.168.2.4",
}
ENV = "XD_DOMAIN=\nXD_LAN_HTTPS_IP=192.168.2.4\nXD_WEB_BIND=127.0.0.1\nXD_HTTPS_BIND=0.0.0.0\nXD_HTTPS_PORT=8443\nXD_LEGACY_HTTP_ONLY=0\nALIYUN_ACCESS_KEY_SECRET=never-print-this\n"
COMPOSE = "services:\n  caddy:\n    container_name: xdrive-caddy\n    command: [/usr/local/bin/xdrive-caddy-start]\n    environment:\n      XD_DOMAIN: ${XD_DOMAIN:-}\n      XD_LAN_HTTPS_IP: ${XD_LAN_HTTPS_IP:-}\n    ports:\n      - ${XD_HTTPS_BIND:-0.0.0.0}:${XD_HTTPS_PORT:-8443}:443/tcp\n"


def canonical(data):
    return (json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


class OfflineHostPlanTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = Path(self.dir.name)
        self.plan = self.root / "plan.json"
        self.env = self.root / ".env"
        self.compose = self.root / "docker-compose.yml"
        self.prepare()

    def prepare(self, data=BASE, env=ENV, compose=COMPOSE, raw=None):
        self.plan.write_bytes(raw if raw is not None else canonical(data))
        self.env.write_text(env)
        self.compose.write_text(compose)
        for path in (self.plan, self.env, self.compose):
            path.chmod(0o600)

    def run_plan(self, pin=None):
        before = (self.plan.read_bytes() if self.plan.is_file() else b"",
                  self.env.read_bytes(), self.compose.read_bytes())
        args = [sys.executable, str(SCRIPT), "--plan", str(self.plan),
                "--env-file", str(self.env), "--compose-file", str(self.compose),
                "--expected-plan-sha256", pin or hashlib.sha256(before[0]).hexdigest()]
        result = subprocess.run(args, text=True, capture_output=True, timeout=4)
        output = json.loads(result.stdout)
        self.assertNotIn("never-print-this", result.stdout + result.stderr)
        self.assertNotIn("192.168.2.4", result.stdout + result.stderr)
        self.assertNotIn("/tmp/", result.stdout + result.stderr)
        after = (self.plan.read_bytes() if self.plan.is_file() else b"",
                 self.env.read_bytes(), self.compose.read_bytes())
        self.assertEqual(before, after)
        return result.returncode, output

    def test_ip_only_no_change_no_false_applied(self):
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertEqual(out["state"], "no-change")
        self.assertEqual(out["current_mode"], "ip-only")
        self.assertFalse(out["apply_supported"])
        self.assertIn("timed-rollback-not-armed", out["blockers"])

    def test_dual_enable_domain_requires_real_secret_and_rescue(self):
        data = {**BASE, "domain_enabled": True, "domain": "drive.example.com", "credential_revision": 9}
        self.prepare(data=data)
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertEqual(out["desired_mode"], "both")
        self.assertEqual(out["changes"], ["enable-domain"])
        self.assertIn("alidns-secret-host-handoff-required", out["blockers"])
        self.assertNotIn("drive.example.com", json.dumps(out))

    def test_switch_and_disable_current_entry_cannot_be_safe(self):
        data = {**BASE, "lan_ip": "192.168.2.5"}
        self.prepare(data=data)
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertIn("switch-lan", out["changes"])
        self.assertIn("existing-ingress-at-risk", out["blockers"])
        self.prepare(data={**BASE, "domain_enabled": True, "domain": "drive.example.com", "credential_revision": 3,
                           "lan_enabled": False, "lan_ip": ""})
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertIn("disable-lan", out["changes"])
        self.assertFalse(out["apply_supported"])

    def test_invalid_intents_and_credentials_rejected(self):
        for data in (
            {**BASE, "lan_enabled": False},
            {**BASE, "lan_ip": "8.8.8.8"},
            {**BASE, "lan_ip": "192.168.02.4"},
            {**BASE, "lan_ip": "127.0.0.1"},
            {**BASE, "lan_ip": "10.0.0.256"},
            {**BASE, "domain_enabled": True, "domain": "drive.example.com"},
            {**BASE, "domain_enabled": True, "domain": "https://drive.example.com", "credential_revision": 1},
            {**BASE, "domain_enabled": True, "domain": "*.example.com", "credential_revision": 1},
            {**BASE, "desired_revision": True},
            {**BASE, "protocol": "v2"},
            {**BASE, "unexpected": "anything"},
        ):
            with self.subTest(data=data):
                self.prepare(data=data)
                rc, out = self.run_plan()
                self.assertEqual(rc, 2)
                self.assertEqual(out["state"], "blocked")

    def test_invalid_plan_text_and_pin_blocked(self):
        for raw in (b'{}\n', b'{"domain":"x","domain":"y"}\n',
                    canonical(BASE) + b' ', b'{"not":"json"}\n' + b'A'*4200):
            with self.subTest(raw=raw[:30]):
                self.prepare(raw=raw)
                self.assertEqual(self.run_plan()[0], 2)
        self.prepare()
        self.assertEqual(self.run_plan(pin="f"*64)[0], 2)
        self.assertEqual(self.run_plan(pin="f"*63)[0], 2)

    def test_host_env_is_secret_and_parser_rejects_duplicates(self):
        for env in (
            ENV + "XD_LAN_HTTPS_IP=192.168.2.4\n",
            ENV.replace("XD_HTTPS_BIND=0.0.0.0", "XD_HTTPS_BIND=127.0.0.1"),
            ENV.replace("XD_WEB_BIND=127.0.0.1", "XD_WEB_BIND=0.0.0.0"),
            ENV.replace("XD_HTTPS_PORT=8443", "XD_HTTPS_PORT=99999"),
            ENV.replace("XD_LAN_HTTPS_IP=192.168.2.4", "XD_LAN_HTTPS_IP=8.8.8.8"),
        ):
            with self.subTest(env=env[-90:]):
                self.prepare(env=env)
                self.assertEqual(self.run_plan()[0], 2)
        self.prepare(env=ENV.replace("XD_HTTPS_BIND=0.0.0.0", "XD_HTTPS_BIND=192.168.2.4"),
                     data={**BASE, "lan_ip": "192.168.2.5"})
        rc, result = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertIn("https-bind-migration-required", result["blockers"])
        self.assertIsNone(result["candidate_environment_sha256"])

    def test_candidate_digest_only_and_unchanged_unrelated_secrets(self):
        data = {**BASE, "lan_ip": "192.168.2.5"}
        source = "# operator note\n" + ENV + "\n"
        self.prepare(data=data, env=source)
        rc, result = self.run_plan()
        self.assertEqual(rc, 0)
        expected = source.replace("XD_LAN_HTTPS_IP=192.168.2.4",
                                  "XD_LAN_HTTPS_IP=192.168.2.5")
        self.assertEqual(result["candidate_environment_sha256"],
                         hashlib.sha256(expected.encode()).hexdigest())
        self.assertEqual(result["host_environment_sha256"],
                         hashlib.sha256(source.encode()).hexdigest())
        self.assertNotEqual(result["candidate_environment_sha256"],
                            result["host_environment_sha256"])
        self.assertIn("existing-ingress-at-risk", result["blockers"])
        self.assertFalse(result["apply_supported"])
        self.assertEqual(self.env.read_text(), source)

    def test_candidate_digest_no_change_and_missing_key_append(self):
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertEqual(out["candidate_environment_sha256"],
                         out["host_environment_sha256"])
        source = ENV.replace("XD_LEGACY_HTTP_ONLY=0\n", "")
        self.prepare(env=source)
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertEqual(out["candidate_environment_sha256"],
                         hashlib.sha256((source + "XD_LEGACY_HTTP_ONLY=0\n").encode()).hexdigest())
        self.assertEqual(self.env.read_text(), source)

    def test_candidate_digest_domain_only_and_dual_are_nonsecret(self):
        data = {**BASE, "domain_enabled": True, "domain": "drive.example.com",
                "credential_revision": 5}
        self.prepare(data=data)
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertEqual(out["candidate_environment_sha256"],
                         hashlib.sha256(ENV.replace("XD_DOMAIN=", "XD_DOMAIN=drive.example.com").encode()).hexdigest())
        self.assertIn("alidns-secret-host-handoff-required", out["blockers"])
        self.assertEqual(self.env.read_text(), ENV)
        self.assertNotIn("never-print-this", json.dumps(out))
        data = {**data, "lan_enabled": False, "lan_ip": ""}
        self.prepare(data=data)
        rc, out = self.run_plan()
        self.assertEqual(rc, 0)
        self.assertEqual(out["candidate_environment_sha256"],
                         hashlib.sha256(ENV.replace("XD_DOMAIN=", "XD_DOMAIN=drive.example.com")
                                        .replace("XD_LAN_HTTPS_IP=192.168.2.4",
                                                 "XD_LAN_HTTPS_IP=").encode()).hexdigest())

    def test_candidate_rejects_ambiguous_env_before_any_install(self):
        for env in (
            ENV + "XD_DOMAIN=\n",
            ENV + "ALIYUN_ACCESS_KEY_SECRET=duplicate\n",
            ENV.replace("XD_DOMAIN=\n", "export XD_DOMAIN=\n"),
            ENV.replace("XD_DOMAIN=\n", " XD_DOMAIN=\n"),
            ENV.replace("XD_DOMAIN=\n", "XD_DOMAIN=\r\n"),
            ENV + "INVALID UNKNOWN LINE\n",
            ENV.rstrip("\n"),
        ):
            with self.subTest(env=env[-45:]):
                self.prepare(env=env)
                rc, out = self.run_plan()
                self.assertEqual(rc, 2)
                self.assertEqual(out["state"], "blocked")
                self.assertFalse(out["apply_supported"])

    def test_no_special_files_world_writable_or_compose_swaps(self):
        self.plan.chmod(0o644)
        self.assertEqual(self.run_plan()[0], 2)
        self.prepare()
        self.compose.chmod(0o666)
        self.assertEqual(self.run_plan()[0], 2)
        self.prepare()
        target = self.root / "target"
        self.plan.rename(target)
        self.plan.symlink_to(target)
        self.assertEqual(self.run_plan()[0], 2)
        self.plan.unlink()
        os.mkfifo(self.plan)
        # A writerless FIFO must fail immediately without waiting for a writer.
        rc, result = self.run_plan()
        self.assertEqual(rc, 2)
        self.assertEqual(result["state"], "blocked")

    def test_no_mutation_capability_anywhere_in_tool(self):
        source = SCRIPT.read_text()
        self.assertNotIn("import subprocess", source)
        self.assertNotIn("docker compose", source)
        self.assertNotIn("--insecure", source)
        self.assertNotIn("os.replace", source)
        self.assertNotIn("requests.", source)
        self.assertNotIn("socket.", source)



class OfflineHostStageTest(unittest.TestCase):
    """This is operator-private staging, never mutation of installed Caddy."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.plan = self.root / "plan.json"
        self.conf = self.root / "config"
        self.conf.mkdir()
        self.env = self.conf / ".env"
        self.compose = self.conf / "docker-compose.yml"
        self.state = self.root / "state"
        self.state.mkdir()
        self.stage_dir = self.state / "caddy-https-staging"
        self.stage_dir.mkdir(mode=0o700)
        self.prepare()

    def prepare(self, data=BASE, env=ENV):
        self.plan.write_bytes(canonical(data))
        self.env.write_text(env)
        self.compose.write_text(COMPOSE)
        for path in (self.plan, self.env, self.compose):
            path.chmod(0o600)

    def stage(self, pin=None, path=None):
        script = Path(__file__).with_name("caddy-https-host-stage.py")
        raw = self.plan.read_bytes()
        argv = [sys.executable, str(script),
                "--plan", str(self.plan), "--env-file", str(self.env),
                "--compose-file", str(self.compose),
                "--expected-plan-sha256", pin or hashlib.sha256(raw).hexdigest(),
                "--staging-dir", str(path or self.stage_dir)]
        out = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        self.assertNotIn("never-print-this", out.stdout + out.stderr)
        self.assertNotIn("192.168.2.4", out.stdout + out.stderr)
        self.assertNotIn(str(self.root), out.stdout + out.stderr)
        return out.returncode, json.loads(out.stdout)

    def test_private_atomic_stage_does_not_modify_live_env(self):
        before = (self.env.read_bytes(), self.compose.read_bytes())
        rc, out = self.stage()
        self.assertEqual(rc, 0)
        self.assertEqual(out["state"], "candidate-staged-unapplied")
        self.assertFalse(out["apply_supported"])
        self.assertIn("live-host-cas-and-rollback-not-authorized", out["blockers"])
        self.assertEqual(before, (self.env.read_bytes(), self.compose.read_bytes()))
        staged = list(self.stage_dir.glob("candidate-*.env"))
        receipts = list(self.stage_dir.glob("receipt-*.json"))
        self.assertEqual(len(staged), 1)
        self.assertEqual(len(receipts), 1)
        self.assertEqual(staged[0].read_bytes(), before[0])
        self.assertEqual(stat.S_IMODE(staged[0].stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(receipts[0].stat().st_mode), 0o600)
        self.assertEqual(out["candidate_environment_sha256"],
                         hashlib.sha256(staged[0].read_bytes()).hexdigest())
        receipt = json.loads(receipts[0].read_text())
        self.assertEqual(receipt["desired_revision"], 7)
        self.assertFalse(receipt["apply_supported"])
        self.assertNotIn("never-print-this", receipts[0].read_text())
        self.assertEqual(out["stage_receipt_sha256"],
                         hashlib.sha256(receipts[0].read_bytes()).hexdigest())
        # Never replace or overwrite an earlier private candidate silently.
        rc, blocked = self.stage()
        self.assertEqual(rc, 2)
        self.assertEqual(blocked["state"], "blocked")
        self.assertEqual(len(list(self.stage_dir.glob("candidate-*.env"))), 1)

    def test_refuse_domain_secret_handoff_and_existing_ingress_removal(self):
        scenarios = [
            {**BASE, "domain_enabled": True, "domain": "drive.example.com",
             "credential_revision": 5},
            {**BASE, "lan_ip": "192.168.2.5"},
            {**BASE, "lan_enabled": False, "lan_ip": "",
             "domain_enabled": True, "domain": "drive.example.com",
             "credential_revision": 5},
        ]
        for data in scenarios:
            with self.subTest(plan=data):
                self.prepare(data)
                rc, out = self.stage()
                self.assertEqual(rc, 2)
                self.assertFalse(out["apply_supported"])
                self.assertEqual(list(self.stage_dir.iterdir()), [])

    def test_untrusted_staging_directory_and_pin_fail_closed(self):
        self.stage_dir.chmod(0o755)
        rc, out = self.stage()
        self.assertEqual(rc, 2)
        self.assertEqual(out["state"], "blocked")
        self.stage_dir.chmod(0o700)
        rc, out = self.stage(pin="f" * 64)
        self.assertEqual(rc, 2)
        self.assertEqual(out["state"], "blocked")
        other = self.state / "real-caddy-https-staging"
        self.stage_dir.rename(other)
        self.stage_dir.symlink_to(other, target_is_directory=True)
        rc, out = self.stage()
        self.assertEqual(rc, 2)
        self.assertEqual(out["state"], "blocked")
        self.assertEqual(list(other.iterdir()), [])

    def test_no_caddy_docker_network_or_live_apply_surface(self):
        source = Path(__file__).with_name("caddy-https-host-stage.py").read_text()
        self.assertNotIn("subprocess", source)
        self.assertNotIn("docker compose", source)
        self.assertNotIn("--insecure", source)
        self.assertNotIn("os.replace", source)
        self.assertNotIn("urllib", source)
        self.assertNotIn("socket.", source)
        self.assertNotIn("apply_supported\": True", source)


    def verify_staged(self, expected_receipt=None, plan_pin=None):
        receipts = list(self.stage_dir.glob("receipt-*.json"))
        receipt_data = receipts[0].read_bytes() if receipts else b""
        pin = expected_receipt or hashlib.sha256(receipt_data).hexdigest()
        argv = [sys.executable, str(Path(__file__).with_name("caddy-https-host-verify-stage.py")),
                "--plan", str(self.plan), "--env-file", str(self.env),
                "--compose-file", str(self.compose),
                "--expected-plan-sha256", plan_pin or
                hashlib.sha256(self.plan.read_bytes()).hexdigest(),
                "--staging-dir", str(self.stage_dir),
                "--expected-stage-receipt-sha256", pin]
        out = subprocess.run(argv, capture_output=True, text=True, timeout=5)
        self.assertNotIn("never-print-this", out.stdout + out.stderr)
        self.assertNotIn("192.168.2.4", out.stdout + out.stderr)
        self.assertNotIn(str(self.root), out.stdout + out.stderr)
        return out.returncode, json.loads(out.stdout)

    def test_staged_receipt_verifies_but_never_authorizes_apply(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        before = (self.env.read_bytes(), self.compose.read_bytes())
        rc, result = self.verify_staged(created["stage_receipt_sha256"])
        self.assertEqual(rc, 0)
        self.assertEqual(result["state"], "candidate-verified-unapplied")
        self.assertFalse(result["apply_supported"])
        self.assertIn("live-host-cas-and-rollback-not-authorized", result["blockers"])
        self.assertEqual(before, (self.env.read_bytes(), self.compose.read_bytes()))
        self.assertEqual(result["stage_receipt_sha256"], created["stage_receipt_sha256"])

    def test_staged_verification_rejects_changed_live_env_and_plan(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.env.write_text(ENV + "XD_EXTRA_SAFE_VARIABLE=test\n")
        self.env.chmod(0o600)
        rc, result = self.verify_staged(created["stage_receipt_sha256"])
        self.assertEqual(rc, 2)
        self.assertEqual(result["state"], "blocked")
        self.env.write_text(ENV)
        self.plan.write_bytes(canonical({**BASE, "desired_revision": 8}))
        rc, result = self.verify_staged(created["stage_receipt_sha256"])
        self.assertEqual(rc, 2)
        self.assertFalse(result["apply_supported"])

    def test_staged_verification_rejects_tampering_symlink_and_permissions(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        candidate = next(self.stage_dir.glob("candidate-*.env"))
        receipt = next(self.stage_dir.glob("receipt-*.json"))
        data = candidate.read_bytes()
        candidate.write_bytes(data + b"#modified\n")
        rc, out = self.verify_staged(created["stage_receipt_sha256"])
        self.assertEqual((rc, out["state"]), (2, "blocked"))
        candidate.write_bytes(data)
        self.assertEqual(self.verify_staged(created["stage_receipt_sha256"])[0], 0)
        receipt_data = receipt.read_bytes()
        receipt.write_bytes(receipt_data.replace(
            b"candidate-staged-unapplied", b"candidate-staged-applied!!"))
        self.assertEqual(self.verify_staged(created["stage_receipt_sha256"])[0], 2)
        receipt.write_bytes(receipt_data)
        self.assertEqual(self.verify_staged("f" * 64)[0], 2)
        receipt.chmod(0o644)
        self.assertEqual(self.verify_staged(created["stage_receipt_sha256"])[0], 2)
        receipt.chmod(0o600)
        candidate.rename(self.state / "candidate-target.env")
        candidate.symlink_to(self.state / "candidate-target.env")
        self.assertEqual(self.verify_staged(created["stage_receipt_sha256"])[0], 2)

    def test_stage_verify_is_fixed_readonly_source(self):
        source = Path(__file__).with_name("caddy-https-host-verify-stage.py").read_text()
        self.assertNotIn("import subprocess", source)
        self.assertNotIn("docker compose", source)
        self.assertNotIn("--insecure", source)
        self.assertNotIn("os.replace(", source)
        self.assertNotIn("os.rename(", source)
        self.assertNotIn("os.unlink(", source)
        self.assertNotIn("exec(", source)
        self.assertNotIn("socket.", source)


    def make_signed_review(self, created, changes=None):
        import datetime as dt
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        def utc(x):
            return x.strftime("%Y-%m-%dT%H:%M:%SZ")
        self.review_private = self.root / "test-approval-key.pem"
        self.review_public = self.root / "test-approval-public.pem"
        self.review_manifest = self.root / "test-approval.json"
        self.review_signature = self.root / "test-approval.sig"
        for argv in (
            ["openssl", "genpkey", "-algorithm", "Ed25519",
             "-out", str(self.review_private)],
            ["openssl", "pkey", "-in", str(self.review_private),
             "-pubout", "-out", str(self.review_public)],
        ):
            subprocess.run(argv, check=True, capture_output=True, timeout=6)
        der = subprocess.run(
            ["openssl", "pkey", "-pubin", "-in", str(self.review_public),
             "-outform", "DER"], check=True, capture_output=True,
            timeout=6).stdout
        self.review_public_pin = hashlib.sha256(der).hexdigest()
        manifest = {
            "schema": 1,
            "scope": "xdrive.caddy.https.operator-stage-review.v1",
            "action": "candidate-review-only",
            "desired_revision": 7,
            "credential_revision": 0,
            "plan_sha256": hashlib.sha256(self.plan.read_bytes()).hexdigest(),
            "stage_receipt_sha256": created["stage_receipt_sha256"],
            "host_environment_sha256": hashlib.sha256(self.env.read_bytes()).hexdigest(),
            "host_compose_sha256": hashlib.sha256(self.compose.read_bytes()).hexdigest(),
            "candidate_environment_sha256": created["candidate_environment_sha256"],
            "issued_at": utc(now - dt.timedelta(minutes=1)),
            "expires_at": utc(now + dt.timedelta(minutes=9)),
            "nonce": "12" * 32,
        }
        manifest.update(changes or {})
        self.review_manifest.write_bytes(canonical(manifest))
        self.review_manifest.chmod(0o600)
        self.review_public.chmod(0o600)
        self.review_private.chmod(0o600)
        subprocess.run(
            ["openssl", "pkeyutl", "-sign", "-inkey", str(self.review_private),
             "-rawin", "-in", str(self.review_manifest),
             "-out", str(self.review_signature)],
            check=True, capture_output=True, timeout=6)
        self.review_signature.chmod(0o600)

    def run_signed_review(self, created, key_pin=None):
        script = Path(__file__).with_name("caddy-https-host-signed-review.py")
        before = (self.plan.read_bytes(), self.env.read_bytes(),
                  self.compose.read_bytes())
        argv = [
            sys.executable, str(script),
            "--plan", str(self.plan),
            "--env-file", str(self.env),
            "--compose-file", str(self.compose),
            "--expected-plan-sha256", hashlib.sha256(self.plan.read_bytes()).hexdigest(),
            "--staging-dir", str(self.stage_dir),
            "--expected-stage-receipt-sha256", created["stage_receipt_sha256"],
            "--review-manifest", str(self.review_manifest),
            "--review-signature", str(self.review_signature),
            "--operator-public-key", str(self.review_public),
            "--expected-operator-key-der-sha256", key_pin or self.review_public_pin,
        ]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=14)
        self.assertNotIn("never-print-this", result.stdout + result.stderr)
        self.assertNotIn("192.168.2.4", result.stdout + result.stderr)
        self.assertNotIn(str(self.root), result.stdout + result.stderr)
        self.assertEqual(before, (self.plan.read_bytes(), self.env.read_bytes(),
                                  self.compose.read_bytes()))
        return result.returncode, json.loads(result.stdout)

    def test_operator_ed25519_signed_review_is_unapplied(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.make_signed_review(created)
        rc, out = self.run_signed_review(created)
        self.assertEqual(rc, 0)
        self.assertEqual(out["state"], "signed-review-verified-unapplied")
        self.assertFalse(out["apply_supported"])
        self.assertIn("revision-bound-host-cas-required", out["blockers"])
        self.assertEqual(out["stage_receipt_sha256"], created["stage_receipt_sha256"])
        self.assertEqual(out["review_manifest_sha256"],
                         hashlib.sha256(self.review_manifest.read_bytes()).hexdigest())

    def test_operator_review_rejects_wrong_key_and_stale_live_env(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.make_signed_review(created)
        self.assertEqual(self.run_signed_review(created, "f" * 64)[0], 2)
        self.env.write_text(ENV + "UNRELATED_SAFE_SETTING=changed\n")
        self.env.chmod(0o600)
        rc, out = self.run_signed_review(created)
        self.assertEqual((rc, out["state"]), (2, "blocked"))
        self.assertFalse(out["apply_supported"])

    def test_operator_review_rejects_signed_apply_scope_expiry_and_tamper(self):
        import datetime as dt
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.make_signed_review(created, {"action": "apply-and-restart"})
        self.assertEqual(self.run_signed_review(created)[0], 2)
        self.make_signed_review(created, {
            "issued_at": (dt.datetime.now(dt.timezone.utc) -
                          dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "expires_at": (dt.datetime.now(dt.timezone.utc) -
                           dt.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
        self.assertEqual(self.run_signed_review(created)[0], 2)
        self.make_signed_review(created)
        signature = self.review_signature.read_bytes()
        self.review_signature.write_bytes(signature[:-1] + bytes([signature[-1] ^ 1]))
        self.assertEqual(self.run_signed_review(created)[0], 2)
        self.review_signature.write_bytes(signature)
        self.review_signature.chmod(0o644)
        self.assertEqual(self.run_signed_review(created)[0], 2)
        self.review_signature.chmod(0o600)
        self.review_manifest.write_bytes(self.review_manifest.read_bytes() + b"\n")
        self.assertEqual(self.run_signed_review(created)[0], 2)

    def test_operator_review_script_never_grants_runtime_mutation(self):
        src = Path(__file__).with_name("caddy-https-host-signed-review.py").read_text()
        for denied in ("docker compose", "os.replace(", "os.unlink(",
                       "socket.", "requests.", "--insecure",
                       '"apply_supported": True'):
            self.assertNotIn(denied, src)



    def create_apply_intent(self, created, changes=None):
        """Sign a separate scoped request with the fixture-only Ed25519 key."""
        import uuid
        self.make_signed_review(created)
        request = json.loads(self.review_manifest.read_bytes())
        request.update({
            "scope": "xdrive.caddy.https.operator-apply-intent.v1",
            "action": "request-restricted-caddy-apply",
            "operation_uuid": str(uuid.uuid4()),
            "approved_rescue_image":
                "ghcr.io/lazyxu/xdrive-caddy@sha256:" + "a" * 64,
        })
        request.update(changes or {})
        self.review_manifest.write_bytes(canonical(request))
        self.review_manifest.chmod(0o600)
        subprocess.run([
            "openssl", "pkeyutl", "-sign", "-inkey", str(self.review_private),
            "-rawin", "-in", str(self.review_manifest),
            "-out", str(self.review_signature),
        ], check=True, capture_output=True, timeout=6)
        self.review_signature.chmod(0o600)
        return request

    def inspect_apply_intent(self, created, key_pin=None, plan_pin=None):
        script = Path(__file__).with_name("caddy-https-host-apply-intent-check.py")
        before = (self.plan.read_bytes(), self.env.read_bytes(),
                  self.compose.read_bytes())
        argv = [
            sys.executable, str(script),
            "--plan", str(self.plan),
            "--env-file", str(self.env),
            "--compose-file", str(self.compose),
            "--expected-plan-sha256", plan_pin or
                hashlib.sha256(self.plan.read_bytes()).hexdigest(),
            "--staging-dir", str(self.stage_dir),
            "--expected-stage-receipt-sha256", created["stage_receipt_sha256"],
            "--apply-intent-manifest", str(self.review_manifest),
            "--apply-intent-signature", str(self.review_signature),
            "--operator-public-key", str(self.review_public),
            "--expected-operator-key-der-sha256",
                key_pin or self.review_public_pin,
        ]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=14)
        self.assertNotIn("never-print-this", result.stdout + result.stderr)
        self.assertNotIn("192.168.2.4", result.stdout + result.stderr)
        self.assertNotIn(str(self.root), result.stdout + result.stderr)
        self.assertEqual(before, (self.plan.read_bytes(), self.env.read_bytes(),
                                  self.compose.read_bytes()))
        self.assertEqual(len(result.stdout.splitlines()), 1)
        return result.returncode, json.loads(result.stdout)

    def test_separately_signed_apply_intent_binds_db_revisions_and_stage_but_cannot_apply(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        request = self.create_apply_intent(created)
        rc, proof = self.inspect_apply_intent(created)
        self.assertEqual(rc, 0)
        self.assertEqual(proof["state"], "signed-apply-intent-inspected-unapplied")
        self.assertIs(proof["apply_supported"], False)
        self.assertEqual(proof["desired_revision"], 7)
        self.assertEqual(proof["credential_revision"], 0)
        self.assertEqual(proof["plan_sha256"], request["plan_sha256"])
        self.assertEqual(proof["stage_receipt_sha256"], created["stage_receipt_sha256"])
        self.assertEqual(proof["apply_intent_sha256"],
                         hashlib.sha256(self.review_manifest.read_bytes()).hexdigest())
        self.assertIn("durable-single-use-nonce-and-host-cas-not-implemented",
                      proof["blockers"])
        self.assertIn("independent-watchdog-rollback-not-armed", proof["blockers"])
        self.assertEqual(self.run_signed_review(created)[0], 2,
                         "The old candidate-review-only verifier MUST reject apply intent scope")
        # A passive signature inspection must NOT pretend it consumed a nonce.
        self.assertEqual(self.inspect_apply_intent(created)[0], 0)
        self.assertFalse(self.inspect_apply_intent(created)[1]["apply_supported"])

    def test_signed_apply_intent_rejects_review_scope_wrong_revision_and_false_identity(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.make_signed_review(created)
        self.assertEqual(self.inspect_apply_intent(created)[0], 2,
                         "candidate-review-only must never upgrade to a host apply request")
        for change in (
            {"scope": "xdrive.caddy.https.operator-stage-review.v1"},
            {"action": "candidate-review-only"},
            {"desired_revision": 8},
            {"desired_revision": True},
            {"credential_revision": 2},
            {"host_compose_sha256": "e" * 64},
            {"host_environment_sha256": "e" * 64},
            {"candidate_environment_sha256": "e" * 64},
            {"plan_sha256": "e" * 64},
            {"stage_receipt_sha256": "e" * 64},
            {"nonce": "0" * 64},
            {"nonce": "e" * 63},
            {"operation_uuid": "00000000-0000-0000-0000-000000000000"},
            {"approved_rescue_image": "ghcr.io/lazyxu/xdrive-caddy:latest"},
            {"approved_rescue_image": "ghcr.io/bad/../x@sha256:" + "e" * 64},
        ):
            with self.subTest(change=change):
                self.create_apply_intent(created, change)
                self.assertEqual(self.inspect_apply_intent(created)[0], 2)
        self.create_apply_intent(created)
        self.assertEqual(self.inspect_apply_intent(created, "f" * 64)[0], 2)

    def test_apply_intent_rejects_expired_future_invalid_canonical_and_mutation(self):
        import datetime as dt
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        stamp = lambda when: when.strftime("%Y-%m-%dT%H:%M:%SZ")
        for change in (
            {"issued_at": stamp(now - dt.timedelta(hours=2)),
             "expires_at": stamp(now - dt.timedelta(hours=1))},
            {"issued_at": stamp(now + dt.timedelta(minutes=3)),
             "expires_at": stamp(now + dt.timedelta(minutes=4))},
            {"issued_at": stamp(now - dt.timedelta(minutes=1)),
             "expires_at": stamp(now + dt.timedelta(minutes=11))},
            {"expires_at": "2026-13-89T80:11:09Z"},
            {"schema": 1.0},
        ):
            with self.subTest(change=change):
                self.create_apply_intent(created, change)
                self.assertEqual(self.inspect_apply_intent(created)[0], 2)
        self.create_apply_intent(created)
        raw = self.review_manifest.read_bytes()
        signature = self.review_signature.read_bytes()
        self.review_manifest.write_bytes(raw + b"\n")
        self.assertEqual(self.inspect_apply_intent(created)[0], 2)
        self.review_manifest.write_bytes(raw)
        self.review_signature.write_bytes(signature[:-1] + bytes(
            [signature[-1] ^ 1]))
        self.assertEqual(self.inspect_apply_intent(created)[0], 2)
        self.review_signature.write_bytes(signature)
        self.review_signature.chmod(0o644)
        self.assertEqual(self.inspect_apply_intent(created)[0], 2)
        self.review_signature.chmod(0o600)
        self.env.write_text(ENV + "UNRELATED_SAFE_VARIABLE=changed\n")
        self.env.chmod(0o600)
        self.assertEqual(self.inspect_apply_intent(created)[0], 2)

    def test_apply_intent_inspector_remains_read_only_and_separate_from_host_apply(self):
        src = Path(__file__).with_name("caddy-https-host-apply-intent-check.py").read_text()
        for forbidden in (
            "docker compose", "docker stop", "docker restart", "os.replace(",
            "os.unlink(", "os.rename(", "socket.", "requests.", "--insecure",
            '"apply_supported": True', "subprocess.run(",
        ):
            self.assertNotIn(forbidden, src)


    def admission_dir(self):
        folder = self.state / "caddy-https-admissions"
        folder.mkdir(mode=0o700, exist_ok=True)
        return folder

    def reserve_signed_intent(self, created, directory=None, pin=None):
        directory = directory or self.state / "caddy-https-admissions"
        script = Path(__file__).with_name("caddy-https-host-admission.py")
        arguments = [
            sys.executable, str(script),
            "--plan", str(self.plan),
            "--env-file", str(self.env),
            "--compose-file", str(self.compose),
            "--expected-plan-sha256", hashlib.sha256(self.plan.read_bytes()).hexdigest(),
            "--staging-dir", str(self.stage_dir),
            "--expected-stage-receipt-sha256", created["stage_receipt_sha256"],
            "--apply-intent-manifest", str(self.review_manifest),
            "--apply-intent-signature", str(self.review_signature),
            "--operator-public-key", str(self.review_public),
            "--expected-operator-key-der-sha256", pin or self.review_public_pin,
            "--admission-dir", str(directory),
        ]
        output = subprocess.run(arguments, capture_output=True, text=True, timeout=30)
        for secret in ("never-print-this", "192.168.2.4", str(self.root),
                       "test-approval-key.pem"):
            self.assertNotIn(secret, output.stdout + output.stderr)
        self.assertEqual(len(output.stdout.splitlines()), 1)
        return output.returncode, json.loads(output.stdout), arguments

    def test_host_admission_stamps_once_and_never_installs_gateway_config(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.create_apply_intent(created)
        directory = self.admission_dir()
        before = (self.env.read_bytes(), self.compose.read_bytes(),
                  self.review_manifest.read_bytes(), self.review_signature.read_bytes())
        rc, response, _ = self.reserve_signed_intent(created)
        self.assertEqual(rc, 0)
        self.assertEqual(response["state"], "signed-intent-pending-unapplied")
        self.assertFalse(response["apply_supported"])
        self.assertIn("no-host-apply-or-signed-applied-receipt", response["blockers"])
        self.assertIn("no-durable-db-revision-cas-or-apply-controller", response["blockers"])
        self.assertEqual(response["desired_revision"], 7)
        self.assertEqual(response["credential_revision"], 0)
        self.assertEqual(before, (self.env.read_bytes(), self.compose.read_bytes(),
                                  self.review_manifest.read_bytes(),
                                  self.review_signature.read_bytes()))
        self.assertEqual(sorted(x.name for x in directory.iterdir()),
                         [".intent.lock", "pending.json"])
        pending = directory / "pending.json"
        journal = json.loads(pending.read_bytes())
        self.assertEqual(journal["intent_sha256"],
                         hashlib.sha256(self.review_manifest.read_bytes()).hexdigest())
        self.assertIs(journal["apply_supported"], False)
        self.assertEqual(journal["state"], "signed-intent-pending-unapplied")
        self.assertEqual(stat.S_IMODE(pending.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((directory / ".intent.lock").stat().st_mode), 0o600)
        for private in ("never-print-this", "192.168.2.4", "test-approval-key.pem"):
            self.assertNotIn(private, pending.read_text())
        # A journal claim is sticky; it is never automatically released by
        # expired timestamps or a second valid signature.
        again, rejected, _ = self.reserve_signed_intent(created)
        self.assertEqual((again, rejected["state"]), (2, "blocked"))
        self.create_apply_intent(created)
        other, denied, _ = self.reserve_signed_intent(created)
        self.assertEqual((other, denied["state"]), (2, "blocked"))
        self.assertEqual(journal, json.loads(pending.read_bytes()))

    def test_host_admission_rejects_invalid_private_directory_and_partial_journal(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.create_apply_intent(created)
        # A missing directory must NOT be auto-created inside the live host.
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        folder = self.admission_dir()
        folder.chmod(0o755)
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        folder.chmod(0o700)
        partial = folder / "pending.json"
        partial.write_bytes(b"{partial-written-receipt")
        partial.chmod(0o600)
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        self.assertEqual(partial.read_bytes(), b"{partial-written-receipt")
        partial.unlink()
        lock = folder / ".intent.lock"
        if lock.exists():
            lock.unlink()
        lock.symlink_to(self.env)
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        lock.unlink()
        folder.rename(self.state / "private-admission-original")
        folder.symlink_to(self.state / "private-admission-original")
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        folder.unlink()
        # Trying to use a path outside the installation /state is blocked.
        outside = self.root / "outside-admission"
        outside.mkdir(mode=0o700)
        self.assertEqual(self.reserve_signed_intent(created, outside)[0], 2)

    def test_host_admission_never_claims_signed_review_is_apply_request(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.admission_dir()
        self.make_signed_review(created)
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        self.create_apply_intent(created, {"nonce": "0" * 64})
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)
        self.create_apply_intent(created)
        self.assertEqual(self.reserve_signed_intent(created, pin="f" * 64)[0], 2)
        self.assertFalse((self.state / "caddy-https-admissions" / "pending.json").exists())
        # A change to the protected env is also a hard failure, with no
        # automatic "repair" or live configuration mutation.
        self.env.write_text(ENV + "UNRELATED_SAFE_VARIABLE=changed\n")
        self.env.chmod(0o600)
        self.assertEqual(self.reserve_signed_intent(created)[0], 2)

    def test_durable_host_admission_concurrent_calls_one_pending_only(self):
        rc, created = self.stage()
        self.assertEqual(rc, 0)
        self.create_apply_intent(created)
        directory = self.admission_dir()
        argv = [
            sys.executable,
            str(Path(__file__).with_name("caddy-https-host-admission.py")),
            "--plan", str(self.plan),
            "--env-file", str(self.env),
            "--compose-file", str(self.compose),
            "--expected-plan-sha256", hashlib.sha256(self.plan.read_bytes()).hexdigest(),
            "--staging-dir", str(self.stage_dir),
            "--expected-stage-receipt-sha256", created["stage_receipt_sha256"],
            "--apply-intent-manifest", str(self.review_manifest),
            "--apply-intent-signature", str(self.review_signature),
            "--operator-public-key", str(self.review_public),
            "--expected-operator-key-der-sha256", self.review_public_pin,
            "--admission-dir", str(directory),
        ]
        # Genuine concurrent processes compete for the same fixed private
        # lock and pending.json (never just serial replay).
        children = [
            subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            for _ in range(3)
        ]
        statuses = []
        for child in children:
            out, err = child.communicate(timeout=35)
            self.assertNotIn(b"never-print-this", out + err)
            self.assertNotIn(str(self.root).encode(), out + err)
            statuses.append((child.returncode, json.loads(out)["state"]))
        self.assertEqual(statuses.count((0, "signed-intent-pending-unapplied")), 1)
        self.assertEqual(statuses.count((2, "blocked")), 2)
        self.assertEqual(len(list(directory.glob("pending.json"))), 1)
        self.assertFalse(json.loads((directory / "pending.json").read_text())["apply_supported"])

    def test_admission_controller_has_no_docker_or_config_mutation_capability(self):
        source = Path(__file__).with_name("caddy-https-host-admission.py").read_text()
        for forbidden in (
            "docker compose", "docker restart", "docker stop", "os.replace(",
            "os.unlink(", "os.rename(", "subprocess.run(", "socket.",
            "requests.", "--insecure", '"apply_supported": True',
            "os.chmod(self.env", "open('/var/run/docker.sock'",
        ):
            self.assertNotIn(forbidden, source)

if __name__ == "__main__":
    # NET-M5-C0: the existing server-validation entrypoint executes the real
    # isolated loopback TLS fixture without changing unrelated CI workflows.
    subprocess.run(
        [sys.executable, str(Path(__file__).with_name(
            "test-caddy-https-remote-login-check.py"))],
        check=True, timeout=120,
    )
    unittest.main()
