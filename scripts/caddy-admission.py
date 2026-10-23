#!/usr/bin/env python3
"""Host-only no-follow, single-admission Caddy queue claim.

The Server and this helper use the same fixed flock inode. A malicious or
unsafe file leaves the operation fenced; it never authorizes Docker changes.
"""
import fcntl
import os
import stat
import sys
from pathlib import Path

LOCK = "caddy-env-admission.lock"
REQUEST = "caddy-env-request.json"
ACTIVE = "caddy-env-active.json"

def regular(rootfd: int, name: str) -> bool:
    try:
        s = os.stat(name, dir_fd=rootfd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
        raise ValueError("unsafe-caddy-admission-inode")
    return True

def claim() -> bool:
    root = Path(os.environ["XD_CADDY_CONTROL_DIR"])
    if not root.is_absolute() or root.is_symlink():
        raise ValueError("unsafe-controller-directory")
    d = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o660, dir_fd=d)
        try:
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
                raise ValueError("unsafe-admission-lock")
            os.fchmod(fd, 0o660)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
            if regular(d, ACTIVE):
                if regular(d, REQUEST):
                    os.unlink(REQUEST, dir_fd=d)
                    os.fsync(d)
                return False
            if not regular(d, REQUEST):
                return False
            if os.stat(REQUEST, dir_fd=d, follow_symlinks=False).st_size > 4096:
                raise ValueError("oversized-caddy-request")
            # link is O_EXCL with respect to Active; a crash after link but
            # before unlink leaves a recoverable Active, never a lost request.
            os.link(REQUEST, ACTIVE, src_dir_fd=d, dst_dir_fd=d,
                    follow_symlinks=False)
            os.fsync(d)
            os.unlink(REQUEST, dir_fd=d)
            os.fsync(d)
            return True
        finally:
            os.close(fd)
    finally:
        os.close(d)

if __name__ == "__main__":
    if sys.argv[1:] != ["claim"]:
        sys.exit(2)
    try:
        sys.exit(0 if claim() else 1)
    except (OSError, ValueError, KeyError):
        sys.exit(2)
