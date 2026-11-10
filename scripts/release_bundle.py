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
import subprocess
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
        if item["platform"] == "ios" and name == "xDrive-unsigned.ipa" and (
            item.get("install_mode") != "manual_test_only"
        ):
            raise ValueError("unsigned iOS IPA is manual testing only")
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
    # The installer owns install.lock throughout the entire transaction, but
    # package transfers should resume as soon as dependencies finish. The
    # Host-only dependency-ready marker is published *after* the final image
    # pull, before install.lock is released. Before then the lock fails closed
    # even if the busy marker cannot be published.
    if marker is not None:
        if marker.exists():
            return True
        ready = marker.with_name("dependency-ready")
        if ready.is_file() and not ready.is_symlink():
            return False
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


def _github_release_json(url, lock_path, marker=None):
    _wait_for_dependencies(lock_path, marker)
    with OPENER.open(
        Request(url, headers={"User-Agent": "xDrive-ReleaseBundle/1",
                              "Accept": "application/vnd.github+json"}),
        timeout=25,
    ) as response:
        if response.status != 200:
            raise ValueError("GitHub release provenance unavailable")
        raw = response.read(MAX_MANIFEST + 1)
    if len(raw) > MAX_MANIFEST:
        raise ValueError("GitHub release provenance exceeds size limit")
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("invalid GitHub release provenance response")
    return parsed


def _verify_published_release(sha, raw, document, ref, release):
    """Bind remote manifest bytes AND every package to the exact Git commit.

    GitHub tag/ref and asset digests are authenticated by the GitHub HTTPS API.
    This is not a replacement for independent Sigstore verification.
    """
    if not isinstance(ref.get("object"), dict) or (
        ref.get("ref") != "refs/tags/bundle-" + sha
        or ref["object"].get("type") != "commit"
        or ref["object"].get("sha") != sha
    ):
        raise ValueError("immutable Bundle tag is not an exact source commit")
    if release.get("tag_name") != "bundle-" + sha or (
        release.get("draft") is not False or release.get("prerelease") is not True
    ):
        raise ValueError("GitHub Bundle Release identity is invalid")
    assets = release.get("assets")
    if not isinstance(assets, list) or len(assets) > 31:
        raise ValueError("invalid published asset inventory")
    published = {}
    for item in assets:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ValueError("malformed published asset")
        if item["name"] in published:
            raise ValueError("duplicate published asset name")
        published[item["name"]] = item
    expected = {"release-bundle.json": (len(raw), hashlib.sha256(raw).hexdigest())}
    for artifact in document["artifacts"]:
        expected[artifact["filename"]] = (artifact["size"], artifact["sha256"])
    if set(published) != set(expected):
        raise ValueError("GitHub published assets differ from immutable Bundle manifest")
    for name, (size, digest) in expected.items():
        asset = published[name]
        if asset.get("digest") != "sha256:" + digest or asset.get("size") != size:
            raise ValueError("GitHub published asset size or SHA-256 mismatch: " + name)



