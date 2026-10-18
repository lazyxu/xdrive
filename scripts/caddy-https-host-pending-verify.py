#!/usr/bin/env python3
"""C2-C operator-local READ-ONLY verification of a durable pending Caddy intent.

Never changes a live deployment, admission journal, host state, or nonce.
A signed request and pending journal can be internally consistent and STILL
cannot authorize Apply/Restart without physical rescue and a real host CAS.
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


def sibling(name, filename):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


admission = sibling("xd_caddy_pending_admission", "caddy-https-host-admission.py")
intent = admission.intent
host = admission.host
PROTOCOL = "xdrive.caddy.https.host-pending-inspection.v1"
HEXDIGEST = host.HEXDIGEST
FIELDS = frozenset((
    "protocol", "state", "apply_supported", "operation_sha256",
    "nonce_sha256", "intent_sha256", "desired_revision",
    "credential_revision", "plan_sha256", "stage_receipt_sha256",
    "host_environment_sha256", "host_compose_sha256",
    "candidate_environment_sha256", "blockers",
))
BLOCKERS = [
    "no-durable-db-revision-cas-or-apply-controller",
    "independent-rescue-physical-proof-not-accepted",
    "no-operator-secret-handoff-or-watchdog-rollback",
    "no-host-apply-or-signed-applied-receipt",
    "operator-reconciliation-required-before-new-intent",
]


class Blocked(Exception):
    pass


def need(value):
    if not value:
        raise Blocked()


def identity(st):
    return (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_nlink,
            st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def fixed_private_entry(dirfd, name, maxsize, empty=False):
    """Read only existing files through a pinned dirfd, never follow symlinks."""
    need(name in (admission.LOCK_NAME, admission.PENDING_NAME))
    need(hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_NONBLOCK"))
    flags = (os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
             getattr(os, "O_CLOEXEC", 0))
    fd = os.open(name, flags, dir_fd=dirfd)
    try:
        first = os.fstat(fd)
        need(stat.S_ISREG(first.st_mode) and
             first.st_uid == os.geteuid() and
             stat.S_IMODE(first.st_mode) == 0o600 and
             first.st_nlink == 1 and
             (first.st_size == 0 if empty else 0 < first.st_size <= maxsize))
        raw = bytearray()
        while len(raw) <= maxsize:
            piece = os.read(fd, min(4096, maxsize + 1 - len(raw)))
            if not piece:
                break
            raw.extend(piece)
        second = os.fstat(fd)
        current = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        need(identity(first) == identity(second) == identity(current)
             and len(raw) == first.st_size)
        return bytes(raw), identity(first), fd
    except BaseException:
        os.close(fd)
        raise


def pending_snapshot(dirfd):
    data, first, fd = fixed_private_entry(
        dirfd, admission.PENDING_NAME, 4096)
    os.close(fd)
    return data, first


def parse_pending(raw):
    need(isinstance(raw, bytes) and 0 < len(raw) <= 4096)
    try:
        obj = json.loads(
            raw.decode("ascii"), object_pairs_hook=host.no_duplicates,
            parse_float=host.reject_invalid_number,
            parse_constant=host.reject_invalid_number,
        )
    except (ValueError, UnicodeError, host.Blocked):
        raise Blocked() from None
    need(isinstance(obj, dict) and obj.keys() == FIELDS)
    need(raw == (json.dumps(obj, sort_keys=True, separators=(",", ":"),
                            ensure_ascii=True) + "\n").encode("ascii"))
    need(obj["protocol"] == admission.PROTOCOL
         and obj["state"] == "signed-intent-pending-unapplied"
         and obj["apply_supported"] is False and obj["blockers"] == BLOCKERS)
    for field in ("desired_revision", "credential_revision"):
        need(type(obj[field]) is int and 0 <= obj[field] < (1 << 60))
    need(obj["desired_revision"] > 0)
    for field in (
        "operation_sha256", "nonce_sha256", "intent_sha256",
        "plan_sha256", "stage_receipt_sha256",
        "host_environment_sha256", "host_compose_sha256",
        "candidate_environment_sha256",
    ):
        need(type(obj[field]) is str and bool(HEXDIGEST.fullmatch(obj[field])))
    return obj


def compare_to_signed(pending, signed, verified, plan_pin, stage_pin):
    expected = {
        "operation_sha256": hashlib.sha256(
            signed["operation_uuid"].encode("ascii")).hexdigest(),
        "nonce_sha256": hashlib.sha256(
            signed["nonce"].encode("ascii")).hexdigest(),
        "intent_sha256": verified["apply_intent_sha256"],
        "desired_revision": verified["desired_revision"],
        "credential_revision": verified["credential_revision"],
        "plan_sha256": plan_pin,
        "stage_receipt_sha256": stage_pin,
        "host_environment_sha256": signed["host_environment_sha256"],
        "host_compose_sha256": signed["host_compose_sha256"],
        "candidate_environment_sha256": signed["candidate_environment_sha256"],
    }
    for field, right in expected.items():
        left = pending[field]
        need(type(left) is type(right))
        need(hmac.compare_digest(left, right)
             if type(left) is str else left == right)


def inspect(plan, env, compose, plan_pin, stage_dir, stage_pin,
            manifest, signature, public_key, public_key_pin,
            admission_dir, pending_pin):
    need(isinstance(pending_pin, str) and bool(HEXDIGEST.fullmatch(pending_pin)))
    dirfd = admission.private_state_dir(admission_dir, env)
    lockfd = None
    try:
        # Open existing lock read-only. A shared nonblocking lease MUST fail
        # when the legitimate C2-B writer holds its exclusive admission lock.
        raw_lock, lock_stamp, lockfd = fixed_private_entry(
            dirfd, admission.LOCK_NAME, 0, empty=True)
        need(raw_lock == b"")
        fcntl.flock(lockfd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        first_bytes, first_stamp = pending_snapshot(dirfd)
        need(hmac.compare_digest(hashlib.sha256(first_bytes).hexdigest(),
                                 pending_pin))
        pending = parse_pending(first_bytes)
        verified = intent.verify(plan, env, compose, plan_pin, stage_dir,
                                 stage_pin, manifest, signature,
                                 public_key, public_key_pin)
        need(verified["state"] == "signed-apply-intent-inspected-unapplied"
             and verified["apply_supported"] is False)
        signed_source = host.regular_snapshot(manifest, 8192, True)
        signed = intent.parse_intent(signed_source[0])
        need(host.fingerprint(signed_source[0]) ==
             verified["apply_intent_sha256"])
        compare_to_signed(pending, signed, verified, plan_pin, stage_pin)
        # Recheck stage, signed payload and pending inode/hash after complete
        # verification. No success is issued if a concurrent process replaced
        # a file, even if it replaced it with identical contents.
        need(intent.verify(plan, env, compose, plan_pin, stage_dir,
                           stage_pin, manifest, signature, public_key,
                           public_key_pin) == verified)
        need(host.same_snapshot(manifest, signed_source, 8192, True))
        need(pending_snapshot(dirfd) == (first_bytes, first_stamp))
        need(identity(os.fstat(lockfd)) == lock_stamp
             and identity(os.stat(admission.LOCK_NAME, dir_fd=dirfd,
                                  follow_symlinks=False)) == lock_stamp)
        need(identity(os.fstat(dirfd)) ==
             identity(os.stat(admission_dir, follow_symlinks=False)))
        return {
            "protocol": PROTOCOL,
            "state": "signed-intent-pending-reverified-unapplied",
            "apply_supported": False,
            "pending_sha256": pending_pin,
            "intent_sha256": verified["apply_intent_sha256"],
            "desired_revision": verified["desired_revision"],
            "credential_revision": verified["credential_revision"],
            "blockers": BLOCKERS,
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
        "admission-dir", "expected-pending-sha256",
    ):
        parser.add_argument("--" + name, required=True)
    a = parser.parse_args()
    try:
        result = inspect(
            a.plan, a.env_file, a.compose_file, a.expected_plan_sha256,
            a.staging_dir, a.expected_stage_receipt_sha256,
            a.apply_intent_manifest, a.apply_intent_signature,
            a.operator_public_key, a.expected_operator_key_der_sha256,
            a.admission_dir, a.expected_pending_sha256,
        )
    except (Blocked, admission.Blocked, intent.Blocked, intent.stage.Blocked,
            intent.stage.stage.Blocked, host.Blocked, intent.signing.Blocked,
            OSError, UnicodeError, ValueError, TypeError, KeyError,
            OverflowError, AttributeError):
        print(json.dumps({
            "protocol": PROTOCOL, "state": "blocked",
            "apply_supported": False,
            "reason": "pending-intent-mismatch-or-stale-proof",
        }, sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
