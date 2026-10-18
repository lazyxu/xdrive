#!/usr/bin/env python3
"""C2-A operator-local READ-ONLY Ed25519 Caddy Host Apply INTENT inspection.

This checks a request envelope against a privately staged, unchanged HTTPS
candidate and two DB revisions. It does NOT consume a nonce, acquire a host
CAS lock, change .env, deploy/restart Caddy, or prove an independent rescue.
Never treat a successful inspection as permission to perform an Apply.
"""
import argparse
import datetime as dt
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import re
import sys
import uuid


def sibling(module, name):
    spec = importlib.util.spec_from_file_location(
        module, Path(__file__).with_name(name))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


stage = sibling("xd_caddy_intent_stage", "caddy-https-host-verify-stage.py")
host = stage.host
signing = sibling("xd_caddy_intent_signing", "caddy-rescue-image-approval-check.py")
PROTOCOL = "xdrive.caddy.https.host-apply-intent-inspection.v1"
SCOPE = "xdrive.caddy.https.operator-apply-intent.v1"
ACTION = "request-restricted-caddy-apply"
HEXDIGEST = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
OCI = re.compile(r"[a-z0-9][a-z0-9./:_-]{2,180}@sha256:[0-9a-f]{64}\Z", re.ASCII)
FIELDS = frozenset((
    "schema", "scope", "action", "operation_uuid", "nonce",
    "desired_revision", "credential_revision", "plan_sha256",
    "stage_receipt_sha256", "host_environment_sha256",
    "host_compose_sha256", "candidate_environment_sha256",
    "approved_rescue_image", "issued_at", "expires_at",
))


class Blocked(Exception):
    pass


def need(condition):
    if not condition:
        raise Blocked()


