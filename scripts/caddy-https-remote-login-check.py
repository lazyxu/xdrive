#!/usr/bin/env python3
"""Off-host operator-only real HTTPS + administrator login verification.

Checks each ENABLED LAN/domain origin against a separately pinned canonical
Host Plan. No proxies, redirects, certificate bypass, Docker, DNS writes,
Host Apply, Caddy restart or claim about an applied deployment revision.
Credentials are prompted locally and are never placed in argv or output.
"""
import argparse
import getpass
import hashlib
import hmac
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys

SOURCE = Path(__file__).with_name("caddy-https-host-plan.py")
spec = importlib.util.spec_from_file_location("xdrive_caddy_host_plan_remote", SOURCE)
host_plan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_plan)

PROTOCOL = "xdrive.caddy.https.remote-login-verify.v1"
EXPECTED_SERVICES = frozenset((
    "database", "storage", "background-worker", "caddy", "media-worker",
    "photo-face", "photo-smart", "photo-semantic", "photo-creative",
    "baidu-map", "geonames",
))
OK = "remote-https-admin-and-desired-plan-verified"
MAX_RESPONSE = 32768
RESPONSE_TIMEOUT = 8


class Blocked(Exception):
    pass


def need(condition):
    if not condition:
        raise Blocked()


def valid_port(value):
    return (isinstance(value, str) and
            re.fullmatch(r"[1-9][0-9]{0,4}", value, re.ASCII) is not None and
            1 <= int(value) <= 65535)


