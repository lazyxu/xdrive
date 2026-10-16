#!/usr/bin/env python3
"""One operator-invoked local time-window bind of signed approval and Rescue.

Reads ONLY fixed Docker metadata, existing read-only phase witness, and an
offline pinned Ed25519 operator approval. No mutation, remote SSH or token.
A local success NEVER authorizes Caddy Apply/Stop/Restart or public TLS.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

STAGES = ("before", "primary-down", "restored")
CONTAINERS = ("xdrive-caddy", "xdrive-server", "xdrive-caddy-rescue")
OCI = re.compile(r"[a-z0-9][a-z0-9./:_-]{2,180}@sha256:[a-f0-9]{64}")


class Blocked(Exception):
    pass


def need(ok, reason):
    if not ok:
        raise Blocked(reason)


def bounded_run(args, maximum=8192, seconds=90):
    try:
        run = subprocess.run(
            args, stdin=subprocess.DEVNULL, capture_output=True,
            timeout=seconds, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Read-only local verification unavailable") from None
    # stdout/stderr may include deployment env or errors: NEVER display them.
    need(run.returncode == 0 and len(run.stdout) <= maximum,
         "One required read-only check failed")
    return run.stdout


def file_hash(path, maximum):
    try:
        info = os.lstat(path)
        need(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= maximum,
             "Approval material must be a small regular file")
        raw = Path(path).read_bytes()
    except OSError:
        raise Blocked("Operator approval input unreadable") from None
    need(len(raw) == info.st_size, "Approval material changed while reading")
    return hashlib.sha256(raw).digest()


def docker_json(*args):
    data = bounded_run(["docker", *args], maximum=262144, seconds=12)
    try:
        return json.loads(data)
    except (ValueError, UnicodeError):
        raise Blocked("Docker read-only observation malformed") from None


def generation():
    identity = []
    for name in CONTAINERS:
        rows = docker_json("inspect", "--type", "container", name)
        need(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict),
             "Fixed container is absent or ambiguous")
        obj = rows[0]
        st = obj.get("State")
        cfg = obj.get("Config")
        need(obj.get("Name") == "/" + name and isinstance(st, dict)
             and isinstance(cfg, dict) and isinstance(cfg.get("Labels"), dict),
             "Fixed container identity could not be verified")
        identity.append((
            obj.get("Id"), obj.get("Image"),
            cfg["Labels"].get("com.docker.compose.project"),
            cfg["Labels"].get("com.docker.compose.service"),
            st.get("StartedAt"), st.get("FinishedAt"), st.get("Running"),
            st.get("Restarting"), st.get("Status"),
            (st.get("Health") or {}).get("Status"),
        ))
    return tuple(identity)


def expected_image(env, compose, expected):
    config = docker_json(
        "compose", "--env-file", str(env), "-f", str(compose),
        "--profile", "caddy-rescue", "config", "--format", "json",
    )
    service = (config.get("services") or {}).get("caddy-rescue") if isinstance(config, dict) else None
    need(isinstance(service, dict) and service.get("profiles") == ["caddy-rescue"]
         and service.get("image") == expected,
         "Operator approved reference differs from current Compose rescue image")


def helper(script, *args):
    script_path = Path(__file__).with_name(script)
    need(script_path.is_file(), "Trusted operator check not installed")
    output = bounded_run(
        [sys.executable, str(script_path), *map(str, args)],
        maximum=8192, seconds=95,
    )
    return output.decode("ascii", errors="replace")


def check():
    need(len(sys.argv) == 9 and sys.argv[1] in STAGES,
         "Usage: approved-runtime-check before|primary-down|restored ENV COMPOSE MANIFEST SIGNATURE PUBKEY PINNED_DER_SHA256 EXPECTED_IMAGE")
    phase = sys.argv[1]
    env, compose, manifest, signature, pubkey, fingerprint, expected = sys.argv[2:]
    need(bool(OCI.fullmatch(expected)) and ".." not in expected,
         "Expected operator-approved image must be an immutable digest")
    need(Path(env).is_file() and Path(compose).is_file(),
         "Trusted deployment config files unavailable")
    approval_inputs = ((manifest, 8192), (signature, 64), (pubkey, 8192))
    hashes = [file_hash(path, bound) for path, bound in approval_inputs]

    gen_before = generation()
    expected_image(env, compose, expected)

    local_before = helper(
        "caddy-rescue-primary-state-witness.py", phase, env, compose,
    )
    need("primary-caddy-observed-phase: " + phase in local_before
         and "server-and-rescue-same-project: healthy" in local_before
         and "public-https-and-caddy-apply-rollback: blocked" in local_before,
         "Current read-only phase witness incomplete")

    approved = helper(
        "caddy-rescue-image-approval-check.py",
        manifest, signature, pubkey, fingerprint, expected,
    )
    need("operator-pinned-ed25519-approval: verified-offline" in approved
         and "immutable-rescue-image: matched-signed-expected-reference" in approved
         and "deployed-rescue-image: unverified" in approved
         and "caddy-apply-stop-restart: blocked" in approved,
         "Operator signing approval missing or unsupported")

    local_after = helper(
        "caddy-rescue-primary-state-witness.py", phase, env, compose,
    )
    need("primary-caddy-observed-phase: " + phase in local_after
         and "server-and-rescue-same-project: healthy" in local_after,
         "Post-signature local phase witness incomplete")

    expected_image(env, compose, expected)
    need(gen_before == generation(),
         "Container process generation or current state changed during approval window")
    need(hashes == [file_hash(path, bound) for path, bound in approval_inputs],
         "Signed approval file or trust root changed during observation")
    print("approved-rescue-runtime-local-phase: " + phase)
    print("operator-pinned-signature-and-deployed-image: matched-within-same-local-window")
    print("server-rescue-current-generation: consistent-local")
    print("operator-out-of-band-ssh-during-primary-outage: unverified")
    print("cross-phase-incident-and-image-publisher-provenance: unverified")
    print("public-https-restore-and-caddy-apply-rollback: blocked")


if __name__ == "__main__":
    try:
        check()
    except Blocked as problem:
        print("rescue-approved-runtime-check: blocked (" + str(problem) + ")",
              file=sys.stderr)
        sys.exit(1)
