#!/usr/bin/env python3
"""Noncritical host Release Bundle worker; never participates in server rollback.

The immutable full-commit manifest is retained, while only the current
verified bundle's package bytes survive successful promotion. The host's
install.lock always outranks network transfers, including active streams.
"""
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
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

SHA = re.compile(r"[a-f0-9]{40}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,180}\Z")
PLATFORMS = {"ios", "android", "windows", "linux", "dsm", "cli"}
MAX_MANIFEST = 2 * 1024 * 1024
MAX_PACKAGE = 8 * 1024 * 1024 * 1024
GITHUB_BASE = "https://github.com/lazyxu/xdrive/releases/download/"
GITLAB_BASE = (
    "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive"
    "/packages/generic/xdrive-build-packages/sha-"
)


def _valid_source(url, source, sha, filename, allow_local=False):
    if not isinstance(url, str) or len(url) > 1500:
        return False
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    if allow_local and parsed.scheme == "http" and parsed.hostname == "127.0.0.1":
        return True
    expected = (GITHUB_BASE + "bundle-" + sha + "/" + quote(filename) if source == "github"
                else GITLAB_BASE + sha + "/" + quote(filename))
    return url == expected


def validate(manifest, expected_commit=None, allow_local=False):
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise ValueError("unsupported manifest schema")
    sha = manifest.get("commit")
    if not isinstance(sha, str) or not SHA.fullmatch(sha) or (expected_commit and sha != expected_commit):
        raise ValueError("manifest commit must match exact 40-character source commit")
    if manifest.get("channel") not in (None, "master", "stable"):
        raise ValueError("unsupported release channel")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) > 30:
        raise ValueError("invalid artifact list")
    seen = set()
    for item in artifacts:
        if not isinstance(item, dict) or item.get("platform") not in PLATFORMS:
            raise ValueError("invalid platform")
        name = item.get("filename")
        if not isinstance(name, str) or not NAME.fullmatch(name) or name in seen:
            raise ValueError("unsafe or duplicate artifact filename")
        seen.add(name)
        digest, size = item.get("sha256"), item.get("size")
        if not isinstance(digest, str) or not HASH.fullmatch(digest):
            raise ValueError("invalid sha256")
        if type(size) is not int or not 0 < size <= MAX_PACKAGE:
            raise ValueError("invalid artifact size")
        if item.get("build_commit", sha) != sha:
            raise ValueError("artifact was built from another commit")
        if item.get("install_mode", "manual") not in ("manual", "manual_test_only"):
            raise ValueError("invalid installation mode")
        if item["platform"] == "android" and (
            item.get("install_mode") != "manual" or
            not re.fullmatch(r"xdrive-android-[1-9][0-9]{0,9}-[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}\.apk", name)
        ):
            raise ValueError("only approved fixed-key signed Android APKs may enter bundles")
        sources = item.get("sources")
        if not isinstance(sources, dict) or set(sources) != {"gitlab", "github"}:
            raise ValueError("both trusted fallback origins required")
        for source, url in sources.items():
            if not _valid_source(url, source, sha, name, allow_local):
                raise ValueError("untrusted artifact download origin")
    return manifest