def bounded_request(host, port, tls, method, route, body=None, token=None):
    need(method in ("GET", "POST"))
    need(route in (
        "/api/v1/readyz", "/api/v1/admin/services",
        "/api/v1/auth/login",
        "/api/v1/admin/services/caddy/https/host-plan",
    ))
    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-store",
        "Connection": "close",
        "User-Agent": "xdrive-caddy-operator-remote-proof/1",
    }
    if body is not None:
        need(isinstance(body, bytes) and 0 < len(body) <= 4096)
        headers["Content-Type"] = "application/json"
    if token is not None:
        need(isinstance(token, str) and
             0 < len(token) <= 8192 and token.isascii() and
             all(33 <= ord(c) <= 126 for c in token))
        headers["Authorization"] = "Bearer " + token
    # http.client never consults HTTP(S)_PROXY or follows redirects.
    connection = http.client.HTTPSConnection(
        host, port, context=tls, timeout=RESPONSE_TIMEOUT)
    try:
        connection.request(method, route, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read(MAX_RESPONSE + 1)
        need(len(payload) <= MAX_RESPONSE)
        return response.status, payload
    finally:
        connection.close()


def object_json(payload):
    need(isinstance(payload, bytes) and len(payload) <= MAX_RESPONSE)
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise Blocked() from None
    need(isinstance(value, dict))
    return value


def verify_origin(address, port, tls, username, password, canonical_plan):
    need(isinstance(address, str) and address and valid_port(str(port)))
    need(isinstance(username, str) and 0 < len(username.encode("utf-8")) <= 128)
    need(isinstance(password, str) and 0 < len(password.encode("utf-8")) <= 2048)
    need(not any(ord(c) < 32 for c in username + password))
    need(isinstance(canonical_plan, bytes) and 0 < len(canonical_plan) <= 4096)
    status, payload = bounded_request(
        address, port, tls, "GET", "/api/v1/readyz")
    need(status == 200 and object_json(payload).get("ok") is True)
    status, _ = bounded_request(
        address, port, tls, "GET", "/api/v1/admin/services")
    need(status == 401)
    status, _ = bounded_request(
        address, port, tls, "GET",
        "/api/v1/admin/services/caddy/https/host-plan")
    need(status == 401)
    login = json.dumps(
        {"username": username, "password": password},
        separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    need(len(login) <= 4096)
    status, payload = bounded_request(
        address, port, tls, "POST", "/api/v1/auth/login", body=login)
    need(status == 200)
    session = object_json(payload)
    need(session.get("role") == "admin" and
         session.get("must_change_password") is not True)
    access_token = session.get("access_token")
    need(isinstance(access_token, str) and 0 < len(access_token) <= 8192)
    status, payload = bounded_request(
        address, port, tls, "GET", "/api/v1/admin/services",
        token=access_token)
    need(status == 200)
    items = object_json(payload).get("services")
    need(isinstance(items, list) and len(items) == len(EXPECTED_SERVICES))
    names = [item.get("id") for item in items if isinstance(item, dict)]
    need(len(names) == len(EXPECTED_SERVICES) and
         set(names) == EXPECTED_SERVICES)
    # Prove that each authenticated origin exposes the same *saved desired*
    # revision we independently pinned. This does NOT prove runtime effect.
    status, remote_plan = bounded_request(
        address, port, tls, "GET",
        "/api/v1/admin/services/caddy/https/host-plan",
        token=access_token)
    need(status == 200 and len(remote_plan) == len(canonical_plan) and
         hmac.compare_digest(remote_plan, canonical_plan))
    del access_token
    return OK


def verify(plan_path, pinned_plan_sha, port_text, ca_path,
           pinned_ca_sha, username, password):
    need(isinstance(pinned_plan_sha, str) and
         host_plan.HEXDIGEST.fullmatch(pinned_plan_sha))
    need(valid_port(port_text))
    plan_snapshot = host_plan.regular_snapshot(plan_path, 4096, True)
    raw = plan_snapshot[0]
    need(hmac.compare_digest(host_plan.fingerprint(raw), pinned_plan_sha))
    plan = host_plan.validate_plan(raw)
    lan = plan["lan_enabled"]
    domain = plan["domain_enabled"]
    need(lan or domain)
    observations = {}
    ca_snapshot = None
    if lan:
        need(bool(ca_path) and isinstance(pinned_ca_sha, str) and
             host_plan.HEXDIGEST.fullmatch(pinned_ca_sha))
        ca_snapshot = host_plan.regular_snapshot(ca_path, 131072)
        need(hmac.compare_digest(
            host_plan.fingerprint(ca_snapshot[0]), pinned_ca_sha))
        try:
            pem = ca_snapshot[0].decode("ascii")
            lan_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            lan_tls.minimum_version = ssl.TLSVersion.TLSv1_2
            lan_tls.load_verify_locations(cadata=pem)
        except (ValueError, UnicodeError, ssl.SSLError):
            raise Blocked() from None
        observations["lan"] = verify_origin(
            plan["lan_ip"], int(port_text), lan_tls, username, password, raw)
    else:
        need(not ca_path and not pinned_ca_sha)
        observations["lan"] = "disabled-not-tested"
    if domain:
        # The public domain must chain to system trusted roots and match
        # exactly the requested FQDN: never accept an untrusted self-sign.
        domain_tls = ssl.create_default_context()
        domain_tls.minimum_version = ssl.TLSVersion.TLSv1_2
        observations["domain"] = verify_origin(
            plan["domain"], int(port_text), domain_tls, username, password, raw)
    else:
        observations["domain"] = "disabled-not-tested"
    need(host_plan.same_snapshot(plan_path, plan_snapshot, 4096, True))
    if ca_snapshot is not None:
        need(host_plan.same_snapshot(ca_path, ca_snapshot, 131072))
    return {
        "protocol": PROTOCOL,
        "state": "enabled-origin-logins-verified-unapplied",
        "apply_supported": False,
        "lan": observations["lan"],
        "domain": observations["domain"],
        "desired_revision": plan["desired_revision"],
        "credential_revision": plan["credential_revision"],
        "plan_sha256": pinned_plan_sha,
        "limitations": [
            "verification-does-not-prove-disabled-origin-inaccessible",
            "verification-does-not-prove-actual-host-config-applied",
            "verification-does-not-prove-rollback-or-rescue",
            "verification-does-not-prove-both-origins-same-server-process",
            "verification-does-not-prove-every-client-trusts-private-ca",
        ],
    }



# Operator-only extra regression guard for a formerly enabled origin that
# the desired revision now disables or replaces. A negative network response
# is NEVER proof of physical Caddy removal or a successful Host Apply.
def retired_targets(current, previous):
    need(type(current) is dict and type(previous) is dict)
    need(type(current.get("desired_revision")) is int and
         type(previous.get("desired_revision")) is int and
         previous["desired_revision"] > 0 and
         current["desired_revision"] > previous["desired_revision"])
    need(current.get("lan_enabled") or current.get("domain_enabled"))
    targets = []
    for label, enabled, value in (
        ("lan", "lan_enabled", "lan_ip"),
        ("domain", "domain_enabled", "domain"),
    ):
        if previous.get(enabled) is True and (
                current.get(enabled) is not True or
                current.get(value) != previous.get(value)):
            need(bool(previous.get(value)))
            targets.append((label, previous[value]))
    need(bool(targets))
    return targets


def probe_retired_origin(address, port, tls):
    """Anonymous same-origin probe: NO login or bearer token to an old host."""
    need(isinstance(address, str) and address and valid_port(str(port)))
    try:
        ready, payload = bounded_request(
            address, port, tls, "GET", "/api/v1/readyz")
        if ready != 200 or object_json(payload).get("ok") is not True:
            return "unverified"
        anonymous, _ = bounded_request(
            address, port, tls, "GET", "/api/v1/admin/services")
        plan_status, _ = bounded_request(
            address, port, tls, "GET",
            "/api/v1/admin/services/caddy/https/host-plan")
        if anonymous == 401 and plan_status == 401:
            return "still-serving-xdrive"
    except (OSError, ssl.SSLError, socket.timeout,
            http.client.HTTPException, Blocked):
        return "unverified"
    return "unverified"


def verify_retired_origins(current_path, current_pin, previous_path,
                           previous_pin, port_text, ca_path, ca_pin,
                           previous_ca_path, previous_ca_pin,
                           username, password):
    """Additional alert, NEVER a positive disabled-origin confirmation."""
    need(isinstance(previous_pin, str) and
         host_plan.HEXDIGEST.fullmatch(previous_pin) and
         valid_port(port_text))
    current_snapshot = host_plan.regular_snapshot(current_path, 4096, True)
    previous_snapshot = host_plan.regular_snapshot(previous_path, 4096, True)
    need(hmac.compare_digest(
        host_plan.fingerprint(current_snapshot[0]), current_pin))
    need(hmac.compare_digest(
        host_plan.fingerprint(previous_snapshot[0]), previous_pin))
    current = host_plan.validate_plan(current_snapshot[0])
    previous = host_plan.validate_plan(previous_snapshot[0])
    targets = retired_targets(current, previous)

    old_lan_snapshot = None
    old_lan_tls = None
    if any(label == "lan" for label, _ in targets):
        need(bool(previous_ca_path) and
             isinstance(previous_ca_pin, str) and
             host_plan.HEXDIGEST.fullmatch(previous_ca_pin))
        old_lan_snapshot = host_plan.regular_snapshot(
            previous_ca_path, 131072)
        need(hmac.compare_digest(host_plan.fingerprint(
            old_lan_snapshot[0]), previous_ca_pin))
        try:
            old_lan_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            old_lan_tls.minimum_version = ssl.TLSVersion.TLSv1_2
            old_lan_tls.load_verify_locations(
                cadata=old_lan_snapshot[0].decode("ascii"))
        except (ValueError, UnicodeError, ssl.SSLError):
            raise Blocked() from None
    else:
        need(not previous_ca_path and not previous_ca_pin)

    # Positive authentication FIRST on every intended current ingress.
    # Only these current origins ever receive the operator credentials.
    current_proof = verify(current_path, current_pin, port_text,
                           ca_path, ca_pin, username, password)
    need(current_proof["state"] ==
         "enabled-origin-logins-verified-unapplied" and
         current_proof["apply_supported"] is False)

    observations = {"lan": "not-retired", "domain": "not-retired"}
    for label, address in targets:
        tls = old_lan_tls if label == "lan" else ssl.create_default_context()
        if label == "domain":
            tls.minimum_version = ssl.TLSVersion.TLSv1_2
        observations[label] = probe_retired_origin(
            address, int(port_text), tls)
    need(host_plan.same_snapshot(current_path, current_snapshot, 4096, True))
    need(host_plan.same_snapshot(previous_path, previous_snapshot, 4096, True))
    if old_lan_snapshot is not None:
        need(host_plan.same_snapshot(
            previous_ca_path, old_lan_snapshot, 131072))
    # A live old endpoint is a hard blocker; an unreachable old endpoint
    # is just inconclusive. Neither authorizes restart, receipt or apply.
    need(not any(v == "still-serving-xdrive"
                 for v in observations.values()))
    return {
        "protocol": "xdrive.caddy.https.retired-origin-guard.v1",
        "state": "old-origin-removal-unverified-unapplied",
        "apply_supported": False,
        "desired_revision": current["desired_revision"],
        "previous_revision": previous["desired_revision"],
        "observations": observations,
        "limitations": [
            "unreachable-does-not-prove-origin-disabled",
            "observation-does-not-prove-host-applied-revision",
            "no-physical-rescue-or-watchdog-rollback-proof",
            "old-origin-probe-never-sends-credentials",
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--expected-plan-sha256", required=True)
    parser.add_argument("--https-port", required=True)
    parser.add_argument("--lan-root-ca", default=None)
    parser.add_argument("--expected-lan-ca-sha256", default=None)
    parser.add_argument("--previous-plan", default=None)
    parser.add_argument("--expected-previous-plan-sha256", default=None)
    parser.add_argument("--previous-lan-root-ca", default=None)
    parser.add_argument("--expected-previous-lan-ca-sha256", default=None)
    args = parser.parse_args()
    try:
        print("xDrive operator username:", file=sys.stderr)
        username = sys.stdin.readline(130).rstrip("\r\n")
        password = getpass.getpass("xDrive administrator password: ")
        if any((
                args.previous_plan, args.expected_previous_plan_sha256,
                args.previous_lan_root_ca, args.expected_previous_lan_ca_sha256)):
            need(bool(args.previous_plan) and
                 bool(args.expected_previous_plan_sha256))
            result = verify_retired_origins(
                args.plan, args.expected_plan_sha256,
                args.previous_plan, args.expected_previous_plan_sha256,
                args.https_port, args.lan_root_ca,
                args.expected_lan_ca_sha256,
                args.previous_lan_root_ca,
                args.expected_previous_lan_ca_sha256,
                username, password)
        else:
            result = verify(
                args.plan, args.expected_plan_sha256, args.https_port,
                args.lan_root_ca, args.expected_lan_ca_sha256,
                username, password)
    except (Blocked, host_plan.Blocked, OSError, TypeError, ValueError,
            UnicodeError, KeyError, ssl.SSLError, socket.timeout,
            http.client.HTTPException, EOFError, KeyboardInterrupt):
        print(json.dumps({
            "protocol": PROTOCOL,
            "state": "blocked",
            "apply_supported": False,
            "reason": "untrusted-or-unreachable-origin",
        }, sort_keys=True, separators=(",", ":")))
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
