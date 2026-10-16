#!/usr/bin/env python3
"""Offline positive/hostile approved-image + Docker-phase observer composition."""
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
from http.server import ThreadingHTTPServer
import threading


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "scripts/caddy-rescue-approved-runtime-check.py"
EXISTING = runpy.run_path(str(ROOT / "scripts/test-caddy-rescue-primary-state-witness.py"))
FAKE_DOCKER = EXISTING["FAKE_DOCKER"]
FIXTURE = EXISTING["fixture"]
HTTP = EXISTING["HTTP"]
REFERENCE = "ghcr.io/lazyxu/xdrive-caddy@sha256:" + "a" * 64
PURPOSE = "xdrive-caddy-rescue-operator-image-approval-v1"


def openssl(*args):
    result = subprocess.run(
        ["openssl", *args], capture_output=True, timeout=12, check=False,
    )
    assert result.returncode == 0, "Synthetic Ed25519 fixture setup failed"
    return result.stdout


def make_approval(root, image=REFERENCE):
    priv, pub = root / "operator-private.pem", root / "operator-public.pem"
    openssl("genpkey", "-algorithm", "ED25519", "-out", str(priv))
    openssl("pkey", "-in", str(priv), "-pubout", "-out", str(pub))
    pub.chmod(0o600)
    der = openssl("pkey", "-pubin", "-in", str(pub), "-outform", "DER")
    fingerprint = hashlib.sha256(der).hexdigest()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    signed = {
        "schema": 1, "scope": PURPOSE, "image": image,
        "issued_at": (now - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    manifest, sig = root / "operator-approval.json", root / "operator.sig"
    manifest.write_bytes(
        (json.dumps(signed, sort_keys=True, ensure_ascii=True,
                    separators=(",", ":")) + "\n").encode("ascii")
    )
    openssl("pkeyutl", "-sign", "-inkey", str(priv), "-rawin",
            "-in", str(manifest), "-out", str(sig))
    return manifest, sig, pub, fingerprint


def run_test(port, stage, change=None, bad_ref=None, wrong_fingerprint=False,
             mutate_signature=False, swapped_primary=False, anonymous_open=False):
    HTTP.allow_anon = anonymous_open
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        fakebin = root / "bin"
        fakebin.mkdir()
        docker = fakebin / "docker"
        docker.write_text(FAKE_DOCKER, encoding="utf-8")
        docker.chmod(0o755)
        fixture = FIXTURE(port, stage)
        if change is not None:
            change(fixture)
        for name, value in fixture.items():
            (root / (name + ".json")).write_text(
                json.dumps(value), encoding="utf-8",
            )
        if swapped_primary:
            after = copy.deepcopy(fixture["primary"][0])
            after["Id"] = "e" * 64
            (root / "primary-after.json").write_text(
                json.dumps([after]), encoding="utf-8",
            )
        envfile, compose = root / ".env", root / "compose.yml"
        envfile.write_text("# fixture-only\n")
        compose.write_text("# fixture-only\n")
        manifest, sig, pub, fingerprint = make_approval(root)
        if wrong_fingerprint:
            fingerprint = "0" * 64
        if mutate_signature:
            raw = sig.read_bytes()
            sig.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
        env = dict(os.environ)
        env["PATH"] = str(fakebin) + os.pathsep + env.get("PATH", "")
        env["XDRIVE_RESCUE_PHASE_FIXTURE"] = str(root)
        ref = REFERENCE if bad_ref is None else bad_ref
        result = subprocess.run([
            sys.executable, str(TARGET), stage, str(envfile), str(compose),
            str(manifest), str(sig), str(pub), fingerprint, ref,
        ], env=env, capture_output=True, text=True, timeout=90, check=False)
        ok = (change is None and bad_ref is None and not wrong_fingerprint
              and not mutate_signature and not swapped_primary
              and not anonymous_open and stage in ("before", "primary-down", "restored"))
        assert (result.returncode == 0) == ok, result.stderr
        if ok:
            assert "approved-rescue-runtime-local-phase: " + stage in result.stdout
            assert "operator-out-of-band-ssh-during-primary-outage: unverified" in result.stdout
            assert "public-https-restore-and-caddy-apply-rollback: blocked" in result.stdout
        else:
            assert "blocked" in result.stderr
            assert "approved-rescue-runtime-local-phase" not in result.stdout
        assert REFERENCE not in result.stdout + result.stderr
        assert fingerprint not in result.stdout + result.stderr
        assert "operator-private" not in result.stdout + result.stderr
        assert "ALIYUN_ACCESS_KEY_SECRET" not in result.stdout + result.stderr


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), HTTP)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        for stage in ("before", "primary-down", "restored"):
            run_test(port, stage)
            print("read-only approved rescue current phase:", stage)
        cases = (
            ("floating-image", lambda f: f["compose"]["services"]["caddy-rescue"].update(
                image="ghcr.io/lazyxu/xdrive-caddy:latest")),
            ("wrong-runtime-image", lambda f: f["image"][0].update(RepoDigests=[])),
            ("unhealthy-rescue", lambda f: f["rescue"][0]["State"]["Health"].update(
                Status="unhealthy")),
            ("unexpected-volume", lambda f: f["rescue"][0].update(
                Mounts=[{"Type": "bind", "Destination": "/config"}])),
            ("leaked-secret", lambda f: f["rescue"][0]["Config"]["Env"].append(
                "ALIYUN_ACCESS_KEY_SECRET=NEVER_PRINT_THIS_SECRET")),
            ("wrong-project", lambda f: f["server"][0]["Config"]["Labels"].update(
                **{"com.docker.compose.project": "another-project"})),
            ("primary-running-in-down", lambda f: f["primary"][0]["State"].update(
                Running=True, Status="running")),
        )
        for title, changed in cases:
            run_test(port, "primary-down", change=changed)
            print("reject incomplete approved-runtime proof:", title)
        run_test(port, "primary-down", wrong_fingerprint=True)
        run_test(port, "primary-down", mutate_signature=True)
        run_test(port, "primary-down", bad_ref="ghcr.io/lazyxu/xdrive-caddy:latest")
        run_test(port, "primary-down", swapped_primary=True)
        run_test(port, "primary-down", anonymous_open=True)
        run_test(port, "invalid-phase")
        print("operator-approved runtime Caddy rescue: fake Docker + real HTTP + Ed25519 passed")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    main()
