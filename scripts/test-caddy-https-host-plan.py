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

if __name__ == "__main__":
    unittest.main()
