#!/usr/bin/env python3
"""Operator-private signed review of a Caddy HTTPS staged candidate, never Apply."""
import argparse
import datetime as dt
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import re
import sys


def load_sibling(module_name, name):
    spec = importlib.util.spec_from_file_location(
        module_name, Path(__file__).with_name(name))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stage = load_sibling("xd_caddy_stage_verify", "caddy-https-host-verify-stage.py")
host = stage.host
signing = load_sibling("xd_caddy_rescue_signing",
                       "caddy-rescue-image-approval-check.py")
PROTOCOL = "xdrive.caddy.https.host-stage-signed-review.v1"
SCOPE = "xdrive.caddy.https.operator-stage-review.v1"
HEXDIGEST = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
FIELDS = frozenset((
    "schema", "scope", "action", "desired_revision", "credential_revision",
    "plan_sha256", "stage_receipt_sha256", "host_environment_sha256",
    "host_compose_sha256", "candidate_environment_sha256",
    "issued_at", "expires_at", "nonce",
))


class Blocked(Exception):
    pass


def need(ok):
    if not ok:
        raise Blocked()


def parse_manifest(data):
    try:
        doc = json.loads(data.decode("ascii"),
                         object_pairs_hook=host.no_duplicates,
                         parse_float=host.reject_invalid_number,
                         parse_constant=host.reject_invalid_number)
    except (ValueError, UnicodeError, host.Blocked):
        raise Blocked() from None
    need(isinstance(doc, dict) and doc.keys() == FIELDS)
    need((json.dumps(doc, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=True) + "\n").encode("ascii") == data)
    need(type(doc["schema"]) is int and doc["schema"] == 1)
    need(doc["scope"] == SCOPE and doc["action"] == "candidate-review-only")
    for name in ("desired_revision", "credential_revision"):
        need(type(doc[name]) is int and 0 <= doc[name] < (1 << 60))
    for name in ("plan_sha256", "stage_receipt_sha256",
                 "host_environment_sha256", "host_compose_sha256",
                 "candidate_environment_sha256", "nonce"):
        need(isinstance(doc[name], str) and HEXDIGEST.fullmatch(doc[name]))
    need(doc["nonce"] != "0" * 64)
    issued = signing.utc(doc["issued_at"])
    expiry = signing.utc(doc["expires_at"])
    now = dt.datetime.now(dt.timezone.utc)
    need(issued < expiry and
         expiry - issued <= dt.timedelta(minutes=60) and
         issued <= now + dt.timedelta(minutes=5) and now < expiry)
    return doc


def verify(plan_path, env_path, compose_path, plan_pin, directory,
           receipt_pin, manifest_path, signature_path, public_key_path,
           key_der_pin):
    need(isinstance(plan_pin, str) and HEXDIGEST.fullmatch(plan_pin))
    need(isinstance(receipt_pin, str) and HEXDIGEST.fullmatch(receipt_pin))
    staged = stage.verify(plan_path, env_path, compose_path,
                          plan_pin, directory, receipt_pin)
    need(staged["state"] == "candidate-verified-unapplied" and
         staged["apply_supported"] is False)
    sources = (
        (plan_path, host.regular_snapshot(plan_path, 4096, True), 4096, True),
        (env_path, host.regular_snapshot(env_path, 131072, True), 131072, True),
        (compose_path, host.regular_snapshot(compose_path, 262144), 262144, False),
        (manifest_path, host.regular_snapshot(manifest_path, 8192, True), 8192, True),
        (signature_path, host.regular_snapshot(signature_path, 64, True), 64, True),
        (public_key_path, host.regular_snapshot(public_key_path, 8192), 8192, False),
    )
    plan, env, compose, approval, signature, _ = (
        entry[1][0] for entry in sources)
    need(host.fingerprint(plan) == plan_pin and len(signature) == 64)
    desired = host.validate_plan(plan)
    signed = parse_manifest(approval)
    expected = {
        "desired_revision": desired["desired_revision"],
        "credential_revision": desired["credential_revision"],
        "plan_sha256": plan_pin,
        "stage_receipt_sha256": receipt_pin,
        "host_environment_sha256": host.fingerprint(env),
        "host_compose_sha256": host.fingerprint(compose),
        "candidate_environment_sha256": staged["candidate_environment_sha256"],
    }
    for key, value in expected.items():
        received = signed[key]
        need(type(received) is type(value))
        need(hmac.compare_digest(received, value) if isinstance(value, str)
             else received == value)
    signing.verify_public_key(public_key_path, key_der_pin)
    signing.verify_signature(manifest_path, signature_path, public_key_path)
    need(all(host.same_snapshot(path, source, size, private)
             for path, source, size, private in sources))
    need(stage.verify(plan_path, env_path, compose_path,
                      plan_pin, directory, receipt_pin) == staged)
    return {
        "protocol": PROTOCOL,
        "state": "signed-review-verified-unapplied",
        "apply_supported": False,
        "review_manifest_sha256": hashlib.sha256(approval).hexdigest(),
        "plan_sha256": plan_pin,
        "stage_receipt_sha256": receipt_pin,
        "blockers": sorted(set(staged["blockers"] + [
            "signed-review-is-not-host-apply-authority",
            "independent-rescue-outage-proof-required",
            "revision-bound-host-cas-required",
            "bounded-restart-and-watchdog-rollback-required",
            "dual-origin-tls-login-and-applied-receipt-required",
        ])),
    }


def main():
    parser = argparse.ArgumentParser()
    for name in ("plan", "env-file", "compose-file", "expected-plan-sha256",
                 "staging-dir", "expected-stage-receipt-sha256",
                 "review-manifest", "review-signature", "operator-public-key",
                 "expected-operator-key-der-sha256"):
        parser.add_argument("--" + name, required=True)
    a = parser.parse_args()
    try:
        result = verify(
            a.plan, a.env_file, a.compose_file, a.expected_plan_sha256,
            a.staging_dir, a.expected_stage_receipt_sha256, a.review_manifest,
            a.review_signature, a.operator_public_key,
            a.expected_operator_key_der_sha256)
    except (Blocked, stage.Blocked, stage.stage.Blocked, host.Blocked,
            signing.Blocked, OSError, UnicodeError, TypeError, ValueError,
            KeyError, OverflowError, AttributeError):
        print(json.dumps({"protocol": PROTOCOL, "state": "blocked",
                          "apply_supported": False,
                          "reason": "invalid-or-stale-signed-review"},
                         sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
