#!/usr/bin/env python3
"""C2-D: one PRIVATE original-config rollback anchor; never Host Apply/Restart."""
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

def sibling(label, filename):
    spec = importlib.util.spec_from_file_location(
        label, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

pending = sibling("xd_caddy_anchor_pending", "caddy-https-host-pending-verify.py")
admission = pending.admission
intent = pending.intent
host = pending.host
PROTOCOL = "xdrive.caddy.https.host-rollback-anchor.v1"
FOLDER = "rollback-anchor"
ORIGINAL_ENV = "original.env"
ORIGINAL_COMPOSE = "original.compose"
RECEIPT = "receipt.json"
BLOCKERS = [
    "host-db-cas-and-nonce-consumption-not-implemented",
    "physical-independent-rescue-not-approved",
    "protected-alidns-secret-handoff-not-implemented",
    "bounded-caddy-restart-and-detached-watchdog-not-implemented",
    "remote-enabled-and-disabled-origin-verification-required",
    "immutable-signed-applied-receipt-not-implemented",
    "operator-audited-recovery-required",
]

class Blocked(Exception):
    pass

def need(value):
    if not value:
        raise Blocked()

def identity(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_nlink,
            st.st_size, st.st_mtime_ns, st.st_ctime_ns)

def persist_file(dirfd, name, content):
    need(name in (ORIGINAL_ENV, ORIGINAL_COMPOSE, RECEIPT))
    need(type(content) is bytes and 0 < len(content) <= 262144)
    flags = (os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |
             getattr(os, "O_CLOEXEC", 0))
    fd = os.open(name, flags, 0o600, dir_fd=dirfd)
    try:
        os.fchmod(fd, 0o600)
        index = 0
        while index < len(content):
            wrote = os.write(fd, content[index:])
            need(wrote > 0)
            index += wrote
        os.fsync(fd)
        st = os.fstat(fd)
        current = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        need(identity(st) == identity(current) and
             stat.S_ISREG(st.st_mode) and st.st_uid == os.geteuid() and
             stat.S_IMODE(st.st_mode) == 0o600 and
             st.st_nlink == 1 and st.st_size == len(content))
    finally:
        os.close(fd)

def verify_copy(dirfd, name, content):
    need(name in (ORIGINAL_ENV, ORIGINAL_COMPOSE, RECEIPT))
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                 getattr(os, "O_CLOEXEC", 0), dir_fd=dirfd)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and
             stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1 and
             before.st_size == len(content))
        raw = bytearray()
        while len(raw) <= len(content):
            part = os.read(fd, min(65536, len(content) + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
        after = os.fstat(fd)
        path_stat = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        need(identity(before) == identity(after) == identity(path_stat)
             and len(raw) == len(content) and hmac.compare_digest(raw, content))
    finally:
        os.close(fd)

def prepare(plan, env, compose, plan_pin, stage_dir, stage_pin,
            manifest, signature, public_key, key_pin, admission_dir, pending_pin):
    need(type(pending_pin) is str and bool(host.HEXDIGEST.fullmatch(pending_pin)))
    # First independently inspect the operator-pinned pending as pure read-only.
    checked = pending.inspect(plan, env, compose, plan_pin, stage_dir,
        stage_pin, manifest, signature, public_key, key_pin,
        admission_dir, pending_pin)
    need(checked["state"] == "signed-intent-pending-reverified-unapplied" and
         checked["apply_supported"] is False)
    dirfd = admission.private_state_dir(admission_dir, env)
    lockfd = None
    backupfd = None
    try:
        # Exclusive single-host lock for ALL revalidation and backups.
        lockfd = admission.exclusive_private_lock(dirfd)
        initial, pending_stamp = pending.pending_snapshot(dirfd)
        need(hmac.compare_digest(hashlib.sha256(initial).hexdigest(), pending_pin))
        record = pending.parse_pending(initial)
        verified = intent.verify(plan, env, compose, plan_pin, stage_dir,
                                 stage_pin, manifest, signature, public_key, key_pin)
        need(verified["state"] == "signed-apply-intent-inspected-unapplied" and
             verified["apply_supported"] is False)
        signed_snap = host.regular_snapshot(manifest, 8192, True)
        signed = intent.parse_intent(signed_snap[0])
        need(host.fingerprint(signed_snap[0]) == verified["apply_intent_sha256"])
        pending.compare_to_signed(record, signed, verified, plan_pin, stage_pin)
        existing_env = host.regular_snapshot(env, 131072, True)
        existing_compose = host.regular_snapshot(compose, 262144)
        need(hmac.compare_digest(host.fingerprint(existing_env[0]),
                                 record["host_environment_sha256"]))
        need(hmac.compare_digest(host.fingerprint(existing_compose[0]),
                                 record["host_compose_sha256"]))
        host.validate_env(existing_env[0])
        host.validate_compose(existing_compose[0])
        result = {
            "protocol": PROTOCOL,
            "state": "host-rollback-anchor-prepared-unapplied",
            "apply_supported": False,
            "pending_sha256": pending_pin,
            "intent_sha256": record["intent_sha256"],
            "operation_sha256": record["operation_sha256"],
            "desired_revision": record["desired_revision"],
            "credential_revision": record["credential_revision"],
            "original_environment_sha256": host.fingerprint(existing_env[0]),
            "original_compose_sha256": host.fingerprint(existing_compose[0]),
            "candidate_environment_sha256": record["candidate_environment_sha256"],
            "blockers": BLOCKERS,
        }
        payload = (json.dumps(result, sort_keys=True, separators=(",", ":"),
                              ensure_ascii=True) + "\n").encode("ascii")
        need(0 < len(payload) <= 4096)
        # A pre-existing symlink/partial/old anchor fails closed. No cleanup.
        os.mkdir(FOLDER, mode=0o700, dir_fd=dirfd)
        backupfd = os.open(FOLDER, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW |
                           getattr(os, "O_CLOEXEC", 0), dir_fd=dirfd)
        before_dir = os.fstat(backupfd)
        need(stat.S_ISDIR(before_dir.st_mode) and
             before_dir.st_uid == os.geteuid() and
             stat.S_IMODE(before_dir.st_mode) == 0o700 and
             identity(before_dir) == identity(
                 os.stat(FOLDER, dir_fd=dirfd, follow_symlinks=False)))
        os.fsync(dirfd)
        persist_file(backupfd, ORIGINAL_ENV, existing_env[0])
        persist_file(backupfd, ORIGINAL_COMPOSE, existing_compose[0])
        persist_file(backupfd, RECEIPT, payload)
        os.fsync(backupfd)
        os.fsync(dirfd)
        # All proof and source bytes must STILL be identical after persistence.
        need(host.same_snapshot(env, existing_env, 131072, True))
        need(host.same_snapshot(compose, existing_compose, 262144))
        need(host.same_snapshot(manifest, signed_snap, 8192, True))
        need(intent.verify(plan, env, compose, plan_pin, stage_dir, stage_pin,
                           manifest, signature, public_key, key_pin) == verified)
        need(pending.pending_snapshot(dirfd) == (initial, pending_stamp))
        need(pending.identity(os.fstat(dirfd)) == pending.identity(
             os.stat(admission_dir, follow_symlinks=False)))
        need(pending.identity(os.fstat(lockfd)) == pending.identity(
             os.stat(admission.LOCK_NAME, dir_fd=dirfd, follow_symlinks=False)))
        need(identity(os.fstat(backupfd)) == identity(
             os.stat(FOLDER, dir_fd=dirfd, follow_symlinks=False)))
        for name, original in ((ORIGINAL_ENV, existing_env[0]),
                               (ORIGINAL_COMPOSE, existing_compose[0]),
                               (RECEIPT, payload)):
            verify_copy(backupfd, name, original)
        return {
            "protocol": PROTOCOL, "state": result["state"],
            "apply_supported": False,
            "receipt_sha256": hashlib.sha256(payload).hexdigest(),
            "pending_sha256": pending_pin,
            "original_environment_sha256": result["original_environment_sha256"],
            "original_compose_sha256": result["original_compose_sha256"],
            "desired_revision": result["desired_revision"],
            "credential_revision": result["credential_revision"],
            "blockers": BLOCKERS,
        }
    finally:
        if backupfd is not None:
            os.close(backupfd)
        if lockfd is not None:
            os.close(lockfd)
        os.close(dirfd)

def main():
    ap = argparse.ArgumentParser()
    for name in ("plan", "env-file", "compose-file", "expected-plan-sha256",
                 "staging-dir", "expected-stage-receipt-sha256",
                 "apply-intent-manifest", "apply-intent-signature",
                 "operator-public-key", "expected-operator-key-der-sha256",
                 "admission-dir", "expected-pending-sha256"):
        ap.add_argument("--" + name, required=True)
    a = ap.parse_args()
    try:
        result = prepare(a.plan, a.env_file, a.compose_file,
                         a.expected_plan_sha256, a.staging_dir,
                         a.expected_stage_receipt_sha256, a.apply_intent_manifest,
                         a.apply_intent_signature, a.operator_public_key,
                         a.expected_operator_key_der_sha256, a.admission_dir,
                         a.expected_pending_sha256)
    except (Blocked, pending.Blocked, admission.Blocked, intent.Blocked,
            intent.stage.Blocked, intent.stage.stage.Blocked, host.Blocked,
            intent.signing.Blocked, OSError, TypeError, ValueError,
            KeyError, UnicodeError, AttributeError, OverflowError):
        print(json.dumps({
            "protocol": PROTOCOL, "state": "blocked", "apply_supported": False,
            "reason": "untrusted-stale-or-existing-rollback-anchor",
        }, sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0

if __name__ == "__main__":
    sys.exit(main())
