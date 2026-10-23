#!/usr/bin/env python3
import contextlib
import fcntl
import os
import pathlib
import subprocess
import sys
import tempfile

helper = pathlib.Path(__file__).with_name("caddy-admission.py")
with tempfile.TemporaryDirectory() as tmp:
    d = pathlib.Path(tmp)
    env = {**os.environ, "XD_CADDY_CONTROL_DIR": tmp}
    def run():
        return subprocess.run([sys.executable, str(helper), "claim"], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).returncode
    assert run() == 1
    (d / "caddy-env-request.json").write_text('{"request_id":"0123456789abcdef01234567"}')
    lock = os.open(d / "caddy-env-admission.lock", os.O_RDWR | os.O_CREAT, 0o660)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert run() == 1
    assert (d / "caddy-env-request.json").exists()
    fcntl.flock(lock, fcntl.LOCK_UN)
    os.close(lock)
    assert run() == 0
    assert not (d / "caddy-env-request.json").exists()
    assert (d / "caddy-env-active.json").exists()
    # The Server creates a private temp inode then publishes via hard link.
    # It MUST remove that temporary sibling before the Host's strict nlink
    # check. A lingering sibling is intentionally rejected, not claimed.
    (d / "caddy-env-active.json").unlink()
    staging = d / ".caddy-env-request-temp"
    staging.write_text('{"request_id":"010101010101010101010101"}')
    os.link(staging, d / "caddy-env-request.json")
    assert run() == 2
    assert not (d / "caddy-env-active.json").exists()
    staging.unlink()
    assert run() == 0
    assert (d / "caddy-env-active.json").exists()
    assert not (d / "caddy-env-request.json").exists()

    (d / "caddy-env-request.json").write_text('{"request_id":"abcdefabcdefabcdefabcdef"}')
    assert run() == 1
    assert not (d / "caddy-env-request.json").exists()
    (d / "caddy-env-active.json").unlink()
    (d / "caddy-env-admission.lock").unlink()
    outside = d / "outside"
    (d / "caddy-env-admission.lock").symlink_to(outside)
    (d / "caddy-env-request.json").write_text("{}")
    assert run() == 2
    assert not outside.exists()
    assert not (d / "caddy-env-active.json").exists()
print("caddy-admission: passed")
