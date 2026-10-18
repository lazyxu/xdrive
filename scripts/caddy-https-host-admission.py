#!/usr/bin/env python3
"""C2-B operator-local durable SINGLE-PENDING INTENT fence, NOT Caddy Apply.

An operator explicitly prepares one signed, version-locked request under a
host-owned private state directory. The durable pending entry is ONLY a
fail-closed reservation: it is not a Docker action, host configuration CAS,
nonce expenditure by a future controller, or an Applied Receipt.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys


def sibling(name, path):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(path))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


intent = sibling("xd_caddy_admission_intent", "caddy-https-host-apply-intent-check.py")
host = intent.host
PROTOCOL = "xdrive.caddy.https.host-signed-intent-pending.v1"
DIR_NAME = "caddy-https-admissions"
LOCK_NAME = ".intent.lock"
PENDING_NAME = "pending.json"


class Blocked(Exception):
    pass


def need(value):
    if not value:
        raise Blocked()


def identity(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def private_state_dir(directory, env_file):
    """A single canonical state sibling of the real xDrive config, not a URL/path from UI."""
    need(hasattr(os, "O_DIRECTORY") and hasattr(os, "O_NOFOLLOW"))
    need(isinstance(directory, str) and os.path.isabs(directory)
         and os.path.normpath(directory) == directory
         and os.path.realpath(directory) == directory
         and os.path.basename(directory) == DIR_NAME
         and os.path.basename(os.path.dirname(directory)) == "state")
    # Canonical install layout: <xDrive-home>/config/.env and
    # <xDrive-home>/state/caddy-https-admissions. Never stage inside /config.
    config = os.path.dirname(os.path.abspath(env_file))
    need(os.path.basename(config) == "config"
         and os.path.basename(os.path.abspath(env_file)) == ".env"
         and os.path.dirname(config) == os.path.dirname(os.path.dirname(directory)))
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(directory, flags)
    try:
        st = os.fstat(fd)
        on_path = os.stat(directory, follow_symlinks=False)
        need(identity(st) == identity(on_path)
             and stat.S_ISDIR(st.st_mode) and st.st_uid == os.geteuid()
             and stat.S_IMODE(st.st_mode) == 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def exclusive_private_lock(dirfd):
    need(hasattr(fcntl, "flock"))
    flags = (os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW |
             getattr(os, "O_CLOEXEC", 0))
    fd = os.open(LOCK_NAME, flags, 0o600, dir_fd=dirfd)
    try:
        first = os.fstat(fd)
        current = os.stat(LOCK_NAME, dir_fd=dirfd, follow_symlinks=False)
        need(identity(first) == identity(current)
             and stat.S_ISREG(first.st_mode) and first.st_uid == os.geteuid()
             and stat.S_IMODE(first.st_mode) == 0o600
             and first.st_nlink == 1 and first.st_size == 0)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(identity(os.fstat(fd)) == identity(
            os.stat(LOCK_NAME, dir_fd=dirfd, follow_symlinks=False)))
        return fd
    except BaseException:
        os.close(fd)
        raise


def no_previous_pending(dirfd):
    # A leftover partial write after power loss is intentionally sticky;
    # never overwrite, truncate, resume, auto-expire or delete it.
    try:
        os.stat(PENDING_NAME, dir_fd=dirfd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise Blocked()


def durable_pending(dirfd, record):
    """O_EXCL + fsync file/directory; no unlink on incomplete durability."""
    payload = (json.dumps(record, ensure_ascii=True, sort_keys=True,
                          separators=(",", ":")) + "\n").encode("ascii")
    need(0 < len(payload) <= 4096 and record["apply_supported"] is False)
    flags = (os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
             getattr(os, "O_CLOEXEC", 0))
    fd = os.open(PENDING_NAME, flags, 0o600, dir_fd=dirfd)
    try:
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(payload):
            written = os.write(fd, payload[offset:])
            need(written > 0)
            offset += written
        os.fsync(fd)
        st = os.fstat(fd)
        need(stat.S_ISREG(st.st_mode) and st.st_uid == os.geteuid()
             and stat.S_IMODE(st.st_mode) == 0o600 and st.st_nlink == 1
             and st.st_size == len(payload))
    finally:
        os.close(fd)
    os.fsync(dirfd)


def reserve(plan, env, compose, plan_pin, stage_dir, receipt_pin, manifest,
            signature, public_key, key_pin, admission_dir):
    # This directory intentionally MUST exist before the command. An
    # administrator cannot provision it via Web or a Server API.
    dirfd = private_state_dir(admission_dir, env)
    lockfd = None
    try:
        lockfd = exclusive_private_lock(dirfd)
        no_previous_pending(dirfd)
        # Verify the REAL signed request after acquiring the local host lock,
        # matching a protected stage and expected current env/Compose.
        verified = intent.verify(plan, env, compose, plan_pin, stage_dir,
                                 receipt_pin, manifest, signature, public_key,
                                 key_pin)
        need(verified["state"] == "signed-apply-intent-inspected-unapplied"
             and verified["apply_supported"] is False)
        signed = host.regular_snapshot(manifest, 8192, True)
        request = intent.parse_intent(signed[0])
        need(host.fingerprint(signed[0]) == verified["apply_intent_sha256"])
        record = {
            "protocol": PROTOCOL,
            "state": "signed-intent-pending-unapplied",
            "apply_supported": False,
            "operation_sha256": hashlib.sha256(
                request["operation_uuid"].encode("ascii")).hexdigest(),
            "nonce_sha256": hashlib.sha256(
                request["nonce"].encode("ascii")).hexdigest(),
            "intent_sha256": verified["apply_intent_sha256"],
            "desired_revision": verified["desired_revision"],
            "credential_revision": verified["credential_revision"],
            "plan_sha256": plan_pin,
            "stage_receipt_sha256": receipt_pin,
            "host_environment_sha256": request["host_environment_sha256"],
            "host_compose_sha256": request["host_compose_sha256"],
            "candidate_environment_sha256": request["candidate_environment_sha256"],
            "blockers": [
                "no-durable-db-revision-cas-or-apply-controller",
                "independent-rescue-physical-proof-not-accepted",
                "no-operator-secret-handoff-or-watchdog-rollback",
                "no-host-apply-or-signed-applied-receipt",
                "operator-reconciliation-required-before-new-intent",
            ],
        }
        no_previous_pending(dirfd)
        durable_pending(dirfd, record)
        # A post-reservation mismatch remains BLOCKED and leaves the pending
        # file in place; never auto-unlock or produce a success receipt.
        need(host.same_snapshot(manifest, signed, 8192, True))
        current = intent.verify(plan, env, compose, plan_pin, stage_dir,
                                receipt_pin, manifest, signature, public_key,
                                key_pin)
        need(current == verified)
        st_dir = os.fstat(dirfd)
        need(identity(st_dir) == identity(
            os.stat(admission_dir, follow_symlinks=False)))
        return {
            "protocol": PROTOCOL,
            "state": record["state"],
            "apply_supported": False,
            "intent_sha256": record["intent_sha256"],
            "desired_revision": record["desired_revision"],
            "credential_revision": record["credential_revision"],
            "blockers": record["blockers"],
        }
    finally:
        if lockfd is not None:
            os.close(lockfd)
        os.close(dirfd)


def main():
    parser = argparse.ArgumentParser()
    for name in (
        "plan", "env-file", "compose-file", "expected-plan-sha256",
        "staging-dir", "expected-stage-receipt-sha256",
        "apply-intent-manifest", "apply-intent-signature",
        "operator-public-key", "expected-operator-key-der-sha256",
        "admission-dir",
    ):
        parser.add_argument("--" + name, required=True)
    a = parser.parse_args()
    try:
        result = reserve(
            a.plan, a.env_file, a.compose_file, a.expected_plan_sha256,
            a.staging_dir, a.expected_stage_receipt_sha256,
            a.apply_intent_manifest, a.apply_intent_signature,
            a.operator_public_key, a.expected_operator_key_der_sha256,
            a.admission_dir)
    except (Blocked, intent.Blocked, intent.stage.Blocked, intent.stage.stage.Blocked,
            host.Blocked, intent.signing.Blocked, OSError, ValueError, TypeError,
            KeyError, OverflowError, AttributeError):
        print(json.dumps({"protocol": PROTOCOL, "state": "blocked",
                          "apply_supported": False,
                          "reason": "unsafe-stale-replayed-or-pending-intent"},
                         sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
