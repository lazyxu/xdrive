#!/usr/bin/env python3
"""Offline negative-by-default NET-M5-B2 host plan fixture. No Docker/network."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
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


if __name__ == "__main__":
    unittest.main()
