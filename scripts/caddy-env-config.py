#!/usr/bin/env python3
"""Host-only, fixed-key Caddy .env management; no general .env editor or Docker API."""
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone

KEYS = ("XD_DOMAIN", "XD_LAN_HTTPS_IP", "ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET")
LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*?)(\r?\n)?$")
SAFE = re.compile(r"^[A-Za-z0-9_./+=:@%-]*$")
HOST = re.compile(r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$", re.IGNORECASE)
HEX = re.compile(r"^[0-9a-f]{64}$")
REQ_ID = re.compile(r"^[0-9a-f]{24}$")
MAX_ENV = 1024 * 1024


class Restricted(Exception):
    pass


def read_secure(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            raise Restricted("unsafe-host-file")
        raw = os.read(fd, MAX_ENV + 1)
        if len(raw) > MAX_ENV:
            raise Restricted("oversized-host-file")
        return raw
    finally:
        os.close(fd)


def parse(raw):
    try:
        lines = raw.decode("utf-8", errors="strict").splitlines(keepends=True)
    except UnicodeError as exc:
        raise Restricted("invalid-host-encoding") from exc
    values = {key: "" for key in KEYS}
    seen = set()
    for line in lines:
        match = LINE.fullmatch(line)
        if not match or match.group(1) not in values:
            continue
        key, value = match.group(1), match.group(2)
        if key in seen:
            raise Restricted("duplicate-managed-key")
        seen.add(key)
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1]
        if any(c in value for c in ("\0", "\r", "\n")):
            raise Restricted("invalid-managed-value")
        values[key] = value
    return lines, values


def fingerprint(values):
    data = json.dumps(values, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def validate(values):
    for val in values.values():
        if len(val) > 512 or SAFE.fullmatch(val) is None:
            raise Restricted("unsupported-env-value")
    domain, addr = values["XD_DOMAIN"], values["XD_LAN_HTTPS_IP"]
    if not domain and not addr:
        raise Restricted("both-https-entries-disabled")
    if domain and (len(domain) < 4 or HOST.fullmatch(domain) is None or
                   re.fullmatch(r"[A-Za-z]{2,63}", domain.rsplit(".", 1)[-1]) is None):
        raise Restricted("invalid-domain")
    if addr:
        try:
            ip = ipaddress.IPv4Address(addr)
        except ipaddress.AddressValueError as exc:
            raise Restricted("invalid-lan-address") from exc
        if addr != str(ip) or not any(ip in network for network in (
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("172.16.0.0/12"),
            ipaddress.ip_network("192.168.0.0/16"),
        )):
            raise Restricted("invalid-lan-address")
    key, secret = values["ALIYUN_ACCESS_KEY_ID"], values["ALIYUN_ACCESS_KEY_SECRET"]
    if bool(key) != bool(secret):
        raise Restricted("incomplete-alidns-pair")
    if (key or domain) and (not 8 <= len(key) <= 128 or not 8 <= len(secret) <= 256):
        raise Restricted("domain-requires-valid-alidns")


def render(original, updated):
    lines, _ = parse(original)
    ending = "\r\n" if b"\r\n" in original else "\n"
    seen = set()
    result = []
    for line in lines:
        match = LINE.fullmatch(line)
        if match and match.group(1) in updated:
            key = match.group(1)
            seen.add(key)
            result.append(f"{key}={updated[key]}{ending}")
        else:
            result.append(line)
    if result and not result[-1].endswith(("\r\n", "\n")):
        result.append(ending)
    for key in KEYS:
        if key not in seen:
            result.append(f"{key}={updated[key]}{ending}")
    return "".join(result).encode("utf-8")


def replace_atomic(path, data):
    name = None
    try:
        fd, name = tempfile.mkstemp(prefix=".caddy-env-", dir=path.parent)
        with os.fdopen(fd, "wb") as target:
            os.fchmod(target.fileno(), 0o600)
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(name, path)
        parent = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def payload():
    raw = sys.stdin.buffer.read(4097)
    if len(raw) > 4096:
        raise Restricted("oversized-request")
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise Restricted("invalid-request") from exc
    if not isinstance(data, dict) or REQ_ID.fullmatch(str(data.get("request_id", ""))) is None:
        raise Restricted("invalid-request-id")
    if HEX.fullmatch(str(data.get("expected_sha256", ""))) is None:
        raise Restricted("invalid-fingerprint")
    return data


def visible(values, pending):
    domain, lan = values["XD_DOMAIN"], values["XD_LAN_HTTPS_IP"]
    return {
        "protocol": "xdrive.caddy.host-env.v1",
        "domain": domain, "domain_enabled": bool(domain),
        "lan_ip": lan, "lan_enabled": bool(lan),
        "alidns_configured": bool(values["ALIYUN_ACCESS_KEY_ID"] and values["ALIYUN_ACCESS_KEY_SECRET"]),
        "sha256": fingerprint(values), "pending_redeploy": pending,
        "observed_at": datetime.now(timezone.utc).isoformat(),
    }


def save(data, env, backup, marker):
    if set(data) - {"operation", "request_id", "created_at", "expected_sha256", "https", "alidns"}:
        raise Restricted("unexpected-request-fields")
    if data.get("operation") != "save" or ("https" not in data and "alidns" not in data):
        raise Restricted("unsupported-save")
    raw = read_secure(env)
    _, old = parse(raw)
    if fingerprint(old) != data["expected_sha256"]:
        raise Restricted("stale-host-env")
    if marker.exists():
        state = json.loads(read_secure(marker))
        if state.get("target_sha256") != fingerprint(old) or not backup.exists():
            raise Restricted("pending-host-edit-conflict")
    elif backup.exists():
        raise Restricted("unreconciled-backup")
    new = dict(old)
    if "https" in data:
        entry = data["https"]
        if not isinstance(entry, dict) or set(entry) != {"enabled", "domain", "lan_enabled", "lan_ip"}:
            raise Restricted("invalid-https-selection")
        if type(entry["enabled"]) is not bool or type(entry["lan_enabled"]) is not bool or \
                not isinstance(entry["domain"], str) or not isinstance(entry["lan_ip"], str):
            raise Restricted("invalid-https-selection")
        new["XD_DOMAIN"] = entry["domain"].lower() if entry["enabled"] else ""
        new["XD_LAN_HTTPS_IP"] = entry["lan_ip"] if entry["lan_enabled"] else ""
    if "alidns" in data:
        creds = data["alidns"]
        if not isinstance(creds, dict) or set(creds) - {"action", "access_key_id", "access_key_secret"}:
            raise Restricted("invalid-alidns-action")
        action = creds.get("action")
        if action == "clear" and set(creds) == {"action"}:
            new["ALIYUN_ACCESS_KEY_ID"] = ""
            new["ALIYUN_ACCESS_KEY_SECRET"] = ""
        elif action == "replace":
            for name, key in (("access_key_id", "ALIYUN_ACCESS_KEY_ID"),
                              ("access_key_secret", "ALIYUN_ACCESS_KEY_SECRET")):
                if name in creds:
                    if not isinstance(creds[name], str):
                        raise Restricted("invalid-alidns-value")
                    new[key] = creds[name]
        else:
            raise Restricted("invalid-alidns-action")
    validate(new)
    # Keep the last running baseline across multiple Save operations.
    if not marker.exists():
        # Both files are durable before changing the authoritative .env.
        # A crash between any two renames must leave a recoverable baseline.
        replace_atomic(backup, raw)
        replace_atomic(marker, json.dumps(
            {"target_sha256": fingerprint(old)}, separators=(",", ":")).encode())
    replace_atomic(env, render(raw, new))
    replace_atomic(marker, json.dumps(
        {"target_sha256": fingerprint(new)}, separators=(",", ":")).encode())
    return {"request_id": data["request_id"], "state": "saved", **visible(new, True)}


def finish(data, env, backup, marker, commit):
    durable = commit and os.environ.get("XD_CADDY_COMMIT_DURABLE") == "1"
    base = {"operation", "request_id", "expected_sha256"}
    with_local = base | {"host_local_generation_sha256", "host_local_live_config_sha256"}
    if data.get("operation") != ("commit" if commit else "restore"):
        raise Restricted("invalid-completion")
    if durable:
        # Only the internal Host runner with its inherited install.lock can
        # publish a new success decision containing bounded local proof.
        if set(data) != with_local or any(
            not isinstance(data.get(key), str) or HEX.fullmatch(data[key]) is None
            for key in ("host_local_generation_sha256", "host_local_live_config_sha256")
        ):
            raise Restricted("invalid-local-runtime-witness")
    elif set(data) not in (base, {"operation", "request_id", "created_at"}):
        raise Restricted("invalid-completion")
    raw = read_secure(env)
    _, old = parse(raw)
    if fingerprint(old) != data["expected_sha256"] or not backup.exists():
        raise Restricted("changed-host-env")
    # A crashed Save may leave a marker that still names the previous
    # fingerprint. In that case COMMIT is forbidden, but an explicitly
    # requested RESTORE may recover the pinned baseline using current CAS.
    if marker.exists():
        state = json.loads(read_secure(marker))
        if state.get("target_sha256") != fingerprint(old) and commit:
            raise Restricted("pending-target-mismatch")
    elif commit:
        raise Restricted("missing-deployment-marker")
    if not commit:
        _, before = parse(read_secure(backup))
        replace_atomic(env, render(raw, before))
        _, old = parse(read_secure(env))
    if durable:
        _, prior = parse(read_secure(backup))
        retired_digest = archive_retired_targets(
            data["request_id"], data["expected_sha256"], prior, old)
        # The local Generation+Live Config window and Ready+TLS checks happened
        # under the inherited install.lock. Publish the window witness in
        # the SAME immutable decision as the original Request ID and .env SHA.
        # This is historical host-local evidence, not signed/live Applied.
        archive_deploy({
            "protocol": "xdrive.caddy.host-env.v1", "state": "deployed",
            "request_id": data["request_id"], "sha256": data["expected_sha256"],
            "host_local_generation_sha256": data["host_local_generation_sha256"],
            "host_local_live_config_sha256": data["host_local_live_config_sha256"],
            "retired_targets_sha256": retired_digest,
        })
        # Offline fault injection: power loss after durable decision, before
        # marker/backup cleanup. Never reachable from browser input.
        if (os.environ.get("XD_HOST_CONTROL_SOURCE_ONLY") == "1" and
                os.environ.get("XD_CADDY_TEST_COMMIT_CRASH_AFTER_ARCHIVE") == "1"):
            os._exit(86)
    if marker.exists():
        marker.unlink()
    if (commit and os.environ.get("XD_HOST_CONTROL_SOURCE_ONLY") == "1" and
            os.environ.get("XD_CADDY_TEST_COMMIT_CRASH_AFTER_MARKER") == "1"):
        os._exit(87)
    backup.unlink()
    if commit:
        sync_directory(marker.parent)
    return {"request_id": data["request_id"], "state": "committed" if commit else "restored",
            **visible(old, False)}


def reveal(data, env, backup, marker):
    if set(data) not in ({"operation", "request_id", "expected_sha256"},
                         {"operation", "request_id", "created_at", "expected_sha256"}) or data.get("operation") != "reveal":
        raise Restricted("invalid-reveal-request")
    _, values = parse(read_secure(env))
    if fingerprint(values) != data["expected_sha256"]:
        raise Restricted("stale-host-env")
    if backup.exists() != marker.exists():
        raise Restricted("unreconciled-host-write")
    if marker.exists():
        saved = json.loads(read_secure(marker))
        if saved.get("target_sha256") != fingerprint(values):
            raise Restricted("incomplete-host-write")
    key_id, secret = values["ALIYUN_ACCESS_KEY_ID"], values["ALIYUN_ACCESS_KEY_SECRET"]
    if not key_id or not secret:
        raise Restricted("alidns-not-configured")
    return {
        "protocol": "xdrive.caddy.host-env.v1",
        "request_id": data["request_id"], "state": "revealed",
        "sha256": fingerprint(values), "access_key_id": key_id,
        "access_key_secret": secret, "expires_in_seconds": 30,
    }


# A bounded, read-only-for-Server terminal ledger. It is not an Applied
# Receipt, live Caddy proof, authorization token or history of .env secrets.
# Archive is Host-only and deliberately does not take install.lock: a proven
# installer-busy outcome must remain publishable while an upgrade owns it.

# Private, immutable Host-only source of retired HTTPS targets. The original
# successful terminal pins this file's canonical digest, Request ID and target
# SHA. Server/browser may read the terminal digest but never this private file.
RETIRED_TARGET_DIR = "caddy-retired-targets"
RETIRED_TARGET_SCOPE = "xdrive.caddy.retired-targets.v1"


def _private_retired_directory(home, create):
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    if not home or not os.path.isabs(home):
        raise Restricted("invalid-private-target-home")
    parent = os.open(home, flags)
    try:
        info = os.fstat(parent)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o007:
            raise Restricted("unsafe-private-target-home")
        if create:
            try:
                os.mkdir(RETIRED_TARGET_DIR, mode=0o700, dir_fd=parent)
            except FileExistsError:
                pass
        directory = os.open(RETIRED_TARGET_DIR, flags, dir_fd=parent)
    finally:
        os.close(parent)
    info = os.fstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or \
            stat.S_IMODE(info.st_mode) not in (0o700, 0o2700):
        os.close(directory)
        raise Restricted("unsafe-private-target-directory")
    return directory


def _read_retired_record(home, request_id):
    if not isinstance(request_id, str) or REQ_ID.fullmatch(request_id) is None:
        raise Restricted("invalid-private-target-id")
    directory = _private_retired_directory(home, False)
    try:
        fd = os.open(request_id + ".json",
                     os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                    info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600 or
                    info.st_size < 2 or info.st_size > 1024):
                raise Restricted("unsafe-private-target-file")
            data = os.read(fd, 1025)
            if len(data) != info.st_size:
                raise Restricted("changed-private-target-file")
            return data
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def _canonical_retired_lan(value):
    if not isinstance(value, str):
        return False
    try:
        addr = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        return False
    return str(addr) == value and any(addr in n for n in (
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
    ))


def archive_retired_targets(request_id, current_sha, previous, current):
    """Host install.lock only: archive target identities, NEVER AliDNS secrets.

    A killed writer before the receipt is published leaves no trusted terminal.
    A partial private record deliberately fails closed on retry. If the exact
    original record already exists, it may be reused without overwriting.
    """
    if (not isinstance(request_id, str) or REQ_ID.fullmatch(request_id) is None or
            not isinstance(current_sha, str) or HEX.fullmatch(current_sha) is None or
            fingerprint(current) != current_sha):
        raise Restricted("untrusted-private-target-source")
    # The original rollback journal remains available until immutable commit.
    old_domain = previous["XD_DOMAIN"].lower()
    old_lan = previous["XD_LAN_HTTPS_IP"]
    new_domain = current["XD_DOMAIN"].lower()
    new_lan = current["XD_LAN_HTTPS_IP"]
    retired_domain = old_domain if old_domain and old_domain != new_domain else ""
    retired_lan = old_lan if old_lan and old_lan != new_lan else ""
    if old_domain and HOST.fullmatch(old_domain) is None:
        raise Restricted("invalid-retired-domain")
    if old_lan and not _canonical_retired_lan(old_lan):
        raise Restricted("invalid-retired-lan")
    record = {
        "protocol": RETIRED_TARGET_SCOPE,
        "request_id": request_id,
        "target_sha256": current_sha,
        "previous_sha256": fingerprint(previous),
        "retired_domain": retired_domain,
        "retired_lan_ip": retired_lan,
    }
    raw = (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(raw) > 1024:
        raise Restricted("oversized-private-target")
    home = os.environ.get("XD_CADDY_DEPLOY_RECEIPT_DIR", "")
    directory = _private_retired_directory(home, True)
    try:
        name = request_id + ".json"
        try:
            fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY |
                         getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=directory)
        except FileExistsError:
            existing = _read_retired_record(home, request_id)
            if existing != raw:
                raise Restricted("conflicting-private-target")
        else:
            try:
                with os.fdopen(fd, "wb", closefd=False) as f:
                    f.write(raw)
                    f.flush()
                    os.fsync(f.fileno())
            finally:
                os.close(fd)
            os.fsync(directory)
    finally:
        os.close(directory)
    return hashlib.sha256(raw).hexdigest()


def verify_retired_targets_digest(home, request_id, target_sha, expected_digest):
    if not isinstance(expected_digest, str) or HEX.fullmatch(expected_digest) is None:
        raise Restricted("invalid-private-target-digest")
    raw = _read_retired_record(home, request_id)
    if hashlib.sha256(raw).hexdigest() != expected_digest:
        raise Restricted("mismatched-private-target-digest")
    try:
        payload = json.loads(raw, object_pairs_hook=lambda pairs:
                             _reject_duplicate_retired_pairs(pairs))
    except (ValueError, UnicodeError) as exc:
        raise Restricted("invalid-private-target-json") from exc
    if (set(payload) != {"protocol", "request_id", "target_sha256", "previous_sha256",
                         "retired_domain", "retired_lan_ip"} or
            payload["protocol"] != RETIRED_TARGET_SCOPE or
            payload["request_id"] != request_id or
            payload["target_sha256"] != target_sha or
            not isinstance(payload["previous_sha256"], str) or
            HEX.fullmatch(payload["previous_sha256"]) is None or
            not isinstance(payload["retired_domain"], str) or
            not isinstance(payload["retired_lan_ip"], str) or
            (payload["retired_domain"] and HOST.fullmatch(payload["retired_domain"]) is None)):
        raise Restricted("untrusted-private-target-record")
    if payload["retired_lan_ip"] and not _canonical_retired_lan(payload["retired_lan_ip"]):
        raise Restricted("invalid-private-target-lan")


def _reject_duplicate_retired_pairs(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise Restricted("duplicate-private-target-field")
        obj[key] = value
    return obj


DEPLOY_ARCHIVE_DIR = "caddy-deploy-results"
DEPLOY_ARCHIVE_MAX = 64
DEPLOY_ARCHIVE_TTL = 7 * 24 * 60 * 60


def _prune_orphan_retired_targets(home, now):
    """Expire *orphaned* private evidence without invalidating retained receipts.

    A crashed Host may publish a private original before its immutable terminal;
    keep such records for the same seven-day recovery horizon. Never follow or
    delete symlinks, hard links, unknown names, directories, non-Host files or
    proofs still referenced by an immutable terminal. This is best-effort
    maintenance after a successfully fsynced terminal/retention decision.
    """
    try:
        directory = _private_retired_directory(home, False)
    except FileNotFoundError:
        # Legacy Host installations have no separate private retired evidence.
        return
    terminal_flags = (os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) |
                      getattr(os, "O_NOFOLLOW", 0))
    try:
        parent = os.open(home, terminal_flags)
        try:
            receipts = os.open(DEPLOY_ARCHIVE_DIR, terminal_flags, dir_fd=parent)
        finally:
            os.close(parent)
    except OSError:
        os.close(directory)
        raise
    try:
        changed = False
        for name in os.listdir(directory):
            if not name.endswith(".json") or REQ_ID.fullmatch(name[:-5]) is None:
                continue
            evidence = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if (not stat.S_ISREG(evidence.st_mode) or
                    evidence.st_uid != os.geteuid() or evidence.st_nlink != 1 or
                    stat.S_IMODE(evidence.st_mode) != 0o600 or
                    now - evidence.st_mtime <= DEPLOY_ARCHIVE_TTL):
                continue
            try:
                result = os.stat(name, dir_fd=receipts, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                # A retained terminal, even an older source-compatible record,
                # is never removed by a private evidence GC.
                if stat.S_ISREG(result.st_mode):
                    continue
                raise Restricted("untrusted-retired-terminal-entry")
            os.unlink(name, dir_fd=directory)
            changed = True
        if changed:
            os.fsync(directory)
    finally:
        os.close(receipts)
        os.close(directory)

DEPLOY_ERRORS = frozenset((
    "installer-busy", "deploy-refused", "interrupted-deploy",
    "caddy-deploy-or-verify-failed",
))


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) |
                         getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def archive_deploy(receipt=None):
    home_dir = os.environ.get("XD_CADDY_DEPLOY_RECEIPT_DIR", "")
    if not home_dir or not os.path.isabs(home_dir):
        raise Restricted("invalid-receipt-directory")
    if receipt is None:
        data = sys.stdin.buffer.read(1025)
        if len(data) > 1024:
            raise Restricted("oversized-receipt")

        def unique_pairs(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise Restricted("duplicate-receipt-field")
                result[key] = value
            return result

        try:
            receipt = json.loads(data, object_pairs_hook=unique_pairs)
        except (ValueError, UnicodeError) as exc:
            raise Restricted("invalid-receipt") from exc
    local_keys = {"host_local_generation_sha256", "host_local_live_config_sha256"}
    allowed = {"protocol", "state", "request_id", "sha256", "rolled_back", "error",
               "retired_targets_sha256"} | local_keys
    if not isinstance(receipt, dict) or set(receipt) - allowed:
        raise Restricted("unexpected-receipt-field")
    if receipt.get("protocol") != "xdrive.caddy.host-env.v1":
        raise Restricted("invalid-receipt-protocol")
    request_id, sha = receipt.get("request_id"), receipt.get("sha256")
    if not isinstance(request_id, str) or REQ_ID.fullmatch(request_id) is None or \
            not isinstance(sha, str) or HEX.fullmatch(sha) is None:
        raise Restricted("invalid-receipt-identity")
    state = receipt.get("state")
    if state not in ("deployed", "failed"):
        raise Restricted("nonterminal-receipt")
    present_local = set(receipt) & local_keys
    private_digest = receipt.get("retired_targets_sha256")
    if private_digest is not None:
        if (state != "deployed" or present_local != local_keys or
                not isinstance(private_digest, str) or HEX.fullmatch(private_digest) is None):
            raise Restricted("invalid-private-target-digest")
        # A group-reachable legacy terminal bridge is not a trust source.
        # Require a separately written Host-private, exact-identity record.
        verify_retired_targets_digest(home_dir, request_id, sha, private_digest)
    # Legacy v1 success rows have neither field. Modern trusted Host commits
    # include BOTH; never accept a partial, malformed or failed-row witness.
    if present_local and (state != "deployed" or present_local != local_keys or
            any(not isinstance(receipt[k], str) or HEX.fullmatch(receipt[k]) is None
                for k in local_keys)):
        raise Restricted("invalid-local-runtime-witness")
    code = receipt.get("error", "")
    if not isinstance(code, str):
        raise Restricted("invalid-receipt-error")
    code = code if state == "failed" and code in DEPLOY_ERRORS else ""
    if "rolled_back" in receipt and type(receipt["rolled_back"]) is not bool:
        raise Restricted("invalid-receipt-rollback")
    restored = (state == "failed" and code in (
        "interrupted-deploy", "caddy-deploy-or-verify-failed",
    ) and receipt.get("rolled_back") is True)
    clean = {
        "protocol": "xdrive.caddy.host-env.v1",
        "state": state, "request_id": request_id, "sha256": sha,
    }
    if code:
        clean["error"] = code
    if restored:
        clean["rolled_back"] = True
    if present_local:
        for key in local_keys:
            clean[key] = receipt[key]
    if private_digest is not None:
        clean["retired_targets_sha256"] = private_digest
    output = (json.dumps(clean, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if len(output) > 512:
        raise Restricted("oversized-receipt")

    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    parent = os.open(home_dir, flags)
    try:
        p = os.fstat(parent)
        if not stat.S_ISDIR(p.st_mode) or p.st_uid != os.geteuid() or p.st_mode & 0o007:
            raise Restricted("unsafe-receipt-parent")
        try:
            os.mkdir(DEPLOY_ARCHIVE_DIR, mode=0o700, dir_fd=parent)
        except FileExistsError:
            pass
        folder = os.open(DEPLOY_ARCHIVE_DIR, flags, dir_fd=parent)
        try:
            f = os.fstat(folder)
            if not stat.S_ISDIR(f.st_mode) or f.st_uid != os.geteuid() or f.st_gid != p.st_gid:
                raise Restricted("unsafe-receipt-directory")
            # Host owns writes; the Server group may only traverse and read.
            if stat.S_IMODE(f.st_mode) in (0o700, 0o2700):
                os.fchmod(folder, 0o2750)
            elif stat.S_IMODE(f.st_mode) != 0o2750:
                raise Restricted("unsafe-receipt-directory-mode")
            if stat.S_IMODE(os.fstat(folder).st_mode) != 0o2750:
                raise Restricted("receipt-directory-permissions-unavailable")
            filename = request_id + ".json"
            # Never expose a partially written filename as a completed
            # decision. fsync the private temporary inode, publish once by
            # no-overwrite hard link, then fsync the directory. SIGKILL
            # before the link leaves NO terminal. A killed writer after the
            # link leaves either the full prior result or no result.
            temporary = ".caddy-terminal-" + secrets.token_hex(12) + ".tmp"
            wflags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(temporary, wflags, 0o600, dir_fd=folder)
            try:
                os.fchmod(fd, 0o640)
                with os.fdopen(fd, "wb", closefd=False) as dest:
                    dest.write(output)
                    dest.flush()
                    os.fsync(fd)
            finally:
                os.close(fd)
            try:
                os.link(temporary, filename, src_dir_fd=folder, dst_dir_fd=folder,
                        follow_symlinks=False)
                os.fsync(folder)
                # Simulate SIGKILL between durable publish and removing the
                # temporary hard link. Reconciliation must handle this nlink=2
                # state by matching the one Host-owned temporary inode.
                if (os.environ.get("XD_HOST_CONTROL_SOURCE_ONLY") == "1" and
                        os.environ.get("XD_CADDY_TEST_COMMIT_CRASH_AFTER_LINK") == "1"):
                    os._exit(88)
            finally:
                os.unlink(temporary, dir_fd=folder)

            # Bounded storage: seven days / at most 64 *terminal* receipts.
            # Never follow symlinks, traverse subdirectories or touch other
            # Host Control artifacts. Existing request IDs never overwrite.
            now = time.time()
            retained = []
            for name in os.listdir(folder):
                if not name.endswith(".json") or REQ_ID.fullmatch(name[:-5]) is None:
                    continue
                info = os.stat(name, dir_fd=folder, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    continue
                if now - info.st_mtime > DEPLOY_ARCHIVE_TTL:
                    os.unlink(name, dir_fd=folder)
                else:
                    retained.append((info.st_mtime, name))
            for _, name in sorted(retained)[:-DEPLOY_ARCHIVE_MAX]:
                os.unlink(name, dir_fd=folder)
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        os.close(parent)
    # Keep the Host-private former-domain/IP lifecycle aligned with the seven
    # day terminal history. Never remove any proof referenced by a terminal.
    _prune_orphan_retired_targets(home_dir, now)


def reconcile_committed(data, env, backup, marker):
    # This action is private to the Host runner while it holds install.lock.
    # It only finishes cleanup AFTER a durable and exact terminal has been
    # written. Absence, corruption or a mismatched SHA fail closed.
    if set(data) != {"operation", "request_id", "expected_sha256"} or \
            data["operation"] != "reconcile-commit":
        raise Restricted("invalid-commit-reconcile")
    home_dir = os.environ.get("XD_CADDY_DEPLOY_RECEIPT_DIR", "")
    if not home_dir or not os.path.isabs(home_dir):
        raise Restricted("invalid-receipt-directory")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    parent = os.open(home_dir, flags)
    try:
        p = os.fstat(parent)
        if not stat.S_ISDIR(p.st_mode) or p.st_uid != os.geteuid() or p.st_mode & 0o007:
            raise Restricted("unsafe-receipt-parent")
        folder = os.open(DEPLOY_ARCHIVE_DIR, flags, dir_fd=parent)
        try:
            f = os.fstat(folder)
            if not stat.S_ISDIR(f.st_mode) or f.st_uid != os.geteuid() or \
                    f.st_gid != p.st_gid or stat.S_IMODE(f.st_mode) != 0o2750:
                raise Restricted("unsafe-receipt-directory")
            descriptor = os.open(data["request_id"] + ".json",
                                 os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=folder)
            try:
                record = os.fstat(descriptor)
                if (not stat.S_ISREG(record.st_mode) or record.st_nlink not in (1, 2) or
                        record.st_uid != os.geteuid() or record.st_gid != f.st_gid or
                        stat.S_IMODE(record.st_mode) != 0o640 or record.st_size > 512 or
                        record.st_size == 0 or
                        time.time() - record.st_mtime > DEPLOY_ARCHIVE_TTL or
                        record.st_mtime - time.time() > 15):
                    raise Restricted("unsafe-commit-receipt")
                raw = os.read(descriptor, 513)
            finally:
                os.close(descriptor)
            if record.st_nlink == 2:
                # Crash between hard-link publication and temporary-unlink.
                # Accept only the *one* expected Host-owned sibling inode.
                candidates = []
                for name in os.listdir(folder):
                    if re.fullmatch(r"\.caddy-terminal-[0-9a-f]{24}\.tmp", name) is None:
                        continue
                    info = os.stat(name, dir_fd=folder, follow_symlinks=False)
                    if (stat.S_ISREG(info.st_mode) and info.st_dev == record.st_dev and
                            info.st_ino == record.st_ino and info.st_uid == record.st_uid and
                            info.st_gid == record.st_gid and stat.S_IMODE(info.st_mode) == 0o640):
                        candidates.append(name)
                if len(candidates) != 1:
                    raise Restricted("unrecognized-commit-hardlink")
                os.unlink(candidates[0], dir_fd=folder)
                os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        os.close(parent)
    def no_duplicate_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise Restricted("duplicate-commit-field")
            result[key] = value
        return result

    try:
        receipt = json.loads(raw, object_pairs_hook=no_duplicate_pairs)
    except (ValueError, UnicodeError) as exc:
        raise Restricted("invalid-commit-receipt") from exc
    legacy_success = {
        "protocol": "xdrive.caddy.host-env.v1",
        "state": "deployed", "request_id": data["request_id"],
        "sha256": data["expected_sha256"],
    }
    modern_keys = {"host_local_generation_sha256", "host_local_live_config_sha256"}
    extended_keys = modern_keys | {"retired_targets_sha256"}
    if not isinstance(receipt, dict):
        raise Restricted("mismatched-commit-receipt")
    if receipt != legacy_success:
        keys = set(receipt)
        if (keys not in (set(legacy_success) | modern_keys,
                         set(legacy_success) | extended_keys) or
                any(receipt.get(k) != v for k, v in legacy_success.items()) or
                any(not isinstance(receipt[k], str) or HEX.fullmatch(receipt[k]) is None
                    for k in keys - set(legacy_success))):
            raise Restricted("mismatched-commit-receipt")
        if "retired_targets_sha256" in receipt:
            verify_retired_targets_digest(home_dir, data["request_id"],
                                          data["expected_sha256"],
                                          receipt["retired_targets_sha256"])
    _, present = parse(read_secure(env))
    if fingerprint(present) != data["expected_sha256"]:
        raise Restricted("changed-host-env")
    for filename in (marker, backup):
        if filename.is_symlink():
            raise Restricted("unsafe-commit-journal")
    if marker.exists():
        state = json.loads(read_secure(marker))
        if state.get("target_sha256") != data["expected_sha256"]:
            raise Restricted("pending-target-mismatch")
    if backup.exists():
        parse(read_secure(backup))
    # Some unlink operations may already have completed before SIGKILL.
    if marker.exists():
        marker.unlink()
    if backup.exists():
        backup.unlink()
    sync_directory(marker.parent)
    return {"request_id": data["request_id"], "state": "committed",
            **visible(present, False)}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "archive-deploy":
        archive_deploy()
        return
    if len(sys.argv) != 2 or sys.argv[1] not in ("snapshot", "save", "commit", "restore",
                                                "reveal", "reconcile-commit"):
        raise Restricted("unsupported-command")
    home = Path(os.environ.get("XD_CONFIG_DIR") or Path.home() / ".xd")
    config = home / "config"
    state = home / "state"
    for directory in (home, config, state):
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_mode & 0o022:
            raise Restricted("unsafe-host-directory")
    env = config / ".env"
    journal = state / "caddy-env"
    if journal.exists() and (journal.is_symlink() or not journal.is_dir() or journal.stat().st_mode & 0o077):
        raise Restricted("unsafe-host-journal")
    journal.mkdir(mode=0o700, exist_ok=True)
    backup, marker = journal / "previous.env", journal / "pending.json"
    # A Caddy-only deployment holds the common installer lock for the
    # *entire* recreate -> verify -> commit/restore transaction. An inherited
    # descriptor references the exact same open-file description; flock on a
    # second independent open would deadlock/fail against our own Host lock.
    lock_path = state / "install.lock"
    inherited = os.environ.get("XD_CADDY_INSTALL_LOCK_INHERITED_FD")
    if inherited is None:
        lock_file = open(lock_path, "a+b")
    else:
        if inherited != "6":
            raise Restricted("invalid-inherited-lock")
        expected = os.stat(lock_path, follow_symlinks=False)
        actual = os.fstat(6)
        if (not stat.S_ISREG(actual.st_mode) or actual.st_nlink != 1 or
                (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino)):
            raise Restricted("untrusted-inherited-lock")
        lock_file = os.fdopen(os.dup(6), "a+b")
    if (sys.argv[1] == "reconcile-commit" or
            os.environ.get("XD_CADDY_COMMIT_DURABLE") == "1") and inherited != "6":
        raise Restricted("host-commit-lock-required")
    with lock_file as lock:
        mode = fcntl.LOCK_EX | fcntl.LOCK_NB if inherited is not None else (
            (fcntl.LOCK_SH | fcntl.LOCK_NB) if sys.argv[1] in ("snapshot", "reveal") else fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, mode)
        if sys.argv[1] == "snapshot":
            _, values = parse(read_secure(env))
            if backup.exists() != marker.exists():
                raise Restricted("unreconciled-host-write")
            if marker.exists():
                stored = json.loads(read_secure(marker))
                if stored.get("target_sha256") != fingerprint(values):
                    raise Restricted("incomplete-host-write")
            result = visible(values, marker.exists())
        else:
            request = payload()
            if sys.argv[1] == "save":
                result = save(request, env, backup, marker)
            elif sys.argv[1] == "reveal":
                result = reveal(request, env, backup, marker)
            elif sys.argv[1] == "reconcile-commit":
                result = reconcile_committed(request, env, backup, marker)
            else:
                result = finish(request, env, backup, marker, sys.argv[1] == "commit")
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (Restricted, OSError, ValueError, TypeError) as exc:
        # No raw request, provider secret, .env or physical path in output.
        error = str(exc) if isinstance(exc, Restricted) else "host-env-operation-failed"
        print(json.dumps({"state": "failed", "error": error}, separators=(",", ":")))
        sys.exit(1)
