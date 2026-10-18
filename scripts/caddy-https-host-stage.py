#!/usr/bin/env python3
"""Operator-local Caddy .env candidate STAGING, never a live Host Apply.

This is a deliberately separate entry point from caddy-https-host-plan.py:
the read-only planner must remain write-free. This script writes only into
an existing owner-private state/caddy-https-staging directory, not .env or
Compose, Caddy, Docker, DNS, credential stores or system CA trust.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

HOST_SOURCE = Path(__file__).with_name("caddy-https-host-plan.py")
spec = importlib.util.spec_from_file_location("xdrive_caddy_host_plan", HOST_SOURCE)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

STAGE_PROTOCOL = "xdrive.caddy.https.host-stage.v1"
DENIED_CHANGE_BLOCKERS = frozenset({
    "legacy-deployment", "https-bind-migration-required",
    "existing-ingress-at-risk", "alidns-secret-host-handoff-required",
})


class Blocked(Exception):
    pass


def require(test):
    if not test:
        raise Blocked()


def private_stage_directory(path, env_file):
    # Host-only operator path, never passed through a Server/Renderer API.
    # Do not stage into the live config directory or a symlinked location.
    require(os.path.isabs(path) and os.path.normpath(path) == path)
    require(os.path.realpath(path) == path)
    require(os.path.basename(path) == "caddy-https-staging")
    require(os.path.basename(os.path.dirname(path)) == "state")
    config_dir = os.path.realpath(os.path.dirname(env_file))
    require(os.path.commonpath([config_dir, path]) != config_dir)
    require(hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY"))
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(path, flags)
    try:
        s = os.fstat(fd)
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid())
        require(stat.S_IMODE(s.st_mode) == 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_new_private(dirfd, name, data):
    require(isinstance(data, bytes) and 0 < len(data) <= 131072)
    require(name.startswith(("candidate-", "receipt-")) and "/" not in name)
    flags = (os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
             getattr(os, "O_CLOEXEC", 0))
    fd = os.open(name, flags, 0o600, dir_fd=dirfd)
    completed = False
    try:
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(data):
            written = os.write(fd, data[offset:])
            require(written > 0)
            offset += written
        os.fsync(fd)
        completed = True
    finally:
        os.close(fd)
        if not completed:
            try:
                os.unlink(name, dir_fd=dirfd)
            except OSError:
                pass


def stage(plan_path, env_path, compose_path, pinned_sha256, staging_dir):
    require(bool(host.HEXDIGEST.fullmatch(pinned_sha256)))
    # First complete the existing independent-pinned no-write preflight.
    observed = host.preview(plan_path, env_path, compose_path, pinned_sha256)
    require(observed["protocol"] == host.PROTOCOL and
            observed["apply_supported"] is False)
    require(observed.get("candidate_environment_sha256") is not None)
    require(not DENIED_CHANGE_BLOCKERS.intersection(observed["blockers"]))

    plan = host.regular_snapshot(plan_path, 4096, True)
    env = host.regular_snapshot(env_path, 131072, True)
    compose = host.regular_snapshot(compose_path, 262144, False)
    require(host.fingerprint(plan[0]) == pinned_sha256)
    require(host.fingerprint(env[0]) == observed["host_environment_sha256"])
    require(host.fingerprint(compose[0]) == observed["host_compose_sha256"])
    parsed = host.validate_plan(plan[0])
    host.validate_compose(compose[0])
    host.validate_env(env[0])
    candidate = host.render_candidate_env(parsed, env[0])
    candidate_hash = host.fingerprint(candidate)
    require(candidate_hash == observed["candidate_environment_sha256"])
    inputs = [(plan_path, plan, 4096, True),
              (env_path, env, 131072, True),
              (compose_path, compose, 262144, False)]

    stage_id = hashlib.sha256(plan[0] + b"\x00" + env[0] + b"\x00" +
                              compose[0]).hexdigest()
    candidate_name = "candidate-" + stage_id + ".env"
    receipt_name = "receipt-" + stage_id + ".json"
    receipt = {
        "protocol": STAGE_PROTOCOL,
        "state": "candidate-staged-unapplied",
        "apply_supported": False,
        "desired_revision": parsed["desired_revision"],
        "credential_revision": parsed["credential_revision"],
        "plan_sha256": pinned_sha256,
        "host_environment_sha256": observed["host_environment_sha256"],
        "host_compose_sha256": observed["host_compose_sha256"],
        "candidate_environment_sha256": candidate_hash,
        "blockers": sorted(set(observed["blockers"] + [
            "operator-rescue-not-independently-accepted",
            "live-host-cas-and-rollback-not-authorized",
        ])),
    }
    receipt_data = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) +
                    "\n").encode("ascii")
    # Staging is a privileged explicit operator action. No live mutation.
    fd = private_stage_directory(staging_dir, env_path)
    created = []
    try:
        require(all(host.same_snapshot(path, snap, limit, secret)
                    for path, snap, limit, secret in inputs))
        write_new_private(fd, candidate_name, candidate)
        created.append(candidate_name)
        require(all(host.same_snapshot(path, snap, limit, secret)
                    for path, snap, limit, secret in inputs))
        write_new_private(fd, receipt_name, receipt_data)
        created.append(receipt_name)
        os.fsync(fd)
        require(all(host.same_snapshot(path, snap, limit, secret)
                    for path, snap, limit, secret in inputs))
    except BaseException:
        for name in reversed(created):
            try:
                os.unlink(name, dir_fd=fd)
            except OSError:
                pass
        try:
            os.fsync(fd)
        except OSError:
            pass
        raise
    finally:
        os.close(fd)
    # Never output filenames, raw target domain/IP, secret-bearing .env,
    # CA content, a fake applied receipt or Apply/Restart permission.
    return {
        "protocol": STAGE_PROTOCOL,
        "state": "candidate-staged-unapplied",
        "apply_supported": False,
        "candidate_environment_sha256": candidate_hash,
        "stage_receipt_sha256": host.fingerprint(receipt_data),
        "blockers": receipt["blockers"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--expected-plan-sha256", required=True)
    parser.add_argument("--staging-dir", required=True)
    args = parser.parse_args()
    try:
        result = stage(args.plan, args.env_file, args.compose_file,
                       args.expected_plan_sha256, args.staging_dir)
    except (Blocked, host.Blocked, OSError, ValueError, TypeError):
        print(json.dumps({"protocol": STAGE_PROTOCOL, "state": "blocked",
                          "apply_supported": False,
                          "reason": "unsafe-or-changing-stage-input"}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
