#!/usr/bin/env python3
"""C2-E: verify the protected ORIGINAL host rollback anchor; NEVER apply/restore."""
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


anchor = sibling("xd_caddy_anchor_original", "caddy-https-host-rollback-anchor.py")
pending = anchor.pending
admission = anchor.admission
host = anchor.host

PROTOCOL = "xdrive.caddy.https.host-rollback-anchor-verify.v1"
FIELDS = frozenset((
    "protocol", "state", "apply_supported", "pending_sha256",
    "intent_sha256", "operation_sha256", "desired_revision",
    "credential_revision", "original_environment_sha256",
    "original_compose_sha256", "candidate_environment_sha256", "blockers",
))


class Blocked(Exception):
    pass


def need(condition):
    if not condition:
        raise Blocked()


def is_digest(value):
    return type(value) is str and bool(host.HEXDIGEST.fullmatch(value))


def private_copy(dirfd, name, limit):
    need(name in (anchor.ORIGINAL_ENV, anchor.ORIGINAL_COMPOSE, anchor.RECEIPT))
    need(hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_NONBLOCK"))
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |
                 getattr(os, "O_CLOEXEC", 0), dir_fd=dirfd)
    try:
        first = os.fstat(fd)
        need(stat.S_ISREG(first.st_mode) and first.st_uid == os.geteuid()
             and stat.S_IMODE(first.st_mode) == 0o600 and first.st_nlink == 1
             and 0 < first.st_size <= limit)
        raw = bytearray()
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not part:
                break
            raw.extend(part)
        second = os.fstat(fd)
        path = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        need(anchor.identity(first) == anchor.identity(second) ==
             anchor.identity(path) and len(raw) == first.st_size)
        return bytes(raw), anchor.identity(first)
    finally:
        os.close(fd)


def parse_receipt(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 4096)
    try:
        obj = json.loads(raw.decode("ascii"),
                         object_pairs_hook=host.no_duplicates,
                         parse_float=host.reject_invalid_number,
                         parse_constant=host.reject_invalid_number)
    except (ValueError, UnicodeError, host.Blocked):
        raise Blocked() from None
    need(type(obj) is dict and set(obj) == FIELDS)
    need(raw == (json.dumps(obj, sort_keys=True, separators=(",", ":"),
                            ensure_ascii=True) + "\n").encode("ascii"))
    need(obj["protocol"] == anchor.PROTOCOL and
         obj["state"] == "host-rollback-anchor-prepared-unapplied" and
         obj["apply_supported"] is False and obj["blockers"] == anchor.BLOCKERS)
    for name in ("desired_revision", "credential_revision"):
        need(type(obj[name]) is int and 0 <= obj[name] < (1 << 60))
    need(obj["desired_revision"] > 0)
    for name in ("pending_sha256", "intent_sha256", "operation_sha256",
                 "original_environment_sha256", "original_compose_sha256",
                 "candidate_environment_sha256"):
        need(is_digest(obj[name]))
    return obj


