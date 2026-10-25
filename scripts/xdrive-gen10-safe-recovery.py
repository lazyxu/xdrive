#!/usr/bin/env python3
"""Gen10 xDrive storage verification and tightly scoped permissions recovery.

By default read-only. With --apply-permissions, mutate only POSIX metadata of
verified, referenced /data/1 regular files and their ancestor directories if
ALL strict-verification issues are permission_denied. NEVER modify CAS or other
storage trees. A Docker remote connection is not implied; execute on Gen10.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

CANONICAL_BIND = re.compile(r"^/home/[A-Za-z_][A-Za-z0-9_.-]*/\.xd/data/files$")
EXPECTED_UID = 65532
EXPECTED_GID = 65532
EXPECTED_CONTAINER = "xdrive-server"
ALLOWED_USER = "1"
CATEGORIES = (
    "missing", "size_mismatches", "duplicate_references",
    "content_reference_mismatches", "orphans", "hash_mismatches",
)
FLAGS_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FLAGS_FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK


def command(*args: str) -> str:
    proc = subprocess.run(args, check=True, capture_output=True, text=True)
    return proc.stdout.strip()


def inspect_environment(require_apply: bool) -> str:
    container = json.loads(command("docker", "inspect", EXPECTED_CONTAINER))[0]
    if container.get("Config", {}).get("User") != f"{EXPECTED_UID}:{EXPECTED_GID}":
        raise RuntimeError("Server UID/GID is not 65532:65532")
    mounts = [m for m in container.get("Mounts", []) if m.get("Destination") == "/data"]
    if len(mounts) != 1 or mounts[0].get("Type") != "bind":
        raise RuntimeError("Server /data must be exactly one active bind mount")
    data = mounts[0].get("Source", "")
    # Derive the actual active mount without publishing a specific account path.
    # Never accept an arbitrary storage root from the CLI or environment.
    if not isinstance(data, str) or not CANONICAL_BIND.fullmatch(data):
        raise RuntimeError("Server /data must be a canonical user-local .xd/data/files bind")
    if require_apply:
        if os.geteuid() != 0:
            raise RuntimeError("applying permission metadata requires root on Gen10")
        security = command("docker", "info", "--format", "{{json .SecurityOptions}}")
        ns = container.get("HostConfig", {}).get("UsernsMode") or ""
        if "rootless" in security.lower() or "userns" in security.lower() or ns not in ("", "host"):
            raise RuntimeError("rootless/userns Docker; refusing host POSIX chown")
    # Reject symlink substitution anywhere along the bind mount source path.
    prefix = Path("/")
    for part in Path(data).parts[1:]:
        prefix = prefix / part
        if stat.S_ISLNK(os.lstat(prefix).st_mode):
            raise RuntimeError(f"symlink in verified data mount path: {prefix}")
    if not Path(data).is_dir():
        raise RuntimeError("storage root is not a real directory")
    return data


def read_strict_report() -> tuple[dict, int, str]:
    fd, report_path = tempfile.mkstemp(prefix="xdrive-gen10-verify-", suffix=".json", dir="/tmp")
    os.fchmod(fd, 0o600)
    try:
        with os.fdopen(fd, "wb") as out:
            proc = subprocess.run(
                ["docker", "exec", "--user", "65532:65532", EXPECTED_CONTAINER,
                 "xdrive-server", "storage", "verify", "--json"],
                stdout=out, stderr=subprocess.PIPE, timeout=2700,
            )
        size = os.stat(report_path).st_size
        if size == 0 or size > 256 * 1024 * 1024:
            raise RuntimeError(f"unexpected verification JSON size: {size} bytes; stderr={proc.stderr.decode(errors='replace')[-2000:]}")
        with open(report_path, encoding="utf-8") as f:
            report = json.load(f)
        if not isinstance(report, dict):
            raise RuntimeError("verification result is not a JSON object")
        return report, proc.returncode, report_path
    except Exception:
        # Keep a usable diagnostics file, mode 0600, on JSON/command failures.
        print(f"Full diagnostic output (private): {report_path}", file=sys.stderr)
        raise


def issue_summary(report: dict) -> tuple[dict, list[dict], list[dict]]:
    for k in CATEGORIES:
        if report.get(k) is not None and not isinstance(report[k], list):
            raise RuntimeError(f"strict report field {k} is not an array")
    counts = {k: len(report.get(k) or []) for k in CATEGORIES}
    missing = report.get("missing") or []
    permission = []
    other = []
    for obj in missing:
        reason = str(obj.get("reason", ""))
        if "permission denied" in reason.lower():
            permission.append(obj)
        else:
            other.append(obj)
    print(json.dumps({
        "counts": counts,
        "missing_reasons": {"permission_denied": len(permission), "other": len(other)},
        "missing_examples": missing[:5],
        "size_examples": (report.get("size_mismatches") or [])[:3],
        "duplicate_examples": (report.get("duplicate_references") or [])[:3],
        "content_examples": (report.get("content_reference_mismatches") or [])[:3],
        "orphan_examples": (report.get("orphans") or [])[:3],
        "hash_examples": (report.get("hash_mismatches") or [])[:3],
    }, ensure_ascii=False, indent=2))
    return counts, permission, other


def checked_parts(key: str) -> tuple[str, ...]:
    if not isinstance(key, str):
        raise RuntimeError("storage key is not a string")
    parts = tuple(key.split("/"))
    if len(parts) < 2 or parts[0] != ALLOWED_USER or any(p in ("", ".", "..") or "\x00" in p for p in parts):
        raise RuntimeError(f"storage key outside numeric user {ALLOWED_USER} or invalid: {key!r}")
    return parts


def collect_file_access_changes(data: str, permission: list[dict], uid: int, gid: int):
    """Metadata preflight, read-only. No symlink traversal or cross-device access."""
    data_fd = os.open(data, FLAGS_DIR)
    updates = {}
    try:
        device = os.fstat(data_fd).st_dev
        for item in permission:
            key = item.get("storage_key")
            parts = checked_parts(key)
            parent = os.dup(data_fd)
            try:
                for idx, segment in enumerate(parts):
                    last = idx == len(parts) - 1
                    fd = os.open(segment, FLAGS_FILE if last else FLAGS_DIR, dir_fd=parent)
                    os.close(parent)
                    parent = fd
                    info = os.fstat(parent)
                    if info.st_dev != device:
                        raise RuntimeError(f"unexpected nested mount for {key!r}")
                    if last:
                        if not stat.S_ISREG(info.st_mode):
                            raise RuntimeError(f"referenced path is not a regular file: {key!r}")
                        if info.st_nlink != 1:
                            raise RuntimeError(f"referenced file has multiple hard links: {key!r}")
                        expected = item.get("expected_size")
                        if not isinstance(expected, int) or info.st_size != expected:
                            raise RuntimeError(f"referenced file size differs from metadata: {key!r}")
                    elif not stat.S_ISDIR(info.st_mode):
                        raise RuntimeError(f"non-directory ancestor: {key!r}")
                    needs_owner = (info.st_uid != uid or info.st_gid != gid)
                    needed = stat.S_IRUSR if last else stat.S_IRWXU
                    needs_mode = (info.st_mode & needed) != needed
                    if needs_owner or needs_mode:
                        full_key = "/".join(parts[:idx+1])
                        updates[full_key] = {
                            "parts": parts[:idx+1], "directory": not last,
                            "old_uid": info.st_uid, "old_gid": info.st_gid,
                            "old_mode": stat.S_IMODE(info.st_mode),
                            "old_device": info.st_dev, "old_inode": info.st_ino,
                            "old_size": info.st_size, "old_nlink": info.st_nlink,
                            "need_owner": needs_owner, "need_mode": needs_mode,
                        }
            finally:
                os.close(parent)
    finally:
        os.close(data_fd)
    if not updates:
        raise RuntimeError("permission errors were reported, but POSIX owner/read modes look correct; refusing ACL/LSM blind repair")
    return updates


def apply_file_access_changes(data: str, updates: dict, uid: int, gid: int) -> None:
    data_fd = os.open(data, FLAGS_DIR)
    try:
        device = os.fstat(data_fd).st_dev
        for key in sorted(updates, key=lambda s: (s.count("/"), s)):
            update = updates[key]
            parent = os.dup(data_fd)
            try:
                for idx, segment in enumerate(update["parts"]):
                    last = idx == len(update["parts"]) - 1
                    fd = os.open(segment, (FLAGS_DIR if (not last or update["directory"]) else FLAGS_FILE), dir_fd=parent)
                    os.close(parent)
                    parent = fd
                info = os.fstat(parent)
                if info.st_dev != device or info.st_dev != update["old_device"] or info.st_ino != update["old_inode"]:
                    raise RuntimeError(f"device or inode changed during repair: {key!r}")
                if not (stat.S_ISDIR(info.st_mode) if update["directory"] else stat.S_ISREG(info.st_mode)):
                    raise RuntimeError(f"path type changed during repair: {key!r}")
                if info.st_nlink != update["old_nlink"]:
                    raise RuntimeError(f"link count changed during repair: {key!r}")
                if not update["directory"] and (info.st_nlink != 1 or info.st_size != update["old_size"]):
                    raise RuntimeError(f"file link count or size changed during repair: {key!r}")
                if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (update["old_uid"], update["old_gid"], update["old_mode"]):
                    raise RuntimeError(f"file permissions changed concurrently: {key!r}")
                if update["need_owner"]:
                    os.fchown(parent, uid, gid)
                if update["need_mode"]:
                    bits = stat.S_IRWXU if update["directory"] else stat.S_IRUSR
                    os.fchmod(parent, stat.S_IMODE(os.fstat(parent).st_mode) | bits)
            finally:
                os.close(parent)
    finally:
        os.close(data_fd)


def main():
    arg = argparse.ArgumentParser(description="Read-only Gen10 storage diagnosis; optionally fix ONLY confirmed read-denied /data/1 references")
    arg.add_argument("--apply-permissions", action="store_true", help="explicitly authorize scoped permission-only repair; default diagnoses without writes")
    opts = arg.parse_args()
    data = inspect_environment(opts.apply_permissions)
    print("Checking strict verification using the existing Server; this may scan many files...", flush=True)
    report, rc, report_file = read_strict_report()
    print(f"Strict verification exit={rc}; report={report_file}")
    counts, permission, other = issue_summary(report)
    other_counts = sum(counts[k] for k in CATEGORIES if k != "missing")
    if rc == 0 and sum(counts.values()) == 0:
        print("PASS: strict verification has no actionable inconsistencies")
        return 0
    if not opts.apply_permissions:
        print("DRY-RUN ONLY: no metadata changed. Pass --apply-permissions only for a permissions-only report.")
        return 2
    if other or other_counts or not permission:
        print("REFUSED: report contains non-permission issues (or no matching permission issues). No data changed.")
        return 3
    changes = collect_file_access_changes(data, permission, EXPECTED_UID, EXPECTED_GID)
    print(f"Scoped permission metadata changes planned: {len(changes)}")
    for key, change in list(changes.items())[:10]:
        print("  ", key, "directory" if change["directory"] else "file",
              f"owner={change['old_uid']}:{change['old_gid']} mode={change['old_mode']:04o}")
    apply_file_access_changes(data, changes, EXPECTED_UID, EXPECTED_GID)
    print("APPLIED: only inspected directory/file POSIX metadata for referenced /data/1 permission errors.")
    print("Original data contents and CAS were not modified. Run xdrive-server verify --online for full revalidation.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"STOPPED WITHOUT INCONSISTENCY BYPASS: {exc}", file=sys.stderr)
        sys.exit(4)