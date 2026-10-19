#!/usr/bin/env python3
"""NET-M5-C2-H: protected ORIGINAL Caddy config restore rehearsal, NEVER live Apply.

Only copies verified private originals to a new private sibling directory. The
current .env/Compose, Docker, Caddy, DNS, credentials, and trust store are NEVER
modified by this tool. This is not an apply permission or rollback executor.
"""
import argparse
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys


def sibling(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


verified = sibling("xd_caddy_rehearsal_verify", "caddy-https-host-rollback-anchor-verify.py")
anchor = verified.anchor
pending = verified.pending
admission = verified.admission
host = verified.host

PROTOCOL = "xdrive.caddy.https.host-restore-rehearsal.v1"
DIRECTORY = "rollback-rehearsal"
RECOVERED_ENV = "recovered.env"
RECOVERED_COMPOSE = "recovered.compose"
REPORT = "report.json"
FILES = frozenset((RECOVERED_ENV, RECOVERED_COMPOSE, REPORT))


class Blocked(Exception):
    pass


def need(value):
    if not value:
        raise Blocked()


def private_dir(parent, name):
    need(name in (anchor.FOLDER, DIRECTORY))
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW |
                 getattr(os, "O_CLOEXEC", 0), dir_fd=parent)
    st = os.fstat(fd)
    try:
        need(stat.S_ISDIR(st.st_mode) and st.st_uid == os.geteuid() and
             stat.S_IMODE(st.st_mode) == 0o700 and
             anchor.identity(st) == anchor.identity(
                 os.stat(name, dir_fd=parent, follow_symlinks=False)))
    except BaseException:
        os.close(fd)
        raise
    return fd, anchor.identity(st)


def read_recovered(dirfd, name, limit):
    need(name in FILES)
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                 getattr(os, "O_CLOEXEC", 0), dir_fd=dirfd)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid()
             and stat.S_IMODE(before.st_mode) == 0o600 and
             before.st_nlink == 1 and 0 < before.st_size <= limit)
        chunks = bytearray()
        while len(chunks) <= limit:
            part = os.read(fd, min(65536, limit + 1 - len(chunks)))
            if not part:
                break
            chunks.extend(part)
        need(len(chunks) == before.st_size and
             anchor.identity(before) == anchor.identity(os.fstat(fd)) ==
             anchor.identity(os.stat(name, dir_fd=dirfd,
                                     follow_symlinks=False)))
        return bytes(chunks)
    finally:
        os.close(fd)


def write_recovered(dirfd, name, data):
    need(name in FILES and type(data) is bytes and 0 < len(data) <= 262144)
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
                 getattr(os, "O_CLOEXEC", 0), 0o600, dir_fd=dirfd)
    try:
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(data):
            written = os.write(fd, data[offset:])
            need(written > 0)
            offset += written
        os.fsync(fd)
    finally:
        os.close(fd)
    need(hmac.compare_digest(read_recovered(dirfd, name, len(data)), data))


def rehearse(plan, env, compose, plan_pin, stage_dir, stage_pin,
             manifest, signature, key, key_pin, admission_dir,
             pending_pin, anchor_pin):
    need(verified.is_digest(pending_pin) and verified.is_digest(anchor_pin))
    common = (plan, env, compose, plan_pin, stage_dir, stage_pin,
              manifest, signature, key, key_pin, admission_dir, pending_pin,
              anchor_pin)
    first = verified.inspect(*common)
    need(first["state"] == "host-rollback-anchor-reverified-unapplied" and
         first["apply_supported"] is False and
         hmac.compare_digest(first["receipt_sha256"], anchor_pin))
    statefd = admission.private_state_dir(admission_dir, env)
    lockfd = None
    originalfd = None
    outputfd = None
    try:
        raw_lock, lock_stamp, lockfd = pending.fixed_private_entry(
            statefd, admission.LOCK_NAME, 0, empty=True)
        need(raw_lock == b"")
        fcntl.flock(lockfd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        originalfd, original_stamp = private_dir(statefd, anchor.FOLDER)
        need(sorted(os.listdir(originalfd)) == sorted((
             anchor.ORIGINAL_ENV, anchor.ORIGINAL_COMPOSE, anchor.RECEIPT)))
        raw_env, env_stamp = verified.private_copy(
            originalfd, anchor.ORIGINAL_ENV, 131072)
        raw_compose, compose_stamp = verified.private_copy(
            originalfd, anchor.ORIGINAL_COMPOSE, 262144)
        raw_receipt, receipt_stamp = verified.private_copy(
            originalfd, anchor.RECEIPT, 4096)
        receipt = verified.parse_receipt(raw_receipt)
        need(hmac.compare_digest(hashlib.sha256(raw_receipt).hexdigest(), anchor_pin))
        need(hmac.compare_digest(hashlib.sha256(raw_env).hexdigest(),
                                 first["original_environment_sha256"]))
        need(hmac.compare_digest(hashlib.sha256(raw_compose).hexdigest(),
                                 first["original_compose_sha256"]))
        need(receipt["desired_revision"] == first["desired_revision"] and
             receipt["credential_revision"] == first["credential_revision"])
        live_env = host.regular_snapshot(env, 131072, True)
        live_compose = host.regular_snapshot(compose, 262144)
        need(hmac.compare_digest(raw_env, live_env[0]) and
             hmac.compare_digest(raw_compose, live_compose[0]))
        need(verified.inspect(*common) == first)

        # Exclusive CREATE, no replacement/deletion. A partial rehearsal is
        # permanent evidence to reconcile manually, not silently retried.
        os.mkdir(DIRECTORY, mode=0o700, dir_fd=statefd)
        outputfd, output_stamp = private_dir(statefd, DIRECTORY)
        os.fsync(statefd)
        write_recovered(outputfd, RECOVERED_ENV, raw_env)
        write_recovered(outputfd, RECOVERED_COMPOSE, raw_compose)
        result = {
            "protocol": PROTOCOL,
            "state": "private-original-restore-rehearsed-unapplied",
            "apply_supported": False,
            "anchor_receipt_sha256": anchor_pin,
            "pending_sha256": pending_pin,
            "original_environment_sha256": first["original_environment_sha256"],
            "original_compose_sha256": first["original_compose_sha256"],
            "desired_revision": first["desired_revision"],
            "credential_revision": first["credential_revision"],
            "blockers": anchor.BLOCKERS,
        }
        report = (json.dumps(result, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=True) + "\n").encode("ascii")
        need(len(report) <= 4096)
        write_recovered(outputfd, REPORT, report)
        os.fsync(outputfd)
        os.fsync(statefd)
        need(sorted(os.listdir(outputfd)) == sorted(FILES))
        need(read_recovered(outputfd, RECOVERED_ENV, 131072) == raw_env and
             read_recovered(outputfd, RECOVERED_COMPOSE, 262144) == raw_compose and
             read_recovered(outputfd, REPORT, 4096) == report)
        for name, old in (
            (anchor.ORIGINAL_ENV, (raw_env, env_stamp)),
            (anchor.ORIGINAL_COMPOSE, (raw_compose, compose_stamp)),
            (anchor.RECEIPT, (raw_receipt, receipt_stamp)),
        ):
            need(verified.private_copy(
                originalfd, name, 131072 if name == anchor.ORIGINAL_ENV else
                262144 if name == anchor.ORIGINAL_COMPOSE else 4096) == old)
        need(anchor.identity(os.fstat(originalfd)) == original_stamp ==
             anchor.identity(os.stat(anchor.FOLDER, dir_fd=statefd,
                                     follow_symlinks=False)))
        final_output_stamp = anchor.identity(os.fstat(outputfd))
        need(final_output_stamp[:5] == output_stamp[:5] and
             final_output_stamp == anchor.identity(
                 os.stat(DIRECTORY, dir_fd=statefd, follow_symlinks=False)))
        need(pending.identity(os.fstat(lockfd)) == lock_stamp ==
             pending.identity(os.stat(admission.LOCK_NAME, dir_fd=statefd,
                                      follow_symlinks=False)))
        need(host.same_snapshot(env, live_env, 131072, True) and
             host.same_snapshot(compose, live_compose, 262144))
        need(verified.inspect(*common) == first)
        return result
    finally:
        if outputfd is not None:
            os.close(outputfd)
        if originalfd is not None:
            os.close(originalfd)
        if lockfd is not None:
            os.close(lockfd)
        os.close(statefd)


def main():
    ap = argparse.ArgumentParser()
    for key in ("plan", "env-file", "compose-file", "expected-plan-sha256",
                "staging-dir", "expected-stage-receipt-sha256",
                "apply-intent-manifest", "apply-intent-signature",
                "operator-public-key", "expected-operator-key-der-sha256",
                "admission-dir", "expected-pending-sha256",
                "expected-anchor-receipt-sha256"):
        ap.add_argument("--" + key, required=True)
    a = ap.parse_args()
    try:
        value = rehearse(
            a.plan, a.env_file, a.compose_file, a.expected_plan_sha256,
            a.staging_dir, a.expected_stage_receipt_sha256,
            a.apply_intent_manifest, a.apply_intent_signature,
            a.operator_public_key, a.expected_operator_key_der_sha256,
            a.admission_dir, a.expected_pending_sha256,
            a.expected_anchor_receipt_sha256,
        )
    except (Blocked, verified.Blocked, anchor.Blocked, pending.Blocked,
            admission.Blocked, anchor.intent.Blocked,
            anchor.intent.stage.Blocked, anchor.intent.stage.stage.Blocked,
            host.Blocked, anchor.intent.signing.Blocked,
            OSError, ValueError, TypeError, KeyError, AttributeError,
            UnicodeError, OverflowError):
        print(json.dumps({
            "protocol": PROTOCOL, "state": "blocked",
            "apply_supported": False,
            "reason": "untrusted-or-existing-private-rehearsal",
        }, sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(value, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
