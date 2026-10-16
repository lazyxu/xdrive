#!/usr/bin/env python3
"""Operator-only OFFLINE signed rescue image approval check.

No network, Docker calls, credentials, runtime mutations or Caddy controls.
This proves only a local Ed25519 approval signed by an operator-pinned key;
it is neither an OCI publisher signature nor a deployed-image receipt.
"""
import datetime as dt
import hashlib
import hmac
import json
from pathlib import Path
import re
import stat
import subprocess
import sys


class Blocked(Exception):
    pass


def need(ok, reason):
    if not ok:
        raise Blocked(reason)


IMAGE = re.compile(r"[a-z0-9][a-z0-9./:_-]{2,180}@sha256:[0-9a-f]{64}")
TIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
SCOPE = "xdrive-caddy-rescue-operator-image-approval-v1"
DER_ED25519_PREFIX = bytes.fromhex("302a300506032b6570032100")


def safe_bytes(name, limit, strict_permissions=False):
    path = Path(name)
    try:
        mode = path.lstat()
    except OSError:
        raise Blocked("Approval file unavailable") from None
    need(stat.S_ISREG(mode.st_mode) and not path.is_symlink()
         and 0 < mode.st_size <= limit, "Approval input must be a small regular file")
    if strict_permissions:
        need(not (mode.st_mode & (stat.S_IWGRP | stat.S_IWOTH)),
             "Operator-pinned public key file is writable by others")
    try:
        data = path.read_bytes()
    except OSError:
        raise Blocked("Approval input unreadable") from None
    need(len(data) == mode.st_size, "Approval input changed during read")
    return data


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "Duplicate signed manifest field")
        result[key] = value
    return result


def utc(value):
    need(isinstance(value, str) and TIME.fullmatch(value),
         "Approval timestamp must be precise UTC")
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        raise Blocked("Approval timestamp is invalid") from None


def verify_public_key(path, pinned_sha256):
    need(bool(re.fullmatch(r"[0-9a-f]{64}", pinned_sha256)),
         "Pinned public key SHA256 is invalid")
    safe_bytes(path, 8192, strict_permissions=True)
    try:
        out = subprocess.run(
            ["openssl", "pkey", "-pubin", "-in", str(path), "-outform", "DER"],
            capture_output=True, timeout=8, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Offline public key verification unavailable") from None
    need(out.returncode == 0 and len(out.stdout) == 44
         and out.stdout.startswith(DER_ED25519_PREFIX),
         "Public key must be a valid Ed25519 approval key")
    actual = hashlib.sha256(out.stdout).hexdigest()
    need(hmac.compare_digest(actual, pinned_sha256),
         "Operator approval public key does not match pinned trust root")


def verify_signature(manifest_path, signature_path, key_path):
    sig = safe_bytes(signature_path, 64)
    need(len(sig) == 64, "Operator approval signature must be Ed25519")
    try:
        result = subprocess.run(
            ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(key_path),
             "-rawin", "-in", str(manifest_path), "-sigfile", str(signature_path)],
            capture_output=True, timeout=8, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Offline signature verification unavailable") from None
    need(result.returncode == 0, "Offline operator approval signature invalid")


def check():
    need(len(sys.argv) == 6,
         "Usage: image-approval-check MANIFEST_JSON SIGNATURE_BIN TRUSTED_PUBLIC_KEY PINNED_KEY_DER_SHA256 EXPECTED_IMAGE_REF")
    manifest_name, signature, trust, key_fingerprint, expected_ref = sys.argv[1:]
    need(bool(IMAGE.fullmatch(expected_ref)) and ".." not in expected_ref,
         "Expected rescue image must be an immutable OCI digest reference")
    source = safe_bytes(manifest_name, 8192)
    try:
        manifest = json.loads(source.decode("utf-8"), object_pairs_hook=no_duplicates)
    except (UnicodeError, ValueError):
        raise Blocked("Signed approval manifest JSON invalid") from None
    need(isinstance(manifest, dict)
         and set(manifest) == {"schema", "scope", "image", "issued_at", "expires_at"}
         and type(manifest["schema"]) is int and manifest["schema"] == 1
         and manifest["scope"] == SCOPE,
         "Signed approval manifest schema or scope invalid")
    canonical = (json.dumps(manifest, sort_keys=True,
                 separators=(",", ":"), ensure_ascii=True) + "\n").encode("ascii")
    need(source == canonical, "Signed approval manifest is not canonical")
    image = manifest["image"]
    need(isinstance(image, str) and image == expected_ref
         and IMAGE.fullmatch(image) and ".." not in image,
         "Signed approved image differs from immutable expected image")
    issued, expiry = utc(manifest["issued_at"]), utc(manifest["expires_at"])
    now = dt.datetime.now(dt.timezone.utc)
    need(issued < expiry and expiry - issued <= dt.timedelta(days=30)
         and now >= issued - dt.timedelta(minutes=5) and now < expiry,
         "Signed operator approval is not currently valid")
    verify_public_key(trust, key_fingerprint)
    verify_signature(manifest_name, signature, trust)
    print("operator-pinned-ed25519-approval: verified-offline")
    print("approval-validity-window: current")
    print("immutable-rescue-image: matched-signed-expected-reference")
    print("deployed-rescue-image: unverified")
    print("publisher-signature-and-independent-compatibility: unverified")
    print("outage-tls-admin-restoration: unverified")
    print("caddy-apply-stop-restart: blocked")


if __name__ == "__main__":
    try:
        check()
    except Blocked as error:
        print("rescue-image-approval: blocked (" + str(error) + ")", file=sys.stderr)
        sys.exit(1)
