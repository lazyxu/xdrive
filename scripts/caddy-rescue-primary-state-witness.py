#!/usr/bin/env python3
"""Operator-only READ-ONLY local primary-Caddy state witness.

PHASE is independently observed before/during/after an OUTSIDE-supervised
Caddy maintenance operation. This script NEVER changes the deployment and
does not prove SSH administrator continuity or public TLS restoration.
"""
import json
from pathlib import Path
import re
import subprocess
import sys


class Blocked(Exception):
    pass


def need(ok, reason):
    if not ok:
        raise Blocked(reason)


STAGES = ("before", "primary-down", "restored")
CONTAINERS = ("xdrive-caddy", "xdrive-server", "xdrive-caddy-rescue")


def inspect(name):
    need(name in CONTAINERS, "Unrecognized fixed container")
    # Only literal Docker read-only inspect. Never log raw Docker responses.
    try:
        proc = subprocess.run(
            ["docker", "inspect", "--type", "container", name],
            capture_output=True, timeout=12, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Fixed container observation unavailable") from None
    need(proc.returncode == 0 and len(proc.stdout) <= 262144,
         "Fixed container inspection failed")
    try:
        rows = json.loads(proc.stdout)
    except (ValueError, UnicodeError):
        raise Blocked("Malformed container observation") from None
    need(isinstance(rows, list) and len(rows) == 1
         and isinstance(rows[0], dict), "Ambiguous container observation")
    return rows[0]


def path(obj, *keys):
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def observed(name, spec):
    need(spec.get("Name") == "/" + name
         and bool(re.fullmatch(r"[0-9a-f]{64}", str(spec.get("Id", ""))))
         and bool(re.fullmatch(r"sha256:[0-9a-f]{64}", str(spec.get("Image", "")))),
         "Container identity not verifiable")
    role = {"xdrive-caddy": "caddy", "xdrive-server": "server",
            "xdrive-caddy-rescue": "caddy-rescue"}[name]
    need(path(spec, "Config", "Labels", "com.docker.compose.service") == role,
         "Container Compose service role mismatch")
    project = path(spec, "Config", "Labels", "com.docker.compose.project")
    need(isinstance(project, str) and len(project) > 0,
         "Container Compose project not observed")
    state = spec.get("State")
    need(isinstance(state, dict) and isinstance(state.get("Running"), bool)
         and isinstance(state.get("Restarting"), bool),
         "Docker running/restart state unavailable")
    started = state.get("StartedAt")
    need(isinstance(started, str) and re.match(r"20[0-9]{2}-", started),
         "Container has no positive prior start evidence")
    return project


def enforce(phase, samples):
    primary, server, rescue = (samples[name] for name in CONTAINERS)
    projects = [observed(n, samples[n]) for n in CONTAINERS]
    need(len(set(projects)) == 1,
         "Containers are not from one fixed Compose project")
    for instance, label in ((server, "Server"), (rescue, "Rescue")):
        s = instance["State"]
        need(s.get("Running") is True and s.get("Restarting") is False
             and s.get("Status") == "running"
             and path(s, "Health", "Status") == "healthy",
             label + " did not remain healthy")
    current = primary["State"]
    if phase == "primary-down":
        need(current.get("Running") is False
             and current.get("Restarting") is False
             and current.get("Status") == "exited"
             and isinstance(current.get("FinishedAt"), str)
             and re.match(r"20[0-9]{2}-", current["FinishedAt"]),
             "Primary Caddy is not positively observed stopped")
    else:
        need(current.get("Running") is True
             and current.get("Restarting") is False
             and current.get("Status") == "running"
             and path(current, "Health", "Status") == "healthy",
             "Primary Caddy is not positively observed healthy")


def stable(first, second):
    # Fence process generation and CURRENT state, not rolling Docker
    # Health.Log timestamps. A routine successful healthcheck may append
    # history between samples without any process replacement or failure.
    for name in CONTAINERS:
        a, b = first[name], second[name]
        sa, sb = a["State"], b["State"]
        generation = ("Running", "Restarting", "Status",
                      "StartedAt", "FinishedAt")
        need(a.get("Id") == b.get("Id")
             and a.get("Image") == b.get("Image")
             and a.get("Config", {}).get("Labels")
                 == b.get("Config", {}).get("Labels")
             and all(sa.get(key) == sb.get(key) for key in generation)
             and path(sa, "Health", "Status") == path(sb, "Health", "Status"),
             "Container generation or lifecycle changed during observation")


def check():
    need(len(sys.argv) == 4 and sys.argv[1] in STAGES,
         "Usage: primary-state-witness.py before|primary-down|restored ENV_FILE COMPOSE_FILE")
    phase = sys.argv[1]
    env_file, compose_file = [Path(s) for s in sys.argv[2:]]
    need(env_file.is_file() and compose_file.is_file(),
         "Trusted deployment files are missing")

    first = {name: inspect(name) for name in CONTAINERS}
    enforce(phase, first)
    # Reuse the already tested C03b2b3c3a operator-local observer: current
    # pinned distinct rescue image, private port, isolation, HTTP 200/401.
    # It does not require primary to be running. Capture (never relay) output.
    command = [
        sys.executable, str(Path(__file__).with_name(
            "caddy-rescue-operator-check.py")),
        str(env_file), str(compose_file),
    ]
    try:
        verified = subprocess.run(
            command, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=65, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Independent rescue preflight unavailable") from None
    need(verified.returncode == 0 and len(verified.stdout) <= 8192,
         "Independent rescue local preflight did not pass")

    second = {name: inspect(name) for name in CONTAINERS}
    enforce(phase, second)
    stable(first, second)
    print("primary-caddy-observed-phase: " + phase)
    print("server-and-rescue-same-project: healthy")
    print("rescue-loopback-and-anonymous-denial: independently-checked")
    print("cross-phase-primary-generation: unverified")
    print("off-host-ssh-admin-while-primary-down: unverified")
    print("approved-image-publisher-provenance: unverified")
    print("public-https-and-caddy-apply-rollback: blocked")


if __name__ == "__main__":
    try:
        check()
    except Blocked as exc:
        print("rescue-primary-state-witness: blocked (" +
              str(exc) + ")", file=sys.stderr)
        sys.exit(1)
