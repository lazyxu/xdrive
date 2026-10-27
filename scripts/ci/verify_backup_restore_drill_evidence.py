#!/usr/bin/env python3
"""Fail-closed CI-only isolated restore-drill provenance verifier.

This does NOT authenticate a production Host; it only fences a file produced
by the same ephemeral CI checkout after real PostgreSQL + file restore tests.
"""
import datetime as dt
import json
import os
import re
import stat
import subprocess
import sys

MAX_SIZE = 4096
SHA = re.compile(r"[0-9a-f]{40}\Z")
VERIFIED_FIELDS = (
    "database_rows_recovered",
    "postgresql_post_snapshot_probe_absent",
    "legacy_file_bytes_restored",
    "cas_sha256_file_bytes_restored",
    "v1_restore_tested",
    "v2_first_generation_restore_tested",
    "v2_retained_after_manual_prune_restore_tested",
)
FIELDS = {
    "protocol", "environment", "production_verified", "result",
    "ci_checkout_sha", "ci_source_head_sha", "observed_at_utc",
    *VERIFIED_FIELDS,
}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON field")
        result[key] = value
    return result


def read_evidence(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(stream.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= MAX_SIZE:
            raise ValueError("invalid evidence file")
        raw = stream.read(MAX_SIZE + 1)
    if not 0 < len(raw) <= MAX_SIZE:
        raise ValueError("invalid evidence length")
    record = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object,
                        parse_constant=lambda _: (_ for _ in ()).throw(
                            ValueError("nonfinite JSON number")))
    if not isinstance(record, dict):
        raise ValueError("evidence is not an object")
    return record


def validate_evidence(record, checkout, source, parents, now=None):
    if not isinstance(record, dict) or set(record) != FIELDS:
        raise ValueError("unexpected evidence schema")
    if not isinstance(checkout, str) or not SHA.fullmatch(checkout):
        raise ValueError("invalid CI checkout SHA")
    if not isinstance(source, str) or not SHA.fullmatch(source):
        raise ValueError("invalid source commit SHA")
    if record["protocol"] != "xdrive-isolated-backup-restore-drill-v1":
        raise ValueError("unsupported restore-drill protocol")
    if record["environment"] != "ci_ephemeral_docker" or record["result"] != "passed":
        raise ValueError("nonpassing or nonisolated drill")
    if type(record["production_verified"]) is not bool or record["production_verified"]:
        raise ValueError("a CI drill may not claim production acceptance")
    for key in VERIFIED_FIELDS:
        if type(record[key]) is not bool or not record[key]:
            raise ValueError("missing successful restore evidence: " + key)
    if record["ci_checkout_sha"] != checkout or record["ci_source_head_sha"] != source:
        raise ValueError("artifact is not bound to this CI source and checkout")
    if checkout != source and (len(parents) != 2 or parents[1] != source):
        raise ValueError("CI merge checkout does not contain the proposed head")
    if checkout == source and parents and source in parents:
        raise ValueError("a checkout cannot parent itself")
    try:
        when = dt.datetime.fromisoformat(record["observed_at_utc"])
    except (TypeError, ValueError) as e:
        raise ValueError("invalid observation timestamp") from e
    if when.tzinfo is None or when.utcoffset() != dt.timedelta(0):
        raise ValueError("restore observation is not UTC")
    moment = now or dt.datetime.now(dt.timezone.utc)
    elapsed = moment - when
    if not -dt.timedelta(minutes=5) <= elapsed <= dt.timedelta(hours=8):
        raise ValueError("stale or future restore evidence")


def main(argv):
    if len(argv) != 4:
        raise ValueError("usage: verify_backup_restore_drill_evidence.py REPORT CHECKOUT_SHA SOURCE_HEAD_SHA")
    _, path, checkout, source = argv
    record = read_evidence(path)
    observed = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if observed != checkout:
        raise ValueError("CI artifact does not match checked-out source")
    output = subprocess.check_output(["git", "cat-file", "-p", checkout], text=True)
    parents = [line.partition(" ")[2] for line in output.splitlines()
               if line.startswith("parent ")]
    validate_evidence(record, checkout, source, parents)
    print("CI-only PostgreSQL and file restore evidence verified; production acceptance remains unverified")


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (ValueError, OSError, UnicodeError, subprocess.CalledProcessError) as exc:
        print("restore drill evidence rejected: " + str(exc), file=sys.stderr)
        sys.exit(1)
