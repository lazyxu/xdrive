#!/usr/bin/env python3
"""Operator-local, read-only Caddy HTTPS revision plan preflight (NET-M5-B2).

No network, Docker, host writes, Caddy restart, trust-store changes, secrets in
output, or claim that the DB revision has been host-applied. An independently
pinned plan and a *new* rescue/rollback protocol are required for real apply.
"""

import argparse
import hashlib
import ipaddress
import json
import os
import re
import stat
import sys

PROTOCOL = "xdrive.caddy.https.host-plan.v1"
PLAN_FIELDS = frozenset({
    "protocol", "desired_revision", "credential_revision", "domain_enabled",
    "domain", "lan_enabled", "lan_ip",
})
ENV_FIELDS = frozenset({
    "XD_DOMAIN", "XD_LAN_HTTPS_IP", "XD_LEGACY_HTTP_ONLY", "XD_HTTPS_BIND",
    "XD_HTTPS_PORT", "XD_WEB_BIND",
})
HEXDIGEST = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
DOMAIN_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z", re.ASCII)
LINE = re.compile(r"([A-Z][A-Z0-9_]*)=(.*)\Z", re.ASCII)


class Blocked(Exception):
    """Any unsafe or unverifiable input; callers receive only a fixed code."""


def check(value):
    if not value:
        raise Blocked()


def fingerprint(data):
    return hashlib.sha256(data).hexdigest()


def regular_snapshot(path, limit, require_private=False):
    """Fail closed for FIFO, symlink, changed inode, oversized or writable file."""
    check(hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_NONBLOCK"))
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
        try:
            before = os.fstat(fd)
            check(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= limit)
            check(not before.st_mode & (stat.S_IWGRP | stat.S_IWOTH))
            if require_private:
                check(not before.st_mode & (stat.S_IRGRP | stat.S_IROTH))
            check(before.st_uid in (os.geteuid(), 0))
            raw = bytearray()
            while len(raw) <= limit:
                piece = os.read(fd, min(65536, limit + 1 - len(raw)))
                if not piece:
                    break
                raw.extend(piece)
            after = os.fstat(fd)
        finally:
            os.close(fd)
        path_state = os.stat(path, follow_symlinks=False)
    except OSError:
        raise Blocked() from None
    def identity(s):
        return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    check(identity(before) == identity(after) == identity(path_state))
    check(len(raw) == before.st_size and len(raw) <= limit)
    return (bytes(raw), identity(before))


def same_snapshot(path, initial, limit, require_private=False):
    next_data, next_identity = regular_snapshot(path, limit, require_private)
    return next_identity == initial[1] and next_data == initial[0]


def no_duplicates(pairs):
    result = {}
    for k, v in pairs:
        check(k not in result)
        result[k] = v
    return result


def reject_invalid_number(_):
    raise Blocked()


def private_ipv4(value):
    if not isinstance(value, str) or not value or len(value) > 15:
        return False
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}", value, re.ASCII):
        return False
    try:
        ip = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    parts = value.split(".")
    return str(ip) == value and (parts[0] == "10" or
        (parts[0] == "172" and 16 <= int(parts[1]) <= 31) or
        (parts[0] == "192" and parts[1] == "168"))


def dns_domain(value):
    if not isinstance(value, str) or not 4 <= len(value) <= 253 or value != value.lower():
        return False
    try:
        value.encode("ascii")
    except UnicodeEncodeError:
        return False
    parts = value.split(".")
    return (len(parts) >= 2 and all(DOMAIN_LABEL.fullmatch(s) for s in parts)
            and bool(re.fullmatch(r"[a-z]{2,}", parts[-1], re.ASCII)))


