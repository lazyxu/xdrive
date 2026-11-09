#!/usr/bin/env python3
"""Read-only acceptance gate for a *real* published xDrive Release Bundle.

Checks public GitHub Release identity and asset inventory, optional downloaded
bytes, Host cache and authenticated running Server. Never upgrades or installs.
The real Server/Host and network options are intentionally opt-in.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler, Request, build_opener, urlopen,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_bundle import (  # noqa: E402
    _digest, _installed_commit, _verify_published_release, validate,
)

COMMIT = re.compile(r"[0-9a-f]{40}\Z")
REPO = "lazyxu/xdrive"
GITHUB = "https://api.github.com/repos/" + REPO + "/"
REPO_ID = "1382670236"
SIGNER = REPO + "/.github/workflows/release.yml"


class GateError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise GateError("authenticated Server metadata/download redirected")


def public_bytes(url, *, max_bytes=2 * 1024 * 1024):
    # Never attach Owner/Host credentials to public GitHub requests.
    if urlsplit(url).scheme != "https":
        raise GateError("public Release metadata must use HTTPS")
    with urlopen(Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "xDrive-live-release-bundle-audit/1",
    }), timeout=30) as response:
        result = response.read(max_bytes + 1)
    if len(result) > max_bytes:
        raise GateError("release metadata exceeded configured size bound")
    return result


def public_json(url):
    return json.loads(public_bytes(url))


def check_release(commit, get_json=public_json, get_bytes=public_bytes):
    """Verify actual Release tag, manifest bytes and *all* release asset digests."""
    if not COMMIT.fullmatch(commit):
        raise GateError("expected full lowercase 40-character Git Commit")
    tag = "bundle-" + commit
    ref = get_json(GITHUB + "git/ref/tags/" + tag)
    release = get_json(GITHUB + "releases/tags/" + tag)
    raw = get_bytes("https://github.com/" + REPO +
                    "/releases/download/" + tag + "/release-bundle.json")
    doc = validate(json.loads(raw.decode("utf-8")), expected_commit=commit)
    _verify_published_release(commit, raw, doc, ref, release)
    return doc, raw


def check_host(home, commit, manifest):
    """Validate installed Host cache as bytes, not merely status.json claims."""
    home = Path(home)
    cache = home / "data" / "release-bundles"
    installed = _installed_commit(home / "config" / ".env")
    if installed != commit:
        raise GateError("installed Host XD_RELEASE_COMMIT differs from requested Commit")
    def read_json(path):
        if path.is_symlink() or not path.is_file():
            raise GateError("missing or symlinked Host state: " + str(path))
        return json.loads(path.read_text(encoding="utf-8"))
    state = read_json(cache / "status.json")
    current = read_json(cache / "current.json")
    stored = read_json(cache / "manifests" / (commit + ".json"))
    if current.get("commit") != commit or state.get("commit") != commit:
        raise GateError("Host still serves old Commit or has no verified current cache")
    if stored != manifest:
        raise GateError("Host saved Manifest differs from published GitHub manifest")
    status_map = state.get("artifacts")
    if not isinstance(status_map, dict):
        raise GateError("Host status has no per-artifact checks")
    expected = {x["filename"] for x in manifest["artifacts"]}
    if set(status_map) != expected:
        raise GateError("Host status inventory does not match public Manifest")
    good = []
    for item in manifest["artifacts"]:
        path = cache / "packages" / commit / item["filename"]
        reported = status_map[item["filename"]]
        exists = path.exists() or path.is_symlink()
        if reported == "verified":
            if path.is_symlink() or not path.is_file() or _digest(path) != (
                item["size"], item["sha256"],
            ):
                raise GateError("Host verified-package bytes changed: " + item["filename"])
            good.append(item["filename"])
        elif exists:
            raise GateError("unverified package unexpectedly visible: " + item["filename"])
    if state.get("state") == "ready" and len(good) != len(expected):
        raise GateError("Host claims ready with missing or unverified package bytes")
    if state.get("state") != "ready":
        raise GateError("Host cache not fully ready: " + str(state.get("state")))
    return good


def check_server_listing(commit, manifest, listing):
    if listing.get("commit") != commit:
        raise GateError("running Server returned an obsolete or mismatched Commit")
    allowed = {x["filename"]: x for x in manifest["artifacts"]}
    items = listing.get("artifacts")
    if not isinstance(items, list) or len(items) != len(allowed):
        raise GateError("Server API package inventory mismatches GitHub manifest")
    seen = set()
    for item in items:
        name = item.get("filename")
        if name not in allowed or name in seen:
            raise GateError("Server API has unexpected/duplicate package")
        seen.add(name)
        expected = allowed[name]
        for field in ("build_commit", "size", "sha256", "platform", "install_mode"):
            if item.get(field) != expected.get(field):
                raise GateError("Server package identity differs: " + name + " " + field)
        urls = item.get("download_urls")
        if not isinstance(urls, list):
            raise GateError("Server omitted download sources")
        local = "/api/v1/release-bundles/current/artifacts/" + name
        if item.get("cached") and (not urls or urls[0] != local):
            raise GateError("verified local source not preferred")
        if not item.get("cached") and local in urls:
            raise GateError("Server exposed unverified local package")
    return len(seen)


def server_listing(server_url, token, *, allow_loopback_http=False):
    parsed = urlsplit(server_url)
    local = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise GateError("Server URL must be an origin without credentials")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and local and allow_loopback_http
    ):
        raise GateError("Server API requires HTTPS (except explicit localhost test)")
    if not token:
        raise GateError("authenticated API probe requires XD_BUNDLE_OWNER_TOKEN")
    url = server_url.rstrip("/") + "/api/v1/release-bundles/current"
    opener = build_opener(NoRedirect)
    with opener.open(Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
    }), timeout=20) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise GateError("Server response too large")
    return json.loads(raw)


def check_remote_bytes(item, origin):
    """Optional expensive check of *actual* bytes at each advertised origin."""
    url = item["sources"][origin]
    parsed = urlsplit(url)
    if origin == "github" and parsed.scheme != "https":
        raise GateError("GitHub package source is not HTTPS")
    h = hashlib.sha256()
    length = 0
    with urlopen(Request(url, headers={"User-Agent": "xDrive-live-release-bundle-audit/1"}),
                 timeout=60) as response:
        while data := response.read(1024 * 1024):
            length += len(data)
            if length > item["size"]:
                raise GateError(origin + " delivered oversized package")
            h.update(data)
    if length != item["size"] or h.hexdigest() != item["sha256"]:
        raise GateError(origin + " does not contain exact Commit package: " + item["filename"])


def check_sigstore(commit, raw):
    """Independent GitHub OIDC/Sigstore verifier, using gh (no Host credentials)."""
    gh = shutil.which("gh")
    if not gh:
        raise GateError("gh CLI required for independent Sigstore verification")
    with tempfile.TemporaryDirectory(prefix="xdrive-bundle-attest-") as tmp:
        path = Path(tmp) / "release-bundle.json"
        path.write_bytes(raw)
        command = [
            gh, "attestation", "verify", str(path),
            "--repo", REPO, "--signer-workflow", SIGNER,
            "--source-digest", commit, "--deny-self-hosted-runners",
            "--format", "json",
        ]
        try:
            p = subprocess.run(command, capture_output=True, text=True,
                               timeout=90, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise GateError("independent Sigstore verification unavailable") from exc
        if p.returncode:
            raise GateError("Sigstore signer, Commit or manifest digest rejected")
        try:
            results = json.loads(p.stdout)
            matched = any(str(x["verificationResult"]["signature"]["certificate"][
                "sourceRepositoryIdentifier"]) == REPO_ID for x in results)
        except (ValueError, TypeError, KeyError):
            matched = False
        if not matched:
            raise GateError("Sigstore proof did not match immutable GitHub repository ID")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True, help="current full 40-hex Server Commit")
    parser.add_argument("--host-home", type=Path, help="installed Host .xd directory")
    parser.add_argument("--server-url", help="authenticated Server origin")
    parser.add_argument("--allow-loopback-http", action="store_true")
    parser.add_argument("--require-sigstore", action="store_true",
                        help="verify signed manifest with pinned CI identity and Git Commit")
    parser.add_argument("--check-package-bytes", action="store_true",
                        help="download and SHA-256 verify every GitLab/GitHub package; expensive")
    args = parser.parse_args(argv)
    try:
        manifest, raw = check_release(args.commit)
        verified_host = None
        api_count = None
        if args.require_sigstore:
            check_sigstore(args.commit, raw)
        if args.host_home:
            verified_host = check_host(args.host_home, args.commit, manifest)
        if args.server_url:
            api = server_listing(args.server_url, os.environ.get("XD_BUNDLE_OWNER_TOKEN", ""),
                                 allow_loopback_http=args.allow_loopback_http)
            api_count = check_server_listing(args.commit, manifest, api)
        if args.check_package_bytes:
            for item in manifest["artifacts"]:
                for origin in ("gitlab", "github"):
                    check_remote_bytes(item, origin)
        print(json.dumps({
            "commit": args.commit, "release": "verified",
            "published_artifacts": len(manifest["artifacts"]),
            "sigstore": "verified" if args.require_sigstore else "not_checked",
            "host": "verified" if verified_host is not None else "not_checked",
            "host_packages": len(verified_host) if verified_host is not None else None,
            "api_packages": api_count,
            "remote_bytes": "verified" if args.check_package_bytes else "not_checked",
        }, sort_keys=True))
        return 0
    except (ValueError, HTTPError, URLError, OSError, json.JSONDecodeError) as exc:
        print("Release Bundle LIVE acceptance failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
