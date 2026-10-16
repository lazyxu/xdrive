#!/usr/bin/env python3
"""Offline Ed25519 real signature tests; all keys are ephemeral CI fixtures."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "scripts/caddy-rescue-image-approval-check.py"
IMAGE = "ghcr.io/lazyxu/xdrive-caddy@sha256:" + "a" * 64
SCOPE = "xdrive-caddy-rescue-operator-image-approval-v1"


def crypto(*args):
    r = subprocess.run(["openssl", *args], capture_output=True,
                       timeout=10, check=False)
    assert r.returncode == 0, "Synthetic offline Ed25519 fixture failed"
    return r.stdout


def canonical(obj):
    return (json.dumps(obj, sort_keys=True, ensure_ascii=True,
            separators=(",", ":")) + "\n").encode()


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        private, public = root / "private.pem", root / "public.pem"
        manifest, signature = root / "approval.json", root / "approval.sig"
        crypto("genpkey", "-algorithm", "ED25519", "-out", str(private))
        crypto("pkey", "-in", str(private), "-pubout", "-out", str(public))
        public.chmod(0o600)
        der = crypto("pkey", "-pubin", "-in", str(public), "-outform", "DER")
        fingerprint = hashlib.sha256(der).hexdigest()
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        timefmt = "%Y-%m-%dT%H:%M:%SZ"
        signed = {
            "schema": 1,
            "scope": SCOPE,
            "image": IMAGE,
            "issued_at": (now - dt.timedelta(minutes=1)).strftime(timefmt),
            "expires_at": (now + dt.timedelta(days=1)).strftime(timefmt),
        }

        def run(obj=None, expected=True, raw=None, re_sign=True,
                pinned=None, ref=None, trust=None, signature_mutator=None):
            payload = raw if raw is not None else canonical(signed if obj is None else obj)
            manifest.write_bytes(payload)
            if re_sign:
                crypto("pkeyutl", "-sign", "-inkey", str(private), "-rawin",
                       "-in", str(manifest), "-out", str(signature))
            if signature_mutator:
                data = signature.read_bytes()
                signature.write_bytes(signature_mutator(data))
            r = subprocess.run([
                sys.executable, str(CHECK), str(manifest), str(signature),
                str(public if trust is None else trust),
                fingerprint if pinned is None else pinned,
                IMAGE if ref is None else ref,
            ], capture_output=True, text=True, timeout=12, check=False)
            assert (r.returncode == 0) is expected, (
                "Unexpected operator approval verdict: " + r.stderr)
            if expected:
                assert "operator-pinned-ed25519-approval: verified-offline" in r.stdout
                assert "deployed-rescue-image: unverified" in r.stdout
                assert "caddy-apply-stop-restart: blocked" in r.stdout
            else:
                assert "blocked" in r.stderr
            assert IMAGE not in r.stdout + r.stderr
            assert fingerprint not in r.stdout + r.stderr
            assert "private" not in r.stdout + r.stderr

        run()
        run(pinned="0" * 64, expected=False)
        run(ref="ghcr.io/lazyxu/xdrive-caddy:latest", expected=False)
        run(obj={**signed, "scope": "general-operator-action"}, expected=False)
        run(obj={**signed, "schema": True}, expected=False)
        run(obj={**signed, "extra": "ignored"}, expected=False)
        run(obj={**signed, "image": IMAGE[:-64] + "b" * 64}, expected=False)
        run(obj={**signed, "expires_at":
                 (now - dt.timedelta(seconds=1)).strftime(timefmt)}, expected=False)
        run(obj={**signed, "issued_at":
                 (now + dt.timedelta(days=1)).strftime(timefmt)}, expected=False)
        run(obj={**signed, "expires_at":
                 (now + dt.timedelta(days=40)).strftime(timefmt)}, expected=False)
        raw = json.dumps(signed, indent=2).encode() + b"\n"
        run(raw=raw, expected=False)
        duplicate = canonical(signed).rstrip(b"\n")[:-1] + b',"schema":1}\n'
        run(raw=duplicate, expected=False)
        run(expected=False, signature_mutator=lambda s: bytes([s[0] ^ 1]) + s[1:])
        run(expected=False, signature_mutator=lambda s: s[:24])
        # A signed file must still be rejected when the pinned key is writable
        # by other users or is an unexpected symlink.
        public.chmod(0o666)
        run(expected=False)
        public.chmod(0o600)
        symlink = root / "untrusted-link.pem"
        symlink.symlink_to(public)
        run(expected=False, trust=symlink)
        run()
        print("Caddy rescue offline signed image approval: 16 safety cases passed")


if __name__ == "__main__":
    main()
