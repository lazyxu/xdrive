#!/usr/bin/env python3
"""Read-only verification of a privately staged Caddy HTTPS .env candidate.

Independent approval of the receipt SHA must occur out of band. This utility
never installs the candidate, restarts Caddy, connects to Docker/network,
changes permissions, or asserts that the desired revision was applied.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

STAGE_SOURCE = Path(__file__).with_name("caddy-https-host-stage.py")
spec = importlib.util.spec_from_file_location("xdrive_caddy_host_stage", STAGE_SOURCE)
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
host = stage.host
PROTOCOL = "xdrive.caddy.https.host-stage-verify.v1"
RECEIPT_FIELDS = frozenset({
    "protocol", "state", "apply_supported", "desired_revision",
    "credential_revision", "plan_sha256", "host_environment_sha256",
    "host_compose_sha256", "candidate_environment_sha256", "blockers",
})
STAGE_BLOCKERS = frozenset({
    "operator-rescue-not-independently-accepted",
    "live-host-cas-and-rollback-not-authorized",
})


class Blocked(Exception):
    pass


def need(condition):
    if not condition:
        raise Blocked()


def identity(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def private_read(dirfd, name, maximum):
    need(name.startswith(("receipt-", "candidate-")) and "/" not in name)
    need(hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_NONBLOCK"))
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    fd = os.open(name, flags, dir_fd=dirfd)
    try:
        first = os.fstat(fd)
        need(stat.S_ISREG(first.st_mode) and first.st_uid == os.geteuid())
        need(stat.S_IMODE(first.st_mode) == 0o600)
        need(0 < first.st_size <= maximum)
        data = bytearray()
        while len(data) <= maximum:
            piece = os.read(fd, min(65536, maximum + 1 - len(data)))
            if not piece:
                break
            data.extend(piece)
        last = os.fstat(fd)
        entry = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        need(identity(first) == identity(last) == identity(entry))
        need(len(data) == first.st_size)
        return bytes(data), identity(first)
    finally:
        os.close(fd)


def unchanged_entry(dirfd, name, expected):
    current = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    return stat.S_ISREG(current.st_mode) and identity(current) == expected


def verify(plan_path, env_path, compose_path, plan_pin, stage_dir, receipt_pin):
    need(bool(host.HEXDIGEST.fullmatch(plan_pin)))
    need(bool(host.HEXDIGEST.fullmatch(receipt_pin)))
    # Host preflight uses independently pinned canonical plan, protected live
    # input snapshots, strict network identities and readonly risk detection.
    observed = host.preview(plan_path, env_path, compose_path, plan_pin)
    need(observed["apply_supported"] is False)
    need(observed.get("candidate_environment_sha256") is not None)
    need(not stage.DENIED_CHANGE_BLOCKERS.intersection(observed["blockers"]))

    plan = host.regular_snapshot(plan_path, 4096, True)
    env = host.regular_snapshot(env_path, 131072, True)
    compose = host.regular_snapshot(compose_path, 262144, False)
    need(host.fingerprint(plan[0]) == plan_pin)
    need(host.fingerprint(env[0]) == observed["host_environment_sha256"])
    need(host.fingerprint(compose[0]) == observed["host_compose_sha256"])
    decoded_plan = host.validate_plan(plan[0])
    host.validate_env(env[0])
    host.validate_compose(compose[0])
    expected_candidate = host.render_candidate_env(decoded_plan, env[0])
    candidate_hash = host.fingerprint(expected_candidate)
    need(candidate_hash == observed["candidate_environment_sha256"])

    stage_id = hashlib.sha256(
        plan[0] + b"\x00" + env[0] + b"\x00" + compose[0]
    ).hexdigest()
    candidate_name = "candidate-" + stage_id + ".env"
    receipt_name = "receipt-" + stage_id + ".json"
    dirfd = stage.private_stage_directory(stage_dir, env_path)
    try:
        dir_first = os.fstat(dirfd)
        candidate, candidate_identity = private_read(dirfd, candidate_name, 131072)
        receipt_bytes, receipt_identity = private_read(dirfd, receipt_name, 4096)
        need(candidate == expected_candidate)
        need(host.fingerprint(receipt_bytes) == receipt_pin)
        try:
            receipt = json.loads(
                receipt_bytes.decode("ascii"), object_pairs_hook=host.no_duplicates,
                parse_float=host.reject_invalid_number,
                parse_constant=host.reject_invalid_number,
            )
        except (UnicodeError, ValueError, host.Blocked):
            raise Blocked() from None
        need(isinstance(receipt, dict) and receipt.keys() == RECEIPT_FIELDS)
        need((json.dumps(receipt, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=True) + "\n").encode("ascii") == receipt_bytes)
        need(receipt["protocol"] == stage.STAGE_PROTOCOL)
        need(receipt["state"] == "candidate-staged-unapplied")
        need(receipt["apply_supported"] is False)
        need(type(receipt["desired_revision"]) is int and
             receipt["desired_revision"] == decoded_plan["desired_revision"])
        need(type(receipt["credential_revision"]) is int and
             receipt["credential_revision"] == decoded_plan["credential_revision"])
        need(receipt["plan_sha256"] == plan_pin)
        need(receipt["host_environment_sha256"] == observed["host_environment_sha256"])
        need(receipt["host_compose_sha256"] == observed["host_compose_sha256"])
        need(receipt["candidate_environment_sha256"] == candidate_hash)
        blockers = sorted(set(observed["blockers"]) | STAGE_BLOCKERS)
        need(receipt["blockers"] == blockers)
        need(all(host.same_snapshot(path, snapshot, limit, secret)
                 for path, snapshot, limit, secret in (
                    (plan_path, plan, 4096, True),
                    (env_path, env, 131072, True),
                    (compose_path, compose, 262144, False),
                 )))
        need(unchanged_entry(dirfd, candidate_name, candidate_identity))
        need(unchanged_entry(dirfd, receipt_name, receipt_identity))
        dir_last = os.fstat(dirfd)
        dir_path = os.stat(stage_dir, follow_symlinks=False)
        need(identity(dir_first) == identity(dir_last) == identity(dir_path))
        need(stat.S_ISDIR(dir_last.st_mode) and
             stat.S_IMODE(dir_last.st_mode) == 0o700)
    finally:
        os.close(dirfd)

    # A valid staging receipt is not a trusted runtime/rollback/approval
    # witness and can NEVER authorize configuration install by itself.
    return {
        "protocol": PROTOCOL,
        "state": "candidate-verified-unapplied",
        "apply_supported": False,
        "plan_sha256": plan_pin,
        "candidate_environment_sha256": candidate_hash,
        "stage_receipt_sha256": receipt_pin,
        "blockers": blockers,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--expected-plan-sha256", required=True)
    parser.add_argument("--staging-dir", required=True)
    parser.add_argument("--expected-stage-receipt-sha256", required=True)
    args = parser.parse_args()
    try:
        result = verify(
            args.plan, args.env_file, args.compose_file,
            args.expected_plan_sha256, args.staging_dir,
            args.expected_stage_receipt_sha256,
        )
    except (Blocked, stage.Blocked, host.Blocked, OSError,
            TypeError, ValueError, KeyError, OverflowError):
        print(json.dumps({"protocol": PROTOCOL, "state": "blocked",
                          "apply_supported": False,
                          "reason": "stale-or-unsafe-stage"}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
