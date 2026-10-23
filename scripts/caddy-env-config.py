#!/usr/bin/env python3
"""Host-only, fixed-key Caddy .env management; no general .env editor or Docker API."""
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
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
    if set(data) not in ({"operation", "request_id", "expected_sha256"},
                         {"operation", "request_id", "created_at"}) or \
            data.get("operation") != ("commit" if commit else "restore"):
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
    if marker.exists():
        marker.unlink()
    backup.unlink()
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


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("snapshot", "save", "commit", "restore", "reveal"):
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
