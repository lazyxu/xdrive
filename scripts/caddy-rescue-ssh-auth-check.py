#!/usr/bin/env python3
"""Explicit operator-only SSH stdio-forward rescue login check, no host actions.

Requires a trusted, previously pinned OpenSSH known_hosts file. The SSH -W
transport reaches only the rescue port on the remote host's localhost.
Never use this as a Caddy Apply/Stop/Restart or production rollback receipt.
"""
import getpass
import http.client
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import time


class Blocked(Exception):
    pass


def require(ok, reason):
    if not ok:
        raise Blocked(reason)


MAX_HTTP = 65536
EXPECTED = frozenset((
    "database", "storage", "background-worker", "caddy", "media-worker",
    "photo-face", "photo-smart", "photo-semantic", "photo-creative",
    "baidu-map", "geonames",
))


def ssh_command(target, hosts, ssh_port, rescue_port):
    # No inherited SSH config or master-socket reuse, no remote shell command,
    # no agent forwarding, SSH host key MUST be previously pinned and checked.
    return [
        "ssh", "-F", "/dev/null", "-N", "-T",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "UpdateHostKeys=no",
        "-o", "GlobalKnownHostsFile=/dev/null",
        "-o", "UserKnownHostsFile=" + str(hosts),
        "-o", "ControlMaster=no",
        "-o", "ControlPath=none",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ForwardAgent=no",
        "-o", "ForwardX11=no",
        "-o", "PermitLocalCommand=no",
        "-o", "ProxyCommand=none",
        "-o", "ConnectTimeout=8",
        "-p", str(ssh_port),
        "-W", "127.0.0.1:" + str(rescue_port),
        "--", target,
    ]


def read_bounded_reply(process):
    # Bounded receipt through the process-owned SSH stdio channel (no local
    # listener to be impersonated, no raw SSH diagnostics in logs).
    poller = selectors.DefaultSelector()
    poller.register(process.stdout, selectors.EVENT_READ)
    data = bytearray()
    deadline = time.monotonic() + 12
    try:
        while True:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "Rescue SSH response timed out")
            require(bool(poller.select(remaining)), "Rescue SSH response unavailable")
            chunk = os.read(process.stdout.fileno(), 8192)
            if not chunk:
                break
            data.extend(chunk)
            require(len(data) <= MAX_HTTP, "Rescue SSH response exceeded size limit")
    finally:
        poller.close()
    require(process.wait(timeout=2) == 0,
            "SSH rescue channel did not close normally")
    return bytes(data)


def decode_chunked(body):
    output = bytearray()
    pos = 0
    while True:
        end = body.find(b"\r\n", pos)
        require(0 <= end <= pos + 32, "Malformed chunk length")
        try:
            count = int(body[pos:end].split(b";", 1)[0], 16)
        except ValueError:
            raise Blocked("Malformed chunk length") from None
        require(0 <= count <= MAX_HTTP - len(output), "Oversized chunk")
        pos = end + 2
        if count == 0:
            return bytes(output)
        require(len(body) >= pos + count + 2
                and body[pos + count:pos + count + 2] == b"\r\n",
                "Incomplete chunked response")
        output.extend(body[pos:pos + count])
        pos += count + 2


def decode_http(raw):
    marker = raw.find(b"\r\n\r\n")
    require(0 < marker < 8192, "Malformed HTTP response headers")
    head = raw[:marker].split(b"\r\n")
    found = re.fullmatch(rb"HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?", head[0])
    require(found is not None, "Invalid rescue HTTP status")
    headers = {}
    for line in head[1:]:
        require(b":" in line, "Malformed rescue HTTP header")
        key, value = line.split(b":", 1)
        key = key.strip().lower()
        require(key not in headers, "Ambiguous rescue HTTP headers")
        headers[key] = value.strip().lower()
    body = raw[marker + 4:]
    if headers.get(b"transfer-encoding") == b"chunked":
        body = decode_chunked(body)
    elif b"content-length" in headers:
        try:
            n = int(headers[b"content-length"])
        except ValueError:
            raise Blocked("Invalid rescue HTTP length") from None
        require(0 <= n <= MAX_HTTP and len(body) == n,
                "Incomplete or oversized rescue HTTP body")
    require(len(body) <= MAX_HTTP, "Oversized rescue HTTP body")
    return int(found.group(1)), body


