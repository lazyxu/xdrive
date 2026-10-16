#!/usr/bin/env python3
"""Offline fake-SSH stdio plus REAL local HTTP server: no external SSH/host."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/caddy-rescue-ssh-auth-check.py"
TOKEN = "header." + "a" * 60 + ".signature"
IDS = [
    "database", "storage", "background-worker", "caddy", "media-worker",
    "photo-face", "photo-smart", "photo-semantic", "photo-creative",
    "baidu-map", "geonames",
]


class Handler(BaseHTTPRequestHandler):
    anon_open = False
    bad_login = False
    insufficient_role = False
    missing_inventory = False
    healthy = True

    def reply(self, status, data=None):
        body = json.dumps(data or {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/v1/readyz":
            self.reply(200 if self.healthy else 503)
        elif self.path == "/api/v1/admin/services":
            if self.headers.get("Authorization") == "Bearer " + TOKEN:
                items = IDS[:-1] if self.missing_inventory else IDS
                self.reply(200, {"checked_at": "2026-10-17T00:00:00Z",
                                 "services": [{"id": i} for i in items]})
            else:
                self.reply(200 if self.anon_open else 401)
        else:
            self.reply(404)

    def do_POST(self):
        if self.path != "/api/v1/auth/login":
            return self.reply(404)
        size = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(size))
        if self.bad_login or body != {"username": "test-admin", "password": "NEVER_PRINT_THIS_SECRET"}:
            return self.reply(401)
        self.reply(200, {"role": "user" if self.insufficient_role else "admin",
                         "must_change_password": False,
                         "access_token": TOKEN})

    def log_message(self, *_args):
        pass


SHIM = r'''#!/usr/bin/env python3
import json, os, socket, sys
args = sys.argv[1:]
with open(os.environ["XDRIVE_SSH_FAKE_ARGUMENTS"], "a") as out:
    out.write(json.dumps(args) + "\n")
assert "-F" in args and "/dev/null" in args
assert "StrictHostKeyChecking=yes" in args
assert "BatchMode=yes" in args
assert "ExitOnForwardFailure=yes" in args
assert "ForwardAgent=no" in args
assert "-W" in args and "127.0.0.1:3080" in args
assert not any(part in args for part in ("-R", "-D"))
hostpaths = [part.split("=", 1)[1] for part in args
             if part.startswith("UserKnownHostsFile=")]
assert len(hostpaths) == 1
with open(hostpaths[0], encoding="utf-8") as trusted:
    assert "trusted-host ssh-ed25519 AAAATEST_OFFLINE_ONLY_DO_NOT_TRUST" in trusted.read()
original = os.environ.get("XDRIVE_SSH_FAKE_MUTATE_ORIGINAL")
if original:
    assert os.path.realpath(hostpaths[0]) != os.path.realpath(original)
    with open(original, "w", encoding="utf-8") as changed:
        changed.write("CHANGED_AFTER_PINNED_SNAPSHOT\n")
s = socket.create_connection(("127.0.0.1", int(os.environ["XDRIVE_SSH_FAKE_BACKEND"])), timeout=4)
data = sys.stdin.buffer.read(8192)
s.sendall(data)
s.shutdown(socket.SHUT_WR)
while True:
    part = s.recv(8192)
    if not part:
        break
    sys.stdout.buffer.write(part)
s.close()
'''


def case(root, expect_ok, overrides=None, target="user@trusted-host", token_input="test-admin\nNEVER_PRINT_THIS_SECRET\n",
         known_hosts=None, mutate_original=False):
    Handler.anon_open = False
    Handler.bad_login = False
    Handler.insufficient_role = False
    Handler.missing_inventory = False
    Handler.healthy = True
    for name, value in (overrides or {}).items():
        setattr(Handler, name, value)
    env = os.environ.copy()
    env["PATH"] = str(root / "bin") + os.pathsep + env.get("PATH", "")
    env["XDRIVE_SSH_FAKE_ARGUMENTS"] = str(root / "args.jsonl")
    if mutate_original:
        env["XDRIVE_SSH_FAKE_MUTATE_ORIGINAL"] = str(root / "pinned_known_hosts")
    result = subprocess.run([
        sys.executable, str(SCRIPT), target, str(known_hosts or root / "pinned_known_hosts"),
        "3080", "2222",
    ], capture_output=True, text=True, input=token_input,
       env=env, timeout=30, check=False)
    assert (result.returncode == 0) == expect_ok, result.stderr
    if expect_ok:
        assert "rescue-admin-inventory: 11-fixed-services-verified" in result.stdout
        assert "rescue-ssh-pinned-hosts: isolated-single-snapshot" in result.stdout
        assert "real-primary-caddy-outage-and-restoration: unverified" in result.stdout
        assert "caddy-apply-stop-restart: blocked" in result.stdout
    else:
        assert "blocked" in result.stderr
        assert "rescue-admin-inventory" not in result.stdout
    output = result.stdout + result.stderr
    assert "NEVER_PRINT_THIS_SECRET" not in output
    assert TOKEN not in output
    assert "user@trusted-host" not in output
    assert not any(line.startswith("ssh ") for line in output.splitlines())
    return result


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "bin").mkdir()
            ssh = root / "bin/ssh"
            ssh.write_text(SHIM)
            ssh.chmod(0o755)
            (root / "pinned_known_hosts").write_text(
                "trusted-host ssh-ed25519 AAAATEST_OFFLINE_ONLY_DO_NOT_TRUST\n")
            os.environ["XDRIVE_SSH_FAKE_BACKEND"] = str(server.server_address[1])
            case(root, True)
            # Changing the original host-key file after the first request must
            # not alter the private snapshot used for the remaining SSH calls.
            case(root, True, mutate_original=True)
            pinned = root / "pinned_known_hosts"
            assert pinned.read_text() == "CHANGED_AFTER_PINNED_SNAPSHOT\n"
            pinned.write_text(
                "trusted-host ssh-ed25519 AAAATEST_OFFLINE_ONLY_DO_NOT_TRUST\n")
            alias = root / "pinned-known-hosts-symlink"
            alias.symlink_to(pinned)
            case(root, False, known_hosts=alias)
            pinned.chmod(0o664)
            case(root, False)
            pinned.chmod(0o600)
            for name, overrides in (
                ("not-ready", {"healthy": False}),
                ("anonymous-admin-open", {"anon_open": True}),
                ("wrong-login", {"bad_login": True}),
                ("nonadmin-login", {"insufficient_role": True}),
                ("missing-service", {"missing_inventory": True}),
            ):
                case(root, False, overrides)
                print("blocked unsafe fake SSH receipt:", name)
            case(root, False, target="-oProxyCommand=evil")
            case(root, False, token_input="test-admin\nwrong-password\n")
            args = [json.loads(line) for line in
                    (root / "args.jsonl").read_text().splitlines()]
            assert args and all("--" in item for item in args)
            assert all("StrictHostKeyChecking=yes" in item for item in args)
            assert all("UserKnownHostsFile=" in " ".join(item) for item in args)
            print("Caddy rescue pinned SSH stdio admin proof: offline contracts passed")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    main()
