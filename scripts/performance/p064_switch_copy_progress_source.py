#!/usr/bin/env python3
"""Source-exact original-vs-proposed-product Go and regression test switch."""
import hashlib
import subprocess
import sys
from pathlib import Path
SOURCES = {
    "internal/api/file_operations.go": "338abf54deede6a86b8b41f97494f3e7fedbd908",
    "internal/api/file_operation_progress_performance_integration_test.go":
        "d1f856f8b1e711e8bbc3129bf9bc03dcde2cdf9f",
}
def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\x00" + data).hexdigest()
if len(sys.argv) != 2 or sys.argv[1] not in ("original", "candidate"):
    raise SystemExit("P064 use original or candidate")
for name, expected in SOURCES.items():
    before = subprocess.check_output(["git", "show", "HEAD^:" + name])
    assert blob_sha(before) == expected, "original source SHA mismatch: " + name
    after = subprocess.check_output(["git", "show", "HEAD:" + name])
    assert after != before, "candidate did not change: " + name
    Path(name).write_bytes(before if sys.argv[1] == "original" else after)
