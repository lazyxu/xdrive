#!/usr/bin/env python3
"""Real loopback TLS fixture for off-host Caddy origin login proof.

No real host, Docker, credentials, WAN calls or certificate bypass.
"""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest import mock

SOURCE = Path(__file__).with_name("caddy-https-remote-login-check.py")
spec = importlib.util.spec_from_file_location("xdrive_offhost_caddy_proof", SOURCE)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

TOKEN = "token." + "z" * 64
USERNAME = "test-admin"
PASSWORD = "NEVER_PRINT_REAL_SECRETS"
IDS = sorted(probe.EXPECTED_SERVICES)
PLAN = {
    "protocol": "xdrive.caddy.https.host-plan.v1",
    "desired_revision": 7,
    "credential_revision": 0,
    "domain_enabled": False,
    "domain": "",
    "lan_enabled": True,
    "lan_ip": "192.168.2.4",
}
RAW_PLAN = (json.dumps(PLAN, sort_keys=True, separators=(",", ":")) +
            "\n").encode("ascii")


class HTTPSHandler(BaseHTTPRequestHandler):
    ready = True
    anonymous_open = False
    public_plan_open = False
    wrong_role = False
    wrong_plan = False
    wrong_inventory = False
    bad_login = False

    def reply(self, status, value):
        raw = value if isinstance(value, bytes) else json.dumps(
            value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        return self.headers.get("Authorization") == "Bearer " + TOKEN

    def do_GET(self):
        if self.path == "/api/v1/readyz":
            self.reply(200 if self.ready else 503, {"ok": self.ready})
        elif self.path == "/api/v1/admin/services":
            if not self.authorized():
                self.reply(200 if self.anonymous_open else 401, {})
            else:
                services = IDS[:-1] if self.wrong_inventory else IDS
                self.reply(200, {"services": [{"id": i} for i in services]})
        elif self.path == "/api/v1/admin/services/caddy/https/host-plan":
            if self.authorized():
                self.reply(200, b"bad-plan\n" if self.wrong_plan else RAW_PLAN)
            else:
                self.reply(200 if self.public_plan_open else 401, RAW_PLAN if self.public_plan_open else {})
        else:
            self.reply(404, {})

    def do_POST(self):
        if self.path != "/api/v1/auth/login":
            self.reply(404, {})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(min(length, 5000)))
        except ValueError:
            self.reply(400, {})
            return
        if self.bad_login or body != {"username": USERNAME, "password": PASSWORD}:
            self.reply(401, {})
            return
        self.reply(200, {
            "role": "user" if self.wrong_role else "admin",
            "must_change_password": False,
            "access_token": TOKEN,
        })

    def log_message(self, *_args):
        pass


class RealLoopbackHTTPSCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.ca = root / "ca.pem"
        ca_key = root / "ca.key"
        server_key = root / "server.key"
        server_request = root / "server.csr"
        server_cert = root / "server.crt"
        extensions = root / "server.ext"
        extensions.write_text("subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n"
                              "basicConstraints=CA:FALSE\n")
        commands = (
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", str(ca_key), "-out", str(self.ca), "-days", "1",
             "-subj", "/CN=xDrive-test-pinned-root"],
            ["openssl", "req", "-newkey", "rsa:2048", "-nodes",
             "-keyout", str(server_key), "-out", str(server_request),
             "-subj", "/CN=127.0.0.1"],
            ["openssl", "x509", "-req", "-in", str(server_request),
             "-CA", str(self.ca), "-CAkey", str(ca_key),
             "-CAcreateserial", "-out", str(server_cert), "-days", "1",
             "-extfile", str(extensions)],
        )
        for argv in commands:
            subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           check=True, timeout=8)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), HTTPSHandler)
        self.server.daemon_threads = True
        self.addCleanup(self.server.server_close)
        server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_ctx.load_cert_chain(str(server_cert), str(server_key))
        self.server.socket = server_ctx.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join, 3)
        self.addCleanup(self.server.shutdown)
        HTTPSHandler.ready = True
        HTTPSHandler.anonymous_open = False
        HTTPSHandler.public_plan_open = False
        HTTPSHandler.wrong_role = False
        HTTPSHandler.wrong_plan = False
        HTTPSHandler.wrong_inventory = False
        HTTPSHandler.bad_login = False

    def tls(self, ca=None):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_verify_locations(cafile=str(ca or self.ca))
        return context

    def verify(self, addr="127.0.0.1", ca=None):
        return probe.verify_origin(
            addr, self.server.server_port, self.tls(ca),
            USERNAME, PASSWORD, RAW_PLAN)

    def test_real_ip_san_tls_login_authenticated_plan_same_origin(self):
        self.assertEqual(self.verify(), probe.OK)
        old = os.environ.get("HTTPS_PROXY")
        try:
            os.environ["HTTPS_PROXY"] = "http://127.0.0.1:1"
            self.assertEqual(self.verify(), probe.OK)
        finally:
            if old is None:
                os.environ.pop("HTTPS_PROXY", None)
            else:
                os.environ["HTTPS_PROXY"] = old

    def test_wrong_hostname_and_untrusted_ca_fail_closed(self):
        with self.assertRaises(ssl.SSLError):
            self.verify(addr="localhost")
        other_ca = Path(self.tmp.name) / "untrusted.pem"
        other_ca.write_text("")
        with self.assertRaises((ssl.SSLError, ValueError)):
            self.verify(ca=other_ca)

    def test_real_http_anonymous_auth_and_saved_plan_contract(self):
        for field in ("ready", "anonymous_open", "public_plan_open", "wrong_role",
                      "wrong_plan", "wrong_inventory", "bad_login"):
            value = False if field == "ready" else True
            with self.subTest(field=field):
                setattr(HTTPSHandler, field, value)
                try:
                    with self.assertRaises(probe.Blocked):
                        self.verify()
                finally:
                    setattr(HTTPSHandler, field, not value)

    def test_invalid_inputs_rejected_before_connection(self):
        self.assertFalse(probe.valid_port("0"))
        self.assertFalse(probe.valid_port("65536"))
        self.assertFalse(probe.valid_port("+443"))
        self.assertFalse(probe.valid_port("0443"))
        self.assertTrue(probe.valid_port("443"))
        with self.assertRaises(probe.Blocked):
            probe.verify_origin("127.0.0.1", self.server.server_port,
                                self.tls(), USERNAME, "bad\ncredential", RAW_PLAN)

    def test_disabled_and_stale_plan_fail_without_network(self):
        file = Path(self.tmp.name) / "plan.json"
        file.write_bytes(RAW_PLAN)
        file.chmod(0o600)
        with self.assertRaises(probe.Blocked):
            probe.verify(str(file), "f" * 64, "8443", str(self.ca),
                         hashlib.sha256(self.ca.read_bytes()).hexdigest(),
                         USERNAME, PASSWORD)
        with self.assertRaises(probe.Blocked):
            probe.verify(str(file), hashlib.sha256(file.read_bytes()).hexdigest(),
                         "8443", None, None, USERNAME, PASSWORD)
        both_off = dict(PLAN, lan_enabled=False, lan_ip="",
                        domain_enabled=False, domain="")
        file.write_bytes((json.dumps(both_off, sort_keys=True,
                                    separators=(",", ":")) + "\n").encode("ascii"))
        with self.assertRaises(probe.host_plan.Blocked):
            probe.verify(str(file), hashlib.sha256(file.read_bytes()).hexdigest(),
                         "8443", None, None, USERNAME, PASSWORD)


    def test_prior_origin_probe_detects_old_xdrive_without_sending_credentials(self):
        # The 3 original anonymous endpoints identify a still-serving xDrive
        # instance without ever sending a username, password or bearer token.
        self.assertEqual(probe.probe_retired_origin(
            "127.0.0.1", self.server.server_port, self.tls()),
            "still-serving-xdrive")
        for field, value in (("ready", False), ("anonymous_open", True),
                             ("public_plan_open", True)):
            setattr(HTTPSHandler, field, value)
            try:
                self.assertEqual(probe.probe_retired_origin(
                    "127.0.0.1", self.server.server_port, self.tls()),
                    "unverified")
            finally:
                setattr(HTTPSHandler, field, not value)
        self.assertEqual(probe.probe_retired_origin(
            "localhost", self.server.server_port, self.tls()),
            "unverified")

    def test_retired_targets_include_disabled_and_switched_lan_domain_only(self):
        previous = dict(PLAN, desired_revision=7, lan_enabled=True,
                        domain_enabled=True, domain="old.example.com",
                        credential_revision=4)
        current = dict(previous, desired_revision=8, lan_enabled=False,
                       lan_ip="", domain="new.example.com")
        self.assertEqual(probe.retired_targets(current, previous), [
            ("lan", "192.168.2.4"), ("domain", "old.example.com")])
        with self.assertRaises(probe.Blocked):
            probe.retired_targets(previous, previous)
        with self.assertRaises(probe.Blocked):
            probe.retired_targets(dict(previous, desired_revision=8), previous)
        with self.assertRaises(probe.Blocked):
            probe.retired_targets(dict(previous, desired_revision=6), previous)
        with self.assertRaises(probe.Blocked):
            probe.retired_targets(dict(previous, desired_revision=8,
                                       lan_enabled=False, domain_enabled=False),
                                  previous)

    def test_previous_plan_opt_in_fails_closed_before_any_network(self):
        former = dict(PLAN, desired_revision=7, lan_enabled=True)
        current = dict(PLAN, desired_revision=8, lan_enabled=False,
                       lan_ip="", domain_enabled=True,
                       domain="new.example.com", credential_revision=3)
        private = Path(self.tmp.name)
        prev_path, next_path = private / "previous.json", private / "current.json"
        def canonical(data):
            return (json.dumps(data, sort_keys=True, separators=(",", ":")) +
                    "\n").encode("ascii")
        prev_path.write_bytes(canonical(former))
        next_path.write_bytes(canonical(current))
        prev_path.chmod(0o600)
        next_path.chmod(0o600)
        with self.assertRaises(probe.Blocked):
            probe.verify_retired_origins(
                str(next_path), hashlib.sha256(next_path.read_bytes()).hexdigest(),
                str(prev_path), "f" * 64, str(self.server.server_port),
                None, None, str(self.ca),
                hashlib.sha256(self.ca.read_bytes()).hexdigest(),
                USERNAME, PASSWORD)
        with self.assertRaises(probe.Blocked):
            probe.verify_retired_origins(
                str(next_path), hashlib.sha256(next_path.read_bytes()).hexdigest(),
                str(prev_path), hashlib.sha256(prev_path.read_bytes()).hexdigest(),
                str(self.server.server_port), None, None,
                None, None, USERNAME, PASSWORD)

    def test_prior_host_revision_proofs_remain_advisory_and_block_live_old_origin(self):
        previous = dict(PLAN, desired_revision=7, lan_enabled=True,
                        domain_enabled=False, domain="")
        current = dict(PLAN, desired_revision=8, lan_enabled=False,
                       lan_ip="", domain_enabled=True,
                       domain="new.example.com", credential_revision=3)
        root = Path(self.tmp.name)
        old_path, now_path = root / "before.json", root / "after.json"
        def save_plan(path, value):
            data = (json.dumps(value, sort_keys=True, separators=(",", ":")) +
                    "\n").encode("ascii")
            path.write_bytes(data)
            path.chmod(0o600)
            return hashlib.sha256(data).hexdigest()
        old_pin = save_plan(old_path, previous)
        now_pin = save_plan(now_path, current)
        ca_pin = hashlib.sha256(self.ca.read_bytes()).hexdigest()
        observed = []
        def current_login(*_args):
            observed.append("current")
            return {"state": "enabled-origin-logins-verified-unapplied",
                    "apply_supported": False}
        def old_check(*_args):
            observed.append("old")
            return "still-serving-xdrive"
        args = (str(now_path), now_pin, str(old_path), old_pin,
                str(self.server.server_port), None, None,
                str(self.ca), ca_pin, USERNAME, PASSWORD)
        with mock.patch.object(probe, "verify", side_effect=current_login), \
             mock.patch.object(probe, "probe_retired_origin", side_effect=old_check):
            with self.assertRaises(probe.Blocked):
                probe.verify_retired_origins(*args)
        self.assertEqual(observed, ["current", "old"])
        observed.clear()
        with mock.patch.object(probe, "verify", side_effect=current_login), \
             mock.patch.object(probe, "probe_retired_origin",
                               return_value="unverified"):
            reply = probe.verify_retired_origins(*args)
        self.assertEqual(reply["state"], "old-origin-removal-unverified-unapplied")
        self.assertIs(reply["apply_supported"], False)
        self.assertEqual(reply["observations"]["lan"], "unverified")
        self.assertEqual(reply["observations"]["domain"], "not-retired")
        self.assertEqual(reply["desired_revision"], 8)
        self.assertEqual(reply["previous_revision"], 7)

    def test_retired_probe_source_preserves_full_offhost_no_apply_boundary(self):
        src = SOURCE.read_text()
        marker = src[src.index("def probe_retired_origin("):
                     src.index("def verify_retired_origins(")]
        self.assertNotIn('"POST"', marker)
        self.assertNotIn("Authorization", marker)
        self.assertIn("old-origin-probe-never-sends-credentials", src)
        self.assertIn('"apply_supported": False', src)
        self.assertNotIn("docker restart", src)
        self.assertNotIn("subprocess.", src)

    def test_operator_only_security_source(self):
        source = SOURCE.read_text()
        for disallowed in ("--insecure", "CERT_NONE", "check_hostname = False",
                           "docker compose", "os.replace(", "os.unlink(",
                           "urllib.request.urlopen", "requests.", "shell=True",
                           '"apply_supported": True'):
            self.assertNotIn(disallowed, source)
        self.assertIn("ssl.PROTOCOL_TLS_CLIENT", source)
        self.assertIn("hmac.compare_digest(remote_plan, canonical_plan)", source)


if __name__ == "__main__":
    unittest.main()
