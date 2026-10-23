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
    if commit and os.environ.get("XD_CADDY_COMMIT_DURABLE") == "1":
        # The local Ready + trusted TLS checks happened under the inherited
        # installer lock BEFORE this commit. The archive is the durable
        # decision point: without it, restart may roll back the candidate;
        # after it, restart must NEVER undo a completed deploy.
        archive_deploy({
            "protocol": "xdrive.caddy.host-env.v1", "state": "deployed",
            "request_id": data["request_id"], "sha256": data["expected_sha256"],
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
DEPLOY_ARCHIVE_DIR = "caddy-deploy-results"
DEPLOY_ARCHIVE_MAX = 64
DEPLOY_ARCHIVE_TTL = 7 * 24 * 60 * 60
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
    allowed = {"protocol", "state", "request_id", "sha256", "rolled_back", "error"}
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
    if (not isinstance(receipt, dict) or
            receipt != {
                "protocol": "xdrive.caddy.host-env.v1",
                "state": "deployed", "request_id": data["request_id"],
                "sha256": data["expected_sha256"],
            }):
        raise Restricted("mismatched-commit-receipt")
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
