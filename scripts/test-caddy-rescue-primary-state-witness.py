#!/usr/bin/env python3
"""Fake Docker/real localhost phase witness. Never mutate actual services."""
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/caddy-rescue-primary-state-witness.py"

import runpy
COMPONENT = runpy.run_path(str(ROOT / "scripts/test-caddy-rescue-operator-check.py"))
make_fixture = COMPONENT["fixtures"]
HTTP = COMPONENT["Handler"]
IMAGE_ID = "sha256:" + "b" * 64


FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os
from pathlib import Path
import sys

root = Path(os.environ["XDRIVE_RESCUE_PHASE_FIXTURE"])
args = sys.argv[1:]
if args[:3] == ["inspect", "--type", "container"]:
    names = {"xdrive-caddy": "primary",
             "xdrive-server": "server",
             "xdrive-caddy-rescue": "rescue",
             "a" * 64: "rescue"}
    file = names.get(args[-1])
    if file is None:
        sys.exit(91)
    if file == "primary":
        counter = root / "primary-inspects"
        n = int(counter.read_text()) + 1 if counter.exists() else 1
        counter.write_text(str(n))
        if n >= 3 and (root / "primary-after.json").exists():
            file = "primary-after"
elif args[0] == "compose" and args[-3:] == ["config", "--format", "json"]:
    file = "compose"
elif args[0] == "compose" and args[-3:] == ["ps", "-q", "caddy-rescue"]:
    print("a" * 64)
    sys.exit(0)
elif args[:2] == ["image", "inspect"]:
    file = "image"
else:
    # NEVER call stop, start, restart, up, down, docker exec, or host shell.
    sys.exit(92)
sys.stdout.write((root / (file + ".json")).read_text())
'''


def fixture(port, phase):
    cases = make_fixture(port)
    started = "2026-10-16T15:00:00.000000Z"
    labels = {"com.docker.compose.project": "xdrive-fixture"}
    primary = cases["primary"][0]
    primary.update({
        "Id": "b" * 64, "Name": "/xdrive-caddy",
        "State": {"Running": phase != "primary-down", "Restarting": False,
                  "Status": "exited" if phase == "primary-down" else "running",
                  "StartedAt": started,
                  "FinishedAt": "2026-10-16T15:05:00Z" if phase == "primary-down"
                      else "0001-01-01T00:00:00Z",
                  "Health": {"Status": "healthy" if phase != "primary-down"
                             else "unhealthy"}},
    })
    server = {
        "Id": "d" * 64, "Name": "/xdrive-server",
        "Image": "sha256:" + "d" * 64,
        "Config": {"Labels": {**labels, "com.docker.compose.service": "server"}},
        "State": {"Running": True, "Restarting": False, "Status": "running",
                  "StartedAt": started, "Health": {"Status": "healthy"}},
    }
    rescue = cases["rescue"][0]
    rescue.update({
        "Id": "a" * 64,
        "State": {**rescue["State"], "Restarting": False,
                  "Status": "running", "StartedAt": started},
    })
    cases["server"] = [server]
    return cases


def run_case(phase, specimen, expect_ok, allow_anon=False,
             change_primary_after=None):
    HTTP.allow_anon = allow_anon
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        fake = bin_dir / "docker"
        fake.write_text(FAKE_DOCKER, encoding="utf-8")
        fake.chmod(0o755)
        for key, value in specimen.items():
            (root / (key + ".json")).write_text(json.dumps(value), encoding="utf-8")
        if change_primary_after is not None:
            (root / "primary-after.json").write_text(
                json.dumps([change_primary_after]), encoding="utf-8")
        envf, composef = root / ".env", root / "compose.yml"
        envf.write_text("# local fixture\n")
        composef.write_text("# local fixture\n")
        env = dict(os.environ)
        env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
        env["XDRIVE_RESCUE_PHASE_FIXTURE"] = str(root)
        reply = subprocess.run(
            [sys.executable, str(SCRIPT), phase, str(envf), str(composef)],
            text=True, capture_output=True, env=env, timeout=25,
            check=False,
        )
        assert (reply.returncode == 0) == expect_ok, reply.stderr
        if expect_ok:
            assert "primary-caddy-observed-phase: " + phase in reply.stdout
            assert "off-host-ssh-admin-while-primary-down: unverified" in reply.stdout
            assert "public-https-and-caddy-apply-rollback: blocked" in reply.stdout
        else:
            assert "blocked" in reply.stderr
            assert "primary-caddy-observed-phase" not in reply.stdout
        assert "NEVER_PRINT_THIS_SECRET" not in reply.stderr + reply.stdout
        assert "sha256:" not in reply.stderr + reply.stdout


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), HTTP)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        for stage in ("before", "primary-down", "restored"):
            run_case(stage, fixture(port, stage), True)
            print("read-only phase observed:", stage)
        base = fixture(port, "primary-down")
        attacks = (
            ("primary-still-running", lambda d: d["primary"][0]["State"].update(
                Running=True, Status="running")),
            ("primary-restarting", lambda d: d["primary"][0]["State"].update(
                Restarting=True)),
            ("primary-never-started", lambda d: d["primary"][0]["State"].update(
                StartedAt="0001-01-01T00:00:00Z")),
            ("server-stopped", lambda d: d["server"][0]["State"].update(
                Running=False, Status="exited")),
            ("server-unhealthy", lambda d: d["server"][0]["State"]["Health"].update(
                Status="unhealthy")),
            ("rescue-unhealthy", lambda d: d["rescue"][0]["State"]["Health"].update(
                Status="unhealthy")),
            ("cross-project", lambda d: d["server"][0]["Config"]["Labels"].update(
                **{"com.docker.compose.project": "different-project"})),
            ("unexpected-host-mount", lambda d: d["rescue"][0].update(
                Mounts=[{"Type": "bind", "Destination": "/config"}])),
            ("leaked-secret", lambda d: d["rescue"][0]["Config"]["Env"].append(
                "ALIYUN_ACCESS_KEY_SECRET=NEVER_PRINT_THIS_SECRET")),
        )
        for name, mutate in attacks:
            value = copy.deepcopy(base)
            mutate(value)
            run_case("primary-down", value, False)
            print("reject unsafe phase fixture:", name)
        run_case("not-a-phase", base, False)
        run_case("primary-down", base, False, allow_anon=True)
        replaced = copy.deepcopy(base["primary"][0])
        replaced["Id"] = "e" * 64
        run_case("primary-down", base, False, change_primary_after=replaced)
        # Expected passing Docker Health.Log timestamp rotation is not a
        # container generation or current-health change.
        normal_log = copy.deepcopy(base["primary"][0])
        normal_log["State"]["Health"]["Log"] = [{
            "ExitCode": 0, "Start": "2026-10-16T15:05:01Z"}]
        run_case("primary-down", base, True, change_primary_after=normal_log)
        # Same container ID does not excuse restarted process generation.
        changed_start = copy.deepcopy(base["primary"][0])
        changed_start["State"]["StartedAt"] = "2026-10-16T15:05:02Z"
        run_case("primary-down", base, False, change_primary_after=changed_start)
        changed_health = copy.deepcopy(base["primary"][0])
        changed_health["State"]["Health"]["Status"] = "healthy"
        run_case("primary-down", base, False, change_primary_after=changed_health)
        print("operator Caddy primary-state witness fixtures passed")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    main()