def _verify_sigstore_manifest(raw, sha, channel):
    """Require cryptographically verified GitHub Actions provenance on Host.

    Uses GitHub CLI independently of Server metadata, pinned to source Commit,
    workflow identity, and immutable repository ID. No Owner JWT is required.
    If missing/unavailable, never silently downgrade to HTTPS-only provenance.
    """
    if not SHA.fullmatch(sha) or channel not in ("master", "stable"):
        raise ValueError("Sigstore admission requires full Git Commit and channel")
    gh = shutil.which("gh")
    if not gh:
        raise ValueError("independent Sigstore verifier (gh CLI) unavailable")
    with tempfile.TemporaryDirectory(prefix="xdrive-release-sigstore-") as tmp:
        manifest = Path(tmp) / "release-bundle.json"
        manifest.write_bytes(raw)
        cmd = [gh, "attestation", "verify", str(manifest),
               "--repo", "lazyxu/xdrive",
               "--signer-workflow", "lazyxu/xdrive/.github/workflows/release.yml",
               "--source-digest", sha, "--deny-self-hosted-runners",
               "--format", "json"]
        if channel == "master":
            cmd += ["--source-ref", "refs/heads/master"]
        env = {key: value for key, value in os.environ.items()
               if key not in ("XD_BUNDLE_OWNER_TOKEN", "XD_OWNER_TOKEN",
                              "XD_ACCESS_TOKEN", "XDRIVE_API_TOKEN")}
        try:
            checked = subprocess.run(cmd, env=env, capture_output=True,
                                     text=True, check=False, timeout=90)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("independent Sigstore verification unavailable") from exc
        if checked.returncode:
            raise ValueError("independent Sigstore verifier rejected manifest provenance")
        try:
            proofs = json.loads(checked.stdout)
            accepted = isinstance(proofs, list) and any(
                str(proof["verificationResult"]["signature"]["certificate"]
                    ["sourceRepositoryIdentifier"]) == "1382670236"
                for proof in proofs
            )
        except (ValueError, KeyError, TypeError):
            accepted = False
        if not accepted:
            raise ValueError("Sigstore certificate did not match pinned GitHub repository ID")
        return True


def _fetch_manifest(sha, lock_path, marker=None, require_sigstore=False):
    if not SHA.fullmatch(sha):
        raise ValueError("invalid full source commit")
    prefix = "https://api.github.com/repos/lazyxu/xdrive/"
    ref = _github_release_json(prefix + "git/ref/tags/bundle-" + sha, lock_path, marker)
    release = _github_release_json(prefix + "releases/tags/bundle-" + sha, lock_path, marker)
    _wait_for_dependencies(lock_path, marker)
    url = GITHUB_BASE + "bundle-" + sha + "/release-bundle.json"
    with OPENER.open(Request(url, headers={"User-Agent": "xDrive-ReleaseBundle/1"}), timeout=25) as response:
        if response.status != 200:
            raise ValueError("manifest not available")
        raw = response.read(MAX_MANIFEST + 1)
    if len(raw) > MAX_MANIFEST:
        raise ValueError("oversized manifest")
    document = validate(json.loads(raw.decode("utf-8")), sha)
    _verify_published_release(sha, raw, document, ref, release)
    if require_sigstore:
        _verify_sigstore_manifest(raw, sha, document["channel"])
    return document


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


def _installed_commit(path):
    """Read only the Host-owned installed build Commit, never source a .env."""
    if path is None:
        return None
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 131072:
        return ""
    commit = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("XD_RELEASE_COMMIT="):
            commit = line.partition("=")[2].strip().strip("'").strip('"')
    return commit if SHA.fullmatch(commit) else ""


def _publish_verified(cache, staging, sha, verified, manifest):
    """Publish only digest-verified bytes without destroying resumable .part files.

    Existing bytes are immutable per commit, so hardlinks let an interrupted
    partial Bundle become useful without exposing unverified staging files.
    """
    if not verified and manifest["artifacts"]:
        return False
    packages = cache / "packages"
    packages.mkdir(exist_ok=True)
    packages.chmod(0o755)
    destination = packages / sha
    if destination.exists() and (destination.is_symlink() or not destination.is_dir()):
        raise ValueError("unsafe Bundle destination")
    destination.mkdir(exist_ok=True)
    destination.chmod(0o755)
    for item in manifest["artifacts"]:
        name = item["filename"]
        if name not in verified:
            continue
        src = staging / name
        target = destination / name
        expected = (item["size"], item["sha256"])
        if target.is_file() and not target.is_symlink() and _digest(target) == expected:
            continue
        # The worker owns this directory, but never overwrite a file being
        # served by net/http. Replace its directory entry atomically instead.
        temp = destination / ("." + name + ".next")
        temp.unlink(missing_ok=True)
        try:
            os.link(src, temp, follow_symlinks=False)
            os.chmod(temp, 0o644)
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)
    _atomic_json(cache / "current.json", {"commit": sha})
    # Old package bytes may be removed only *after* the new current pointer
    # is visible; immutable historical manifests remain retained.
    for old in packages.iterdir():
        if old.name != sha and old.is_dir() and not old.is_symlink():
            shutil.rmtree(old)
    return True