def _atomic_json(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".atomic-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(record, output, sort_keys=True, separators=(",", ":"))
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temp, 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _digest(path):
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as inp:
        while block := inp.read(1024 * 1024):
            sha.update(block)
            size += len(block)
    return size, sha.hexdigest()


def _install_busy(lock_path, marker=None):
    if marker is not None and marker.exists():
        return True
    if lock_path is None:
        return False
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(file, fcntl.LOCK_UN)
        return False


def _wait_for_dependencies(lock_path, marker=None):
    while _install_busy(lock_path, marker):
        time.sleep(1)


class SafeRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        github = parsed.scheme == "https" and parsed.hostname in {
            "github.com", "release-assets.githubusercontent.com",
            "objects.githubusercontent.com", "api.github.com"
        }
        gitlab = (parsed.scheme == "http" and parsed.hostname == "gitlab.t-fluid.com"
                  and parsed.port == 1080 and parsed.path.startswith(
                      "/api/v4/projects/xuliang%2Fxdrive/packages/generic/"))
        if parsed.username or parsed.password or parsed.fragment or not (github or gitlab):
            raise ValueError("untrusted package redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = build_opener(SafeRedirect)


def _download(url, path, size, digest, lock_path, marker=None):
    partial = path.with_name(path.name + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > size:
        partial.unlink()
        offset = 0
    if offset == size:
        if _digest(partial) == (size, digest):
            os.chmod(partial, 0o644)
            os.replace(partial, path)
            return
        # A fully downloaded but corrupted .part must not cause endless 416
        # range requests, or be re-used with bytes from another origin.
        partial.unlink()
        offset = 0
    headers = {"User-Agent": "xDrive-ReleaseBundle/1"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    _wait_for_dependencies(lock_path, marker)
    with OPENER.open(Request(url, headers=headers), timeout=25) as response:
        status = response.status
        if status == 206:
            actual_range = response.headers.get("Content-Range", "")
            if not actual_range.startswith(f"bytes {offset}-") or not actual_range.endswith(f"/{size}"):
                raise ValueError("invalid range response")
            mode = "ab"
        elif status == 200:
            mode = "wb"
            offset = 0
        else:
            raise ValueError("unexpected download status")
        count = offset
        with partial.open(mode) as output:
            while True:
                if _install_busy(lock_path, marker):
                    # Keep verified partial bytes for HTTP Range resume.
                    raise InterruptedError("server dependency download is running")
                block = response.read(min(1024 * 1024, size - count + 1))
                if not block:
                    break
                count += len(block)
                if count > size:
                    raise ValueError("artifact exceeds manifest size")
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
    if _digest(partial) != (size, digest):
        raise ValueError("downloaded artifact failed SHA-256 verification")
    os.chmod(partial, 0o644)
    os.replace(partial, path)


def _fetch_manifest(sha, lock_path):
    url = GITHUB_BASE + "bundle-" + sha + "/release-bundle.json"
    _wait_for_dependencies(lock_path)
    with OPENER.open(Request(url, headers={"User-Agent": "xDrive-ReleaseBundle/1"}), timeout=25) as response:
        if response.status != 200:
            raise ValueError("manifest not available")
        raw = response.read(MAX_MANIFEST + 1)
    if len(raw) > MAX_MANIFEST:
        raise ValueError("oversized manifest")
    document = json.loads(raw.decode("utf-8"))
    return validate(document, sha)


def _retain_manifest(cache, manifest):
    history = cache / "manifests"
    history.mkdir(parents=True, exist_ok=True)
    history.chmod(0o755)
    destination = history / (manifest["commit"] + ".json")
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    if destination.exists():
        if destination.read_bytes() != canonical:
            raise ValueError("immutable commit manifest would change")
    else:
        try:
            with destination.open("xb") as output:
                output.write(canonical)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(destination, 0o644)
        except FileExistsError:
            if destination.read_bytes() != canonical:
                raise ValueError("concurrent manifest mismatch")


def sync(manifest, cache, lock_path=None, marker=None, retries=2, allow_local=False):
    manifest = validate(manifest, allow_local=allow_local)
    cache.mkdir(parents=True, exist_ok=True)
    cache.chmod(0o755)
    with (cache / ".worker.lock").open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _retain_manifest(cache, manifest)
        sha = manifest["commit"]
        staging_parent = cache / "staging"
        staging_parent.mkdir(exist_ok=True)
        for stale in staging_parent.iterdir():
            if stale.name != sha and stale.is_dir() and not stale.is_symlink():
                shutil.rmtree(stale)
        staging = staging_parent / sha
        staging.mkdir(parents=True, exist_ok=True)
        staging.chmod(0o755)
        state = {"commit": sha, "state": "syncing", "artifacts": {}}
        _atomic_json(cache / "status.json", state)
        failures = []
        for item in manifest["artifacts"]:
            name = item["filename"]
            target = staging / name
            if target.is_file() and not target.is_symlink() and _digest(target) == (item["size"], item["sha256"]):
                state["artifacts"][name] = "verified"
                continue
            target.unlink(missing_ok=True)
            success = False
            for origin in ("gitlab", "github"):
                for _ in range(retries):
                    try:
                        _download(item["sources"][origin], target, item["size"], item["sha256"], lock_path, marker)
                        success = True
                        break
                    except InterruptedError:
                        state["state"] = "paused_for_server"
                        _atomic_json(cache / "status.json", state)
                        _wait_for_dependencies(lock_path, marker)
                        state["state"] = "syncing"
                    except ValueError:
                        # An inconsistent stream or digest must never be
                        # resumed from a different origin.
                        target.with_name(name + ".part").unlink(missing_ok=True)
                    except (OSError, HTTPError):
                        # A connection failure may resume using the immutable
                        # Range path (full SHA-256 still checked at completion).
                        pass
                if success:
                    break
            if not success:
                failures.append(name)
            state["artifacts"][name] = "verified" if success else "retry_needed"
            _atomic_json(cache / "status.json", state)
        if failures:
            state["state"] = "retry_needed"
            _atomic_json(cache / "status.json", state)
            return 1
        packages = cache / "packages"
        packages.mkdir(exist_ok=True)
        packages.chmod(0o755)
        destination = packages / sha
        if destination.exists():
            shutil.rmtree(destination)
        os.replace(staging, destination)
        _atomic_json(cache / "current.json", {"commit": sha})
        for old in packages.iterdir():
            if old.name != sha and old.is_dir() and not old.is_symlink():
                shutil.rmtree(old)
        for old in (cache / "staging").iterdir():
            if old.name != sha and old.is_dir() and not old.is_symlink():
                shutil.rmtree(old)
        state["state"] = "ready"
        _atomic_json(cache / "status.json", state)
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--commit")
    group.add_argument("--manifest", type=Path)
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--install-lock", type=Path)
    parser.add_argument("--dependency-busy-file", type=Path)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.retries <= 5:
        parser.error("retries must be 1..5")
    try:
        if args.commit and not SHA.fullmatch(args.commit):
            raise ValueError("invalid target commit")
        cache = args.cache_dir
        cache.mkdir(parents=True, exist_ok=True)
        manifest = (_fetch_manifest(args.commit, args.install_lock) if args.commit else
                    json.loads(args.manifest.read_text(encoding="utf-8")))
        return sync(manifest, cache, args.install_lock, args.dependency_busy_file, args.retries)
    except Exception as exc:
        print("Release Bundle cache failed (noncritical): " + str(exc), file=sys.stderr)
        if isinstance(exc, BlockingIOError):
            # Another worker already owns authoritative status and progress.
            return 0
        try:
            _atomic_json(args.cache_dir / "status.json", {
                "commit": args.commit or "",
                "state": "retry_needed", "artifacts": {},
                "message": "Release Bundle download or verification failed; server remains usable",
            })
        except OSError:
            pass
        return 1


if __name__ == "__main__":
    sys.exit(main())