def exchange(command, method, route, body=None, token=None):
    require(method in ("GET", "POST") and route in (
        "/api/v1/readyz", "/api/v1/admin/services", "/api/v1/auth/login"),
        "Unsafe rescue route")
    headers = [
        method + " " + route + " HTTP/1.0",
        "Host: 127.0.0.1",
        "Connection: close",
        "Cache-Control: no-store",
        "Accept: application/json",
        "Accept-Encoding: identity",
    ]
    if body is not None:
        require(len(body) <= 4096, "Login payload exceeded limit")
        headers.extend(("Content-Type: application/json",
                        "Content-Length: " + str(len(body))))
    if token is not None:
        require(bool(re.fullmatch(r"[A-Za-z0-9_.-]{20,4096}", token)),
                "Invalid in-memory access token")
        headers.append("Authorization: Bearer " + token)
    payload = ("\r\n".join(headers) + "\r\n\r\n").encode("ascii") + (body or b"")
    try:
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        raise Blocked("Pinned SSH transport unavailable") from None
    try:
        process.stdin.write(payload)
        process.stdin.close()
        return decode_http(read_bounded_reply(process))
    except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
        raise Blocked("Pinned SSH channel failed") from None
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)


def credentials():
    if sys.stdin.isatty():
        username = input("xDrive 管理员用户名：")
        password = getpass.getpass("xDrive 管理员密码（不回显）：")
    else:
        # Explicit piped input is reserved for isolated tests or deliberate
        # operator use. It does not appear in process args or environment.
        username = sys.stdin.readline(130).rstrip("\r\n")
        password = sys.stdin.readline(2050).rstrip("\r\n")
    require(0 < len(username.encode("utf-8")) <= 128
            and not any(ord(c) < 32 for c in username),
            "Invalid administrator username")
    require(0 < len(password.encode("utf-8")) <= 2048
            and not any(ord(c) < 32 for c in password),
            "Invalid administrator credential")
    return username, password


def check():
    require(len(sys.argv) in (4, 5),
            "Usage: caddy-rescue-ssh-auth-check.py USER@HOST PINNED_KNOWN_HOSTS RESCUE_PORT [SSH_PORT]")
    target, hosts_arg, port_arg = sys.argv[1:4]
    require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,252}", target),
            "Invalid fixed SSH target")
    require(port_arg.isdigit() and 1024 <= int(port_arg) <= 65535,
            "Rescue must use an unprivileged remote loopback port")
    ssh_arg = sys.argv[4] if len(sys.argv) == 5 else "22"
    require(ssh_arg.isdigit() and 1 <= int(ssh_arg) <= 65535,
            "Invalid SSH port")
    hosts = Path(hosts_arg).expanduser().resolve()
    require(hosts.is_file(), "Pinned SSH known_hosts file missing")
    meta = hosts.stat()
    require(stat.S_ISREG(meta.st_mode) and meta.st_size > 0
            and not (meta.st_mode & stat.S_IWOTH),
            "Pinned SSH known_hosts file is missing or unsafe")
    command = ssh_command(target, hosts, int(ssh_arg), int(port_arg))

    ready, _ = exchange(command, "GET", "/api/v1/readyz")
    require(ready == 200, "Rescue over pinned SSH is not ready")
    anonymous, _ = exchange(command, "GET", "/api/v1/admin/services")
    require(anonymous == 401, "Rescue anonymous admin access is not denied")
    username, password = credentials()
    login = json.dumps({"username": username, "password": password},
                       separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    del password
    code, body = exchange(command, "POST", "/api/v1/auth/login", body=login)
    require(code == 200, "Rescue operator login failed")
    try:
        session = json.loads(body)
    except ValueError:
        raise Blocked("Rescue login response invalid") from None
    require(isinstance(session, dict) and session.get("role") == "admin"
            and session.get("must_change_password") is not True,
            "Rescue login is not an active administrator")
    token = session.get("access_token")
    require(isinstance(token, str), "Rescue administrator access token unavailable")
    code, result = exchange(command, "GET", "/api/v1/admin/services", token=token)
    del token
    require(code == 200, "Rescue authenticated administrator access denied")
    try:
        snapshot = json.loads(result)
    except ValueError:
        raise Blocked("Rescue administrator inventory malformed") from None
    items = snapshot.get("services") if isinstance(snapshot, dict) else None
    require(isinstance(items, list) and len(items) == len(EXPECTED)
            and all(isinstance(item, dict) and isinstance(item.get("id"), str)
                    for item in items)
            and {item["id"] for item in items} == EXPECTED,
            "Rescue authenticated dependency inventory is not complete")
    print("rescue-ssh-host-key: enforced-by-OpenSSH-pinned-known_hosts")
    print("rescue-independent-ssh-stdio-channel: authenticated-current-session")
    print("rescue-admin-inventory: 11-fixed-services-verified")
    print("real-primary-caddy-outage-and-restoration: unverified")
    print("separately-signed-known-good-rescue-image: unverified")
    print("caddy-apply-stop-restart: blocked")


if __name__ == "__main__":
    try:
        check()
    except (Blocked, UnicodeError) as err:
        print("rescue-ssh-admin-check: blocked (" +
              (str(err) if isinstance(err, Blocked) else "Invalid credential encoding") +
              ")", file=sys.stderr)
        sys.exit(1)