def sync(manifest, cache, lock_path=None, marker=None, retries=2, allow_local=False, installed_env=None):
    manifest = validate(manifest, allow_local=allow_local)
    if installed_env is not None and _installed_commit(installed_env) != manifest["commit"]:
        return 0
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
        published = cache / "packages" / sha
        state = {
            "commit": sha, "state": "syncing",
            "artifacts": {item["filename"]: "pending" for item in manifest["artifacts"]},
        }
        _atomic_json(cache / "status.json", state)
        failures = []
        verified = set()
        for item in manifest["artifacts"]:
            name = item["filename"]
            expected = (item["size"], item["sha256"])
            target = staging / name
            existing = published / name
            if target.is_file() and not target.is_symlink() and _digest(target) == expected:
                verified.add(name)
                state["artifacts"][name] = "verified"
                _atomic_json(cache / "status.json", state)
                continue
            if existing.is_file() and not existing.is_symlink() and _digest(existing) == expected:
                # A previous partial publication may have succeeded for this
                # artifact even when the other platforms are still retrying.
                target.unlink(missing_ok=True)
                os.link(existing, target, follow_symlinks=False)
                verified.add(name)
                state["artifacts"][name] = "verified"
                _atomic_json(cache / "status.json", state)
                continue
            target.unlink(missing_ok=True)
            success = False
            saw_missing = set()
            failure = "retry_needed"
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
                        _atomic_json(cache / "status.json", state)
                    except ValueError:
                        # Invalid digest or Range must never contaminate a
                        # partial transfer resumed from a different origin.
                        failure = "verification_failed"
                        target.with_name(name + ".part").unlink(missing_ok=True)
                    except HTTPError as error:
                        if error.code == 404:
                            saw_missing.add(origin)
                        else:
                            failure = "retry_needed"
                    except OSError:
                        failure = "retry_needed"
                if success:
                    break
            if success:
                verified.add(name)
                state["artifacts"][name] = "verified"
            else:
                if len(saw_missing) == 2 and failure == "retry_needed":
                    failure = "missing_upstream"
                failures.append(name)
                state["artifacts"][name] = failure
            _atomic_json(cache / "status.json", state)
        if installed_env is not None and _installed_commit(installed_env) != sha:
            state["state"] = "superseded"
            _atomic_json(cache / "status.json", state)
            return 0
        _publish_verified(cache, staging, sha, verified, manifest)
        state["state"] = "retry_needed" if failures else "ready"
        state["message"] = (
            f"{len(verified)} verified; {len(failures)} installer packages pending retry"
            if failures else "Current Commit client packages verified"
        )
        _atomic_json(cache / "status.json", state)
        if not failures:
            # There are no partial bytes left to resume after full success.
            shutil.rmtree(staging)
        return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--commit")
    group.add_argument("--manifest", type=Path)
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--install-lock", type=Path)
    parser.add_argument("--installed-env", type=Path)
    parser.add_argument("--dependency-busy-file", type=Path)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--require-sigstore", action="store_true",
                        help="fail closed unless Host independently verifies signed Manifest provenance")
    args = parser.parse_args()
    if not 1 <= args.retries <= 5:
        parser.error("retries must be 1..5")
    try:
        if args.commit and not SHA.fullmatch(args.commit):
            raise ValueError("invalid target commit")
        cache = args.cache_dir
        cache.mkdir(parents=True, exist_ok=True)
        manifest = (_fetch_manifest(args.commit, args.install_lock, args.dependency_busy_file,
                                    require_sigstore=args.require_sigstore) if args.commit else
                    json.loads(args.manifest.read_text(encoding="utf-8")))
        if args.manifest and args.require_sigstore:
            _verify_sigstore_manifest(args.manifest.read_bytes(), manifest["commit"], manifest["channel"])
        return sync(manifest, cache, args.install_lock, args.dependency_busy_file, args.retries, installed_env=args.installed_env)
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