def parse_intent(raw):
    need(isinstance(raw, bytes) and len(raw) <= 8192)
    try:
        document = json.loads(
            raw.decode("ascii"),
            object_pairs_hook=host.no_duplicates,
            parse_float=host.reject_invalid_number,
            parse_constant=host.reject_invalid_number,
        )
    except (ValueError, UnicodeError, host.Blocked):
        raise Blocked() from None
    need(isinstance(document, dict) and document.keys() == FIELDS)
    canonical = (json.dumps(document, sort_keys=True,
                separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
    need(raw == canonical)
    need(type(document["schema"]) is int and document["schema"] == 1)
    need(document["scope"] == SCOPE and document["action"] == ACTION)
    for field in ("desired_revision", "credential_revision"):
        value = document[field]
        need(type(value) is int and 0 <= value < (1 << 60))
    need(document["desired_revision"] > 0)
    for field in ("nonce", "plan_sha256", "stage_receipt_sha256",
                  "host_environment_sha256", "host_compose_sha256",
                  "candidate_environment_sha256"):
        need(isinstance(document[field], str) and
             bool(HEXDIGEST.fullmatch(document[field])))
    need(document["nonce"] != "0" * 64)
    try:
        operation = uuid.UUID(document["operation_uuid"])
    except (ValueError, TypeError, AttributeError):
        raise Blocked() from None
    need(str(operation) == document["operation_uuid"] and
         operation.version == 4 and operation.variant == uuid.RFC_4122)
    image = document["approved_rescue_image"]
    need(isinstance(image, str) and bool(OCI.fullmatch(image)) and ".." not in image)
    start = signing.utc(document["issued_at"])
    end = signing.utc(document["expires_at"])
    now = dt.datetime.now(dt.timezone.utc)
    need(start < end and end - start <= dt.timedelta(minutes=10) and
         now >= start - dt.timedelta(minutes=1) and now < end)
    return document


def verify(plan, env, compose, plan_pin, stage_dir, stage_pin,
           manifest, signature, public_key, pinned_key):
    need(isinstance(plan_pin, str) and bool(HEXDIGEST.fullmatch(plan_pin)))
    need(isinstance(stage_pin, str) and bool(HEXDIGEST.fullmatch(stage_pin)))
    # Independently pinned exact plan and receipt; strict safe staged file
    # checks and blocker policy are reused from the accepted B3-C1 verifier.
    staged = stage.verify(plan, env, compose, plan_pin, stage_dir, stage_pin)
    need(staged["state"] == "candidate-verified-unapplied" and
         staged["apply_supported"] is False)
    sources = (
        (plan, host.regular_snapshot(plan, 4096, True), 4096, True),
        (env, host.regular_snapshot(env, 131072, True), 131072, True),
        (compose, host.regular_snapshot(compose, 262144), 262144, False),
        (manifest, host.regular_snapshot(manifest, 8192, True), 8192, True),
        (signature, host.regular_snapshot(signature, 64, True), 64, True),
        (public_key, host.regular_snapshot(public_key, 8192), 8192, False),
    )
    plan_raw, env_raw, compose_raw, signed_raw, sig_raw, _ = (
        entry[1][0] for entry in sources)
    need(len(sig_raw) == 64)
    need(hmac.compare_digest(host.fingerprint(plan_raw), plan_pin))
    plan_values = host.validate_plan(plan_raw)
    request = parse_intent(signed_raw)
    fields = {
        "desired_revision": plan_values["desired_revision"],
        "credential_revision": plan_values["credential_revision"],
        "plan_sha256": plan_pin,
        "stage_receipt_sha256": stage_pin,
        "host_environment_sha256": host.fingerprint(env_raw),
        "host_compose_sha256": host.fingerprint(compose_raw),
        "candidate_environment_sha256": staged["candidate_environment_sha256"],
    }
    for field, expected in fields.items():
        actual = request[field]
        need(type(actual) is type(expected))
        need(hmac.compare_digest(actual, expected) if isinstance(expected, str)
             else actual == expected)
    signing.verify_public_key(public_key, pinned_key)
    signing.verify_signature(manifest, signature, public_key)
    need(all(host.same_snapshot(path, observed, size, private)
             for path, observed, size, private in sources))
    need(stage.verify(plan, env, compose, plan_pin, stage_dir, stage_pin) == staged)
    # Validation of a signed *request* is separate from durable one-use
    # admission. This script NEVER returns "approved" or true apply support.
    return {
        "protocol": PROTOCOL,
        "state": "signed-apply-intent-inspected-unapplied",
        "apply_supported": False,
        "apply_intent_sha256": hashlib.sha256(signed_raw).hexdigest(),
        "plan_sha256": plan_pin,
        "stage_receipt_sha256": stage_pin,
        "desired_revision": plan_values["desired_revision"],
        "credential_revision": plan_values["credential_revision"],
        "blockers": sorted(set(staged["blockers"] + [
            "durable-single-use-nonce-and-host-cas-not-implemented",
            "physical-outage-rescue-and-publisher-provenance-not-accepted",
            "independent-watchdog-rollback-not-armed",
            "post-apply-enabled-and-disabled-origin-verification-required",
            "host-apply-and-applied-receipt-not-implemented",
        ])),
    }


def main():
    parser = argparse.ArgumentParser()
    for name in (
        "plan", "env-file", "compose-file", "expected-plan-sha256",
        "staging-dir", "expected-stage-receipt-sha256",
        "apply-intent-manifest", "apply-intent-signature",
        "operator-public-key", "expected-operator-key-der-sha256",
    ):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    try:
        result = verify(
            args.plan, args.env_file, args.compose_file,
            args.expected_plan_sha256, args.staging_dir,
            args.expected_stage_receipt_sha256,
            args.apply_intent_manifest, args.apply_intent_signature,
            args.operator_public_key, args.expected_operator_key_der_sha256,
        )
    except (Blocked, stage.Blocked, stage.stage.Blocked, host.Blocked,
            signing.Blocked, OSError, UnicodeError, TypeError, ValueError,
            KeyError, OverflowError, AttributeError):
        print(json.dumps({
            "protocol": PROTOCOL, "state": "blocked", "apply_supported": False,
            "reason": "invalid-stale-or-unauthorized-apply-intent",
        }, sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
