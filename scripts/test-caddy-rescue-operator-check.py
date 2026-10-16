#!/usr/bin/env python3
"""Real-localhost plus fake-Docker negative contract; never touch a user daemon."""
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/caddy-rescue-operator-check.py"
REF = "ghcr.io/lazyxu/xdrive-caddy@sha256:" + "a" * 64
RID = "a" * 64
RIMAGE = "sha256:" + "c" * 64


class Handler(BaseHTTPRequestHandler):
    allow_anon = False

    def do_GET(self):
        status = 200 if self.path == "/api/v1/readyz" else (
            200 if self.allow_anon else 401
        ) if self.path == "/api/v1/admin/services" else 404
        self.send_response(status)
        self.end_headers()

    def log_message(self, *_args):
        pass


FAKE = r'''#!/usr/bin/env python3
import os, pathlib, sys
root = pathlib.Path(os.environ["XDRIVE_RESCUE_FIXTURE"])
args = sys.argv[1:]
if args[0] == "compose" and args[-3:] == ["config", "--format", "json"]:
    p = "compose.json"
elif args[0] == "compose" and args[-3:] == ["ps", "-q", "caddy-rescue"]:
    print("a" * 64)
    sys.exit(0)
elif args[:3] == ["inspect", "--type", "container"]:
    p = "rescue.json" if args[-1] == "a" * 64 else "primary.json"
elif args[:2] == ["image", "inspect"]:
    p = "image.json"
else:
    # Mutating Docker calls are not permitted in any test outcome.
    sys.exit(97)
print((root / p).read_text())
'''


def fixtures(port):
    xdg = {"XDG_CONFIG_HOME": "/tmp/caddy-rescue-config",
           "XDG_DATA_HOME": "/tmp/caddy-rescue-data"}
    labels = {"com.docker.compose.project": "xdrive-fixture",
              "com.docker.compose.service": "caddy-rescue"}
    return {
        "compose": {"services": {"caddy-rescue": {
            "profiles": ["caddy-rescue"], "image": REF, "user": "65532:65532",
            "environment": xdg, "ports": [{"host_ip": "127.0.0.1",
                "target": 8080, "protocol": "tcp", "published": str(port)}]}}},
        "rescue": [{"Name": "/xdrive-caddy-rescue", "Image": RIMAGE,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "Config": {"Image": REF, "User": "65532:65532", "Labels": labels,
                "Env": ["PATH=/usr/bin", "XDG_CONFIG_HOME=/tmp/caddy-rescue-config",
                        "XDG_DATA_HOME=/tmp/caddy-rescue-data"]},
            "HostConfig": {"ReadonlyRootfs": True, "Privileged": False,
                "CapDrop": ["ALL"], "CapAdd": None, "SecurityOpt": ["no-new-privileges:true"],
                "NetworkMode": "xdrive_default",
                "Tmpfs": {"/tmp": "rw,nosuid,nodev,noexec,size=32m"}},
            "Mounts": [],
            "NetworkSettings": {"Ports": {"8080/tcp": [{
                "HostIp": "127.0.0.1", "HostPort": str(port)}], "80/tcp": None}}}],
        "primary": [{"Image": "sha256:" + "b" * 64,
            "Config": {"Labels": {"com.docker.compose.project": "xdrive-fixture",
                "com.docker.compose.service": "caddy"}}}],
        "image": [{"Id": RIMAGE, "RepoDigests": [REF]}],
    }


def try_fixture(fx, expected_success, anon_allowed=False):
    Handler.allow_anon = anon_allowed
    with tempfile.TemporaryDirectory() as name:
        root = Path(name)
        fakebin = root / "bin"
        fakebin.mkdir()
        binary = fakebin / "docker"
        binary.write_text(FAKE)
        binary.chmod(0o755)
        for key, data in fx.items():
            (root / (key + ".json")).write_text(json.dumps(data))
        envfile, compose = root / ".env", root / "compose.yml"
        envfile.write_text("# test\n")
        compose.write_text("# test\n")
        env = dict(os.environ)
        env["PATH"] = str(fakebin) + os.pathsep + env.get("PATH", "")
        env["XDRIVE_RESCUE_FIXTURE"] = str(root)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(envfile), str(compose)],
            capture_output=True, text=True, env=env, timeout=15,
        )
        assert (result.returncode == 0) == expected_success, result.stderr
        if expected_success:
            assert "rescue-anonymous-admin: denied" in result.stdout
            assert "operator-ssh-and-authenticated-outage-access: unverified" in result.stdout
        else:
            assert "blocked" in result.stderr
        assert REF not in result.stderr + result.stdout
        assert RID not in result.stderr + result.stdout
        assert "NEVER_PRINT_THIS_SECRET" not in result.stderr + result.stdout


def main():
    http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        base = fixtures(http.server_address[1])
        try_fixture(base, True)
        attacks = (
            ("floating-tag", lambda d: d["compose"]["services"]["caddy-rescue"].update(
                image="ghcr.io/lazyxu/xdrive-caddy:latest")),
            ("public-port", lambda d: d["rescue"][0]["NetworkSettings"]["Ports"]["8080/tcp"][0].update(
                HostIp="0.0.0.0")),
            ("wrong-image", lambda d: d["image"][0].update(RepoDigests=[])),
            ("same-primary", lambda d: d["primary"][0].update(Image=RIMAGE)),
            ("extra-mount", lambda d: d["rescue"][0].update(
                Mounts=[{"Type": "bind", "Destination": "/config"}])),
            ("extra-cap", lambda d: d["rescue"][0]["HostConfig"].update(
                CapDrop=[])),
            ("secret-env", lambda d: d["rescue"][0]["Config"]["Env"].append(
                "ALIYUN_ACCESS_KEY_SECRET=NEVER_PRINT_THIS_SECRET")),
            ("wrong-project", lambda d: d["rescue"][0]["Config"]["Labels"].update(
                **{"com.docker.compose.project": "other"})),
        )
        for name, mutate in attacks:
            value = copy.deepcopy(base)
            mutate(value)
            try_fixture(value, False)
            print("denied unsafe operator fixture:", name)
        try_fixture(base, False, anon_allowed=True)
        print("denied unsafe operator fixture: anonymous-admin-open")
    finally:
        http.shutdown()
        http.server_close()
        thread.join(timeout=3)
    print("Caddy rescue operator-only local preflight: all fixtures passed")


if __name__ == "__main__":
    main()
