#!/usr/bin/env python3
"""Host-side release cache worker. This is not the client download endpoint."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SHA = re.compile(r"[a-f0-9]{40}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._+-]{0,180}\Z")
PLATFORMS = {"ios", "android", "windows", "linux", "dsm", "cli"}


def validate(manifest):
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise ValueError("unsupported manifest schema")
    if not isinstance(manifest.get("commit"), str) or not SHA.fullmatch(manifest["commit"]):
        raise ValueError("exact 40-character lowercase commit SHA required")
    if not isinstance(manifest.get("artifacts"), list):
        raise ValueError("artifacts must be a list")
    seen = set()
    for artifact in manifest["artifacts"]:
        if not isinstance(artifact, dict) or artifact.get("platform") not in PLATFORMS:
            raise ValueError("invalid platform")
        name = artifact.get("filename")
        if not isinstance(name, str) or not NAME.fullmatch(name) or name in seen:
            raise ValueError("unsafe or duplicate artifact filename")
        seen.add(name)
        digest = artifact.get("sha256")
        size = artifact.get("size")
        if not isinstance(digest, str) or not HASH.fullmatch(digest):
            raise ValueError("invalid sha256")
        if type(size) is not int or size <= 0:
            raise ValueError("invalid artifact size")
        sources = artifact.get("sources")
        if not isinstance(sources, dict) or set(sources) != {"gitlab", "github"}:
            raise ValueError("both GitLab and GitHub fallback sources are required")
        for source, url in sources.items():
            parsed = urlsplit(url) if isinstance(url, str) else None
            if not parsed or parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
                raise ValueError("invalid artifact source")
            if source == "github" and (parsed.scheme != "https" or parsed.hostname not in {"github.com", "objects.githubusercontent.com"}):
                raise ValueError("GitHub source must be HTTPS GitHub")
    return manifest


def atomic_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".bundle-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as out:
            json.dump(obj, out, sort_keys=True, indent=2)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def fetch(url, output, expected_size, expected_hash, dependency_busy):
    digest = hashlib.sha256()
    count = 0
    with urlopen(Request(url, headers={"User-Agent": "xDrive-ReleaseBundle/1"}), timeout=25) as response, output.open("wb") as target:
        if response.status != 200:
            raise ValueError("unexpected HTTP status")
        while True:
            # Dependency download takes priority even when an artifact transfer is underway.
            if dependency_busy.exists():
                raise InterruptedError("server dependencies require bandwidth")
            chunk = response.read(min(1024 * 1024, max(1, expected_size - count + 1)))
            if not chunk:
                break
            count += len(chunk)
            if count > expected_size:
                raise ValueError("artifact larger than manifest")
            digest.update(chunk)
            target.write(chunk)
        target.flush()
        os.fsync(target.fileno())
    if count != expected_size or digest.hexdigest() != expected_hash:
        raise ValueError("artifact checksum or byte length mismatch")


def sync(manifest_path, cache, dependency_busy, retries=2):
    manifest = validate(json.loads(manifest_path.read_text(encoding="utf8")))
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / ".lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        commit = manifest["commit"]
        staging = cache / (".staging-" + commit)
        staging.mkdir(exist_ok=True)
        status = {"commit": commit, "state": "syncing", "artifacts": {}}
        atomic_json(cache / "status.json", status)
        failed = []
        for artifact in manifest["artifacts"]:
            name = artifact["filename"]
            destination = staging / name
            if destination.exists() and destination.stat().st_size == artifact["size"]:
                with destination.open("rb") as previous:
                    if hashlib.file_digest(previous, "sha256").hexdigest() == artifact["sha256"]:
                        status["artifacts"][name] = "verified"
                        continue
            success = False
            for origin in ("gitlab", "github"):
                for attempt in range(retries):
                    while dependency_busy.exists():
                        time.sleep(2)
                    try:
                        fetch(artifact["sources"][origin], destination, artifact["size"], artifact["sha256"], dependency_busy)
                        success = True
                        break
                    except InterruptedError:
                        destination.unlink(missing_ok=True)
                        # Paused downloads restart after dependencies finish.
                        while dependency_busy.exists():
                            time.sleep(2)
                    except Exception:
                        destination.unlink(missing_ok=True)
                        if attempt + 1 < retries:
                            time.sleep(min(2 ** attempt, 8))
                if success:
                    break
            status["artifacts"][name] = "verified" if success else "failed"
            if not success:
                failed.append(name)
            atomic_json(cache / "status.json", status)
        if failed:
            status["state"] = "partial_failure"
            atomic_json(cache / "status.json", status)
            return 1
        atomic_json(staging / "manifest.json", manifest)
        current, previous = cache / "current", cache / ".previous"
        if previous.exists():
            shutil.rmtree(previous)
        if current.exists():
            os.replace(current, previous)
        os.replace(staging, current)
        if previous.exists():
            shutil.rmtree(previous)
        status["state"] = "ready"
        atomic_json(cache / "status.json", status)
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--dependency-busy-file", required=True, type=Path)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.retries <= 5:
        parser.error("--retries must be between 1 and 5")
    try:
        return sync(args.manifest, args.cache_dir, args.dependency_busy_file, args.retries)
    except Exception as exc:
        print(f"Release cache failed; server upgrade unaffected: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