def inspect(plan, env, compose, plan_pin, stage_dir, stage_pin,
            manifest, signature, key, key_pin, admission_dir,
            pending_pin, anchor_receipt_pin):
    need(is_digest(pending_pin) and is_digest(anchor_receipt_pin))
    # Independently revalidate the signed request, staged candidate and LIVE
    # host originals. This is a *pre-install* check, not a recovery executor.
    first_inspection = pending.inspect(
        plan, env, compose, plan_pin, stage_dir, stage_pin,
        manifest, signature, key, key_pin, admission_dir, pending_pin)
    need(first_inspection["state"] ==
         "signed-intent-pending-reverified-unapplied" and
         first_inspection["apply_supported"] is False)
    statefd = admission.private_state_dir(admission_dir, env)
    lockfd = None
    anchorfd = None
    try:
        raw_lock, lock_stamp, lockfd = pending.fixed_private_entry(
            statefd, admission.LOCK_NAME, 0, empty=True)
        need(raw_lock == b"")
        fcntl.flock(lockfd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        pending_raw, pending_stamp = pending.pending_snapshot(statefd)
        need(hmac.compare_digest(hashlib.sha256(pending_raw).hexdigest(),
                                 pending_pin))
        journal = pending.parse_pending(pending_raw)

        anchorfd = os.open(anchor.FOLDER, os.O_RDONLY | os.O_DIRECTORY |
                           os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0),
                           dir_fd=statefd)
        directory_stamp = anchor.identity(os.fstat(anchorfd))
        directory_on_path = os.stat(anchor.FOLDER, dir_fd=statefd,
                                    follow_symlinks=False)
        folder = os.fstat(anchorfd)
        need(stat.S_ISDIR(folder.st_mode) and folder.st_uid == os.geteuid()
             and stat.S_IMODE(folder.st_mode) == 0o700
             and directory_stamp == anchor.identity(directory_on_path))
        expected_names = sorted((anchor.ORIGINAL_ENV, anchor.ORIGINAL_COMPOSE,
                                 anchor.RECEIPT))
        need(sorted(os.listdir(anchorfd)) == expected_names)

        receipt_raw, receipt_stamp = private_copy(anchorfd, anchor.RECEIPT, 4096)
        original_env, env_stamp = private_copy(
            anchorfd, anchor.ORIGINAL_ENV, 131072)
        original_compose, compose_stamp = private_copy(
            anchorfd, anchor.ORIGINAL_COMPOSE, 262144)
        need(hmac.compare_digest(hashlib.sha256(receipt_raw).hexdigest(),
                                 anchor_receipt_pin))
        receipt = parse_receipt(receipt_raw)
        for key_name, journal_name in (
            ("pending_sha256", None),
            ("intent_sha256", "intent_sha256"),
            ("operation_sha256", "operation_sha256"),
            ("desired_revision", "desired_revision"),
            ("credential_revision", "credential_revision"),
            ("candidate_environment_sha256", "candidate_environment_sha256"),
            ("original_environment_sha256", "host_environment_sha256"),
            ("original_compose_sha256", "host_compose_sha256"),
        ):
            expected = pending_pin if journal_name is None else journal[journal_name]
            actual = receipt[key_name]
            need(type(actual) is type(expected) and
                 (hmac.compare_digest(actual, expected)
                  if type(actual) is str else actual == expected))
        need(receipt["desired_revision"] == first_inspection["desired_revision"]
             and receipt["credential_revision"] ==
             first_inspection["credential_revision"]
             and receipt["intent_sha256"] ==
             first_inspection["intent_sha256"])
        host.validate_env(original_env)
        host.validate_compose(original_compose)
        need(hmac.compare_digest(hashlib.sha256(original_env).hexdigest(),
                                 receipt["original_environment_sha256"])
             and hmac.compare_digest(
                 hashlib.sha256(original_compose).hexdigest(),
                 receipt["original_compose_sha256"]))

        live_env = host.regular_snapshot(env, 131072, True)
        live_compose = host.regular_snapshot(compose, 262144)
        need(hmac.compare_digest(live_env[0], original_env) and
             hmac.compare_digest(live_compose[0], original_compose))

        # Re-read all protected entries under the SAME shared lock, including
        # inode identity, exact bytes and old live source identities.
        for name, old in (
            (anchor.RECEIPT, (receipt_raw, receipt_stamp)),
            (anchor.ORIGINAL_ENV, (original_env, env_stamp)),
            (anchor.ORIGINAL_COMPOSE, (original_compose, compose_stamp)),
        ):
            need(private_copy(anchorfd, name, 4096 if name == anchor.RECEIPT
                              else 131072 if name == anchor.ORIGINAL_ENV
                              else 262144) == old)
        need(sorted(os.listdir(anchorfd)) == expected_names)
        need(anchor.identity(os.fstat(anchorfd)) == directory_stamp ==
             anchor.identity(os.stat(anchor.FOLDER, dir_fd=statefd,
                                     follow_symlinks=False)))
        need(host.same_snapshot(env, live_env, 131072, True) and
             host.same_snapshot(compose, live_compose, 262144))
        need(pending.pending_snapshot(statefd) == (pending_raw, pending_stamp))
        need(pending.identity(os.fstat(lockfd)) == lock_stamp ==
             pending.identity(os.stat(admission.LOCK_NAME, dir_fd=statefd,
                                      follow_symlinks=False)))
        need(pending.identity(os.fstat(statefd)) ==
             pending.identity(os.stat(admission_dir, follow_symlinks=False)))
        need(pending.inspect(plan, env, compose, plan_pin, stage_dir, stage_pin,
                             manifest, signature, key, key_pin, admission_dir,
                             pending_pin) == first_inspection)
        return {
            "protocol": PROTOCOL,
            "state": "host-rollback-anchor-reverified-unapplied",
            "apply_supported": False,
            "receipt_sha256": anchor_receipt_pin,
            "pending_sha256": pending_pin,
            "original_environment_sha256": receipt["original_environment_sha256"],
            "original_compose_sha256": receipt["original_compose_sha256"],
            "desired_revision": receipt["desired_revision"],
            "credential_revision": receipt["credential_revision"],
            "blockers": anchor.BLOCKERS,
        }
    finally:
        if anchorfd is not None:
            os.close(anchorfd)
        if lockfd is not None:
            os.close(lockfd)
        os.close(statefd)


def main():
    ap = argparse.ArgumentParser()
    for name in ("plan", "env-file", "compose-file",
                 "expected-plan-sha256", "staging-dir",
                 "expected-stage-receipt-sha256", "apply-intent-manifest",
                 "apply-intent-signature", "operator-public-key",
                 "expected-operator-key-der-sha256", "admission-dir",
                 "expected-pending-sha256", "expected-anchor-receipt-sha256"):
        ap.add_argument("--" + name, required=True)
    a = ap.parse_args()
    try:
        result = inspect(a.plan, a.env_file, a.compose_file,
                         a.expected_plan_sha256, a.staging_dir,
                         a.expected_stage_receipt_sha256,
                         a.apply_intent_manifest, a.apply_intent_signature,
                         a.operator_public_key,
                         a.expected_operator_key_der_sha256,
                         a.admission_dir, a.expected_pending_sha256,
                         a.expected_anchor_receipt_sha256)
    except (Blocked, anchor.Blocked, pending.Blocked, admission.Blocked,
            anchor.intent.Blocked, anchor.intent.stage.Blocked,
            anchor.intent.stage.stage.Blocked, host.Blocked,
            anchor.intent.signing.Blocked, OSError, TypeError, ValueError,
            KeyError, UnicodeError, AttributeError, OverflowError):
        print(json.dumps({"protocol": PROTOCOL, "state": "blocked",
                          "apply_supported": False,
                          "reason": "untrusted-or-changing-original-anchor"},
                         sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
