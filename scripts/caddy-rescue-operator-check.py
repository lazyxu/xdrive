#!/usr/bin/env python3
"""Explicit operator-only LOCAL rescue check. Never grants Caddy apply authority."""
import http.client
import json
import pathlib
import re
import subprocess
import sys


class Unsafe(Exception):
    pass


def need(condition, reason):
    if not condition:
        raise Unsafe(reason)


def observe(*args):
    # Only static Docker reads. Suppress ALL raw output and errors on failure.
    try:
        p = subprocess.run(["docker", *args], text=True, capture_output=True,
                           timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Unsafe("Docker observation unavailable") from None
    need(p.returncode == 0 and len(p.stdout) <= 262144,
         "Docker read-only observation failed")
    return p.stdout.strip()


def object_json(*args):
    try:
        return json.loads(observe(*args))
    except ValueError:
        raise Unsafe("Malformed Docker observation") from None


def only_container(name):
    data = object_json("inspect", "--type", "container", name)
    need(isinstance(data, list) and len(data) == 1 and isinstance(data[0], dict),
         "Container identity not unique")
    return data[0]


def get(obj, *keys):
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def http_code(port, route):
    # Direct loopback, no proxy, bearer token, cookies or response body logging.
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        c.request("GET", route, headers={"Host": "127.0.0.1"})
        return c.getresponse().status
    except (OSError, TimeoutError, http.client.HTTPException):
        raise Unsafe("Local rescue HTTP unavailable") from None
    finally:
        c.close()


def check():
    need(len(sys.argv) == 3, "usage: operator-check ENV_FILE COMPOSE_FILE")
    envfile, composefile = (pathlib.Path(s) for s in sys.argv[1:])
    need(envfile.is_file() and composefile.is_file(), "Deployment files missing")
    base = ("compose", "--env-file", str(envfile), "-f", str(composefile),
            "--profile", "caddy-rescue")
    service = get(object_json(*base, "config", "--format", "json"),
                  "services", "caddy-rescue")
    need(isinstance(service, dict) and service.get("profiles") == ["caddy-rescue"],
         "Rescue must be operator opt-in")
    ref = service.get("image")
    need(isinstance(ref, str) and re.fullmatch(
         r"[a-z0-9][a-z0-9./:_-]{2,180}@sha256:[0-9a-f]{64}", ref),
         "A digest-pinned separate rescue image is required")
    need(service.get("environment") == {
         "XDG_CONFIG_HOME": "/tmp/caddy-rescue-config",
         "XDG_DATA_HOME": "/tmp/caddy-rescue-data"},
         "Rescue desired environment is not isolated")
    ports = service.get("ports")
    need(isinstance(ports, list) and len(ports) == 1
         and ports[0].get("host_ip") == "127.0.0.1"
         and ports[0].get("target") == 8080
         and ports[0].get("protocol") == "tcp",
         "Rescue desired port is not loopback-only")
    port_s = str(ports[0].get("published", ""))
    need(port_s.isdigit() and 1024 <= int(port_s) <= 65535,
         "Rescue port is not an unprivileged port")
    ids = observe(*base, "ps", "-q", "caddy-rescue").splitlines()
    need(len(ids) == 1 and re.fullmatch(r"[0-9a-f]{12,64}", ids[0]),
         "Rescue runtime container is ambiguous or absent")
    rescue, primary = only_container(ids[0]), only_container("xdrive-caddy")
    need(rescue.get("Name") == "/xdrive-caddy-rescue"
         and get(rescue, "Config", "Labels", "com.docker.compose.service") == "caddy-rescue"
         and get(primary, "Config", "Labels", "com.docker.compose.service") == "caddy",
         "Container names or Compose roles mismatch")
    project = get(rescue, "Config", "Labels", "com.docker.compose.project")
    need(isinstance(project, str) and bool(project)
         and project == get(primary, "Config", "Labels", "com.docker.compose.project"),
         "Rescue and primary deployment project mismatch")
    need(get(rescue, "State", "Running") is True
         and get(rescue, "State", "Health", "Status") == "healthy",
         "Rescue runtime is not healthy")
    image = object_json("image", "inspect", ref)
    need(isinstance(image, list) and len(image) == 1
         and isinstance(image[0], dict) and ref in (image[0].get("RepoDigests") or [])
         and rescue.get("Image") == image[0].get("Id")
         and get(rescue, "Config", "Image") == ref,
         "Digest-pinned image identity mismatch")
    need(rescue.get("Image") != primary.get("Image"),
         "Rescue is not a distinct immutable image from primary")
    host = rescue.get("HostConfig")
    need(isinstance(host, dict) and host.get("ReadonlyRootfs") is True
         and host.get("Privileged") is False
         and host.get("CapAdd") in (None, [])
         and [str(s).upper() for s in (host.get("CapDrop") or [])] == ["ALL"]
         and "no-new-privileges" in " ".join(host.get("SecurityOpt") or []),
         "Rescue privileged isolation failed")
    user = get(rescue, "Config", "User")
    need(isinstance(user, str) and re.fullmatch(r"[1-9][0-9]*:[1-9][0-9]*", user)
         and user == service.get("user"),
         "Rescue must use a nonroot UID:GID")
    need(rescue.get("Mounts") == [] and host.get("NetworkMode") not in ("host", "none", None, ""),
         "Rescue data mounts or network mode are unsafe")
    tmpfs = host.get("Tmpfs")
    opts = tmpfs.get("/tmp") if isinstance(tmpfs, dict) else None
    need(isinstance(opts, str) and
         all(a in opts.split(",") for a in ("rw", "nosuid", "nodev", "noexec")),
         "Rescue tmpfs lacks safety restrictions")
    env = get(rescue, "Config", "Env")
    bad_key = re.compile("ALIYUN|AWS|AZURE|GCP|POSTGRES|DATABASE|PASSWORD|SECRET|TOKEN|CREDENTIAL|JWT|DSN|ACCESS_KEY", re.I)
    need(isinstance(env, list)
         and all(isinstance(e, str) and "=" in e for e in env)
         and not any(bad_key.search(e.split("=", 1)[0]) for e in env),
         "Rescue runtime environment contains untrusted keys")
    bound = get(rescue, "NetworkSettings", "Ports")
    need(isinstance(bound, dict)
         and all(p in (None, []) for k, p in bound.items() if k != "8080/tcp")
         and bound.get("8080/tcp") == [{
             "HostIp": "127.0.0.1", "HostPort": port_s}],
         "Actual Docker port is not exclusively 127.0.0.1")
    port = int(port_s)
    need(http_code(port, "/api/v1/readyz") == 200,
         "Rescue local HTTP health check failed")
    need(http_code(port, "/api/v1/admin/services") == 401,
         "Anonymous admin access was not denied")
    print("rescue-local-isolated: observed")
    print("rescue-image-digest: matched-local (signature/provenance unverified)")
    print("rescue-anonymous-admin: denied")
    print("operator-ssh-and-authenticated-outage-access: unverified")
    print("caddy-apply-stop-restart: blocked")


if __name__ == "__main__":
    try:
        check()
    except Unsafe as err:
        print("rescue-operator-preflight: blocked (" + str(err) + ")", file=sys.stderr)
        sys.exit(1)