def validate_plan(data):
    try:
        obj = json.loads(data.decode("ascii"), object_pairs_hook=no_duplicates,
            parse_float=reject_invalid_number, parse_constant=reject_invalid_number)
    except (ValueError, UnicodeError):
        raise Blocked() from None
    check(isinstance(obj, dict) and obj.keys() == PLAN_FIELDS)
    check(json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii") + b"\n" == data)
    check(obj["protocol"] == PROTOCOL)
    for key in ("desired_revision", "credential_revision"):
        check(type(obj[key]) is int and 0 <= obj[key] < (1 << 60))
    check(obj["desired_revision"] > 0)
    check(type(obj["domain_enabled"]) is bool and type(obj["lan_enabled"]) is bool)
    check(obj["domain_enabled"] or obj["lan_enabled"])
    check(isinstance(obj["domain"], str) and isinstance(obj["lan_ip"], str))
    check(not obj["domain"] or dns_domain(obj["domain"]))
    check(not obj["lan_ip"] or private_ipv4(obj["lan_ip"]))
    check(not obj["domain_enabled"] or (obj["domain"] and obj["credential_revision"] > 0))
    check(not obj["lan_enabled"] or bool(obj["lan_ip"]))
    return obj


def validate_env(data):
    try:
        source = data.decode("utf-8")
    except UnicodeError:
        raise Blocked() from None
    extracted = {}
    for line in source.splitlines():
        match = LINE.fullmatch(line)
        if match and match.group(1) in ENV_FIELDS:
            k, v = match.groups()
            check(k not in extracted)
            if len(v) >= 2 and v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            check(len(v) <= 253 and "\r" not in v and "\n" not in v)
            extracted[k] = v
    domain = extracted.get("XD_DOMAIN", "")
    ip = extracted.get("XD_LAN_HTTPS_IP", "")
    check(not domain or dns_domain(domain))
    check(not ip or private_ipv4(ip))
    check(extracted.get("XD_WEB_BIND", "127.0.0.1") == "127.0.0.1")
    check(extracted.get("XD_LEGACY_HTTP_ONLY", "0") in ("0", "1"))
    port = extracted.get("XD_HTTPS_PORT", "8443")
    check(bool(re.fullmatch(r"[1-9][0-9]{0,4}", port, re.ASCII)) and int(port) <= 65535)
    bind = extracted.get("XD_HTTPS_BIND", "0.0.0.0")
    check(bind == "0.0.0.0" or private_ipv4(bind))
    check(not ip or bind in ("0.0.0.0", ip))
    check(domain or ip or extracted.get("XD_LEGACY_HTTP_ONLY") == "1")
    return {"domain": domain, "ip": ip, "bind": bind,
            "legacy": extracted.get("XD_LEGACY_HTTP_ONLY", "0") == "1"}


def validate_compose(data):
    try:
        source = data.decode("utf-8")
    except UnicodeError:
        raise Blocked() from None
    check(all(s in source for s in (
        "container_name: xdrive-caddy", "XD_DOMAIN:", "XD_LAN_HTTPS_IP:",
        "XD_HTTPS_BIND", "XD_HTTPS_PORT", "xdrive-caddy-start",
    )))
    # Not an authenticated parsed Compose or a resource/signature verification.


def mode(domain, ip):
    if domain and ip:
        return "both"
    if domain:
        return "domain-only"
    if ip:
        return "ip-only"
    return "legacy-http-only"


def calculate_changes(plan, installed):
    desired_domain = plan["domain"] if plan["domain_enabled"] else ""
    desired_ip = plan["lan_ip"] if plan["lan_enabled"] else ""
    changes = []
    for kind, old, new in (("domain", installed["domain"], desired_domain),
                           ("lan", installed["ip"], desired_ip)):
        if old == new:
            continue
        changes.append(("switch-" if old and new else "enable-" if new else "disable-") + kind)
    blockers = []
    if installed["legacy"]:
        blockers.append("legacy-deployment")
    if desired_ip and installed["bind"] not in ("0.0.0.0", desired_ip):
        blockers.append("https-bind-migration-required")
    if any(change.startswith(("disable-", "switch-")) for change in changes):
        blockers.append("existing-ingress-at-risk")
    if plan["domain_enabled"]:
        blockers.append("alidns-secret-host-handoff-required")
    return changes, blockers, mode(desired_domain, desired_ip)


def preview(plan_file, env_file, compose_file, pinned_hash):
    check(bool(HEXDIGEST.fullmatch(pinned_hash)))
    snapshots = [(plan_file, regular_snapshot(plan_file, 4096, True), 4096, True),
                 (env_file, regular_snapshot(env_file, 131072, True), 131072, True),
                 (compose_file, regular_snapshot(compose_file, 262144), 262144, False)]
    check(fingerprint(snapshots[0][1][0]) == pinned_hash)
    plan = validate_plan(snapshots[0][1][0])
    installed = validate_env(snapshots[1][1][0])
    validate_compose(snapshots[2][1][0])
    changes, blockers, desired_mode = calculate_changes(plan, installed)
    # Recheck all original file identities/content after every local read.
    check(all(same_snapshot(path, original, limit, secret)
              for path, original, limit, secret in snapshots))
    result = {
        "protocol": PROTOCOL, "state": "review-required" if changes else "no-change",
        "apply_supported": False,
        "desired_revision": plan["desired_revision"],
        "credential_revision": plan["credential_revision"],
        "candidate_sha256": fingerprint(snapshots[0][1][0]),
        "host_environment_sha256": fingerprint(snapshots[1][1][0]),
        "host_compose_sha256": fingerprint(snapshots[2][1][0]),
        "current_mode": mode(installed["domain"], installed["ip"]),
        "desired_mode": desired_mode,
        "changes": changes,
        "blockers": sorted(set(blockers + [
            "independent-rescue-not-proven", "revision-bound-host-cas-not-implemented",
            "post-change-tls-and-login-not-verified", "timed-rollback-not-armed",
        ])),
    }
    return result


def main():
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--expected-plan-sha256", required=True)
    options = parser.parse_args()
    try:
        result = preview(options.plan, options.env_file, options.compose_file,
                         options.expected_plan_sha256)
    except (Blocked, OSError, ValueError, TypeError):
        print(json.dumps({"protocol": PROTOCOL, "state": "blocked", "apply_supported": False,
                          "reason": "invalid-or-changing-input"}, sort_keys=True))
        return 2
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
