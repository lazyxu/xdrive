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
from urllib.parse import quote, urlsplit
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



class PinnedPublicRedirect(HTTPRedirectHandler):
    """Allow only GitHub's signed asset CDN or the same fixed GitLab origin."""
    def __init__(self, provider):
        self.provider = provider
        super().__init__()

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        previous = urlsplit(req.full_url)
        if target.username or target.password or target.fragment:
            raise GateError("public mirror redirected to a credentialed or fragment URL")
        if self.provider == "github":
            approved = {"github.com", "release-assets.githubusercontent.com",
                        "objects.githubusercontent.com"}
            safe = (previous.scheme == "https" and target.scheme == "https" and
                    previous.hostname in approved and target.hostname in approved and
                    previous.port in (None, 443) and target.port in (None, 443))
        elif self.provider == "gitlab":
            safe = (previous.scheme == target.scheme == "http" and
                    previous.hostname == target.hostname == "gitlab.t-fluid.com" and
                    previous.port == target.port == 1080)
        else:
            safe = False
        if not safe:
            raise GateError("public mirror attempted an unapproved redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def public_bytes(url, *, max_bytes=2 * 1024 * 1024):
    # Never attach Owner/Host credentials to public GitHub requests.
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise GateError("public Release metadata must use clean HTTPS")
    if parsed.hostname == "api.github.com":
        opener = build_opener(NoRedirect)
    elif parsed.hostname == "github.com":
        opener = build_opener(PinnedPublicRedirect("github"))
    else:
        raise GateError("unexpected public Release metadata origin")
    with opener.open(Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "xDrive-live-release-bundle-audit/1",
    }), timeout=30) as response:
        result = response.read(max_bytes + 1)
    if len(result) > max_bytes:
        raise GateError("release metadata exceeded configured size bound")
    return result


def public_json(url):
    return json.loads(public_bytes(url))


def check_release(commit, get_json=public_json, get_bytes=public_bytes, *, require_immutable=False):
    """Verify actual Release tag, manifest bytes and *all* release asset digests."""
    if not COMMIT.fullmatch(commit):
        raise GateError("expected full lowercase 40-character Git Commit")
    tag = "bundle-" + commit
    ref = get_json(GITHUB + "git/ref/tags/" + tag)
    release = get_json(GITHUB + "releases/tags/" + tag)
    if require_immutable and release.get("immutable") is not True:
        raise GateError("GitHub Release is mutable: enable repository release immutability for future bundles")
    raw = get_bytes("https://github.com/" + REPO +
                    "/releases/download/" + tag + "/release-bundle.json")
    doc = validate(json.loads(raw.decode("utf-8")), expected_commit=commit)
    _verify_published_release(commit, raw, doc, ref, release)
    return doc, raw


def check_host(home, commit, manifest, *, require_complete=False):
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
        elif reported not in ("pending", "missing_upstream",
                              "verification_failed", "retry_needed", "unavailable"):
            raise GateError("Host reports unknown package status: " + item["filename"])
        elif exists:
            raise GateError("unverified package unexpectedly visible: " + item["filename"])
    overall = state.get("state")
    if overall == "ready":
        if len(good) != len(expected):
            raise GateError("Host claims ready with missing or unverified package bytes")
    elif overall == "retry_needed":
        # A partial cache is a successful, usable subset of the current Commit.
        # Do not demand a completely mirrored Bundle when a platform is absent.
        # But empty/fully verified "retry" states must not masquerade as healthy.
        if not good or len(good) == len(expected):
            raise GateError("Host partial cache contains no verified subset or stale status")
    else:
        raise GateError("Host cache not usable: " + str(overall))
    if require_complete and overall != "ready":
        raise GateError("Host cache is partially verified; strict complete-cache gate failed")
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
        local = "/api/v1/release-bundles/current/artifacts/" + quote(name)
        expected_urls = ([local] if item.get("cached") else []) + [
            expected["sources"]["gitlab"], expected["sources"]["github"],
        ]
        if urls != expected_urls:
            raise GateError("Server source order, origin or cache admission mismatch: " + name)
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


def require_verified_cached_artifacts(listing):
    """A zero-byte/uncached API listing cannot pass a real transfer check.

    A partial cache is valid; download only packages that the running Server
    actually advertises as verified, not optional upstream-only packages.
    """
    items = listing.get("artifacts")
    if not isinstance(items, list):
        raise GateError("Server has no valid package inventory for live download")
    cached = [item for item in items if item.get("cached") is True]
    if not cached:
        raise GateError("no verified current-Commit cached package to exercise")
    return cached


def check_unauthenticated_denial(server_url, *, sample_cached=None):
    """Exercise real Owner denial without sending a credential to the Server.

    Both metadata and one cached package must be inaccessible to a guest.
    An HTTP redirect is not a successful authorization check.
    """
    if not sample_cached:
        raise GateError("no verified cached package for guest download denial")
    origin = server_url.rstrip("/")
    paths = [
        "/api/v1/release-bundles/current",
        "/api/v1/release-bundles/current/artifacts/" + quote(sample_cached["filename"]),
    ]
    opener = build_opener(NoRedirect)
    for path in paths:
        try:
            with opener.open(Request(origin + path, headers={
                "Accept-Encoding": "identity",
            }), timeout=20) as response:
                response.read(1)
        except HTTPError as exc:
            if exc.code in (401, 403):
                continue
            raise GateError("unauthenticated Bundle request returned HTTP " +
                            str(exc.code) + ": " + path) from exc
        raise GateError("unauthenticated Bundle request was exposed: " + path)
    return len(paths)


def check_remote_bytes(item, origin):
    """Optional expensive check of *actual* bytes at each advertised origin."""
    url = item["sources"][origin]
    parsed = urlsplit(url)
    if item.get("build_commit") is None or not COMMIT.fullmatch(item["build_commit"]):
        raise GateError("public package does not identify full Git Commit")
    name = item.get("filename")
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,180}", name):
        raise GateError("invalid public package filename")
    encoded = quote(name)
    if origin == "github":
        required = ("https://github.com/lazyxu/xdrive/releases/download/bundle-" +
                    item["build_commit"] + "/" + encoded)
    elif origin == "gitlab":
        required = ("http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/"
                    "packages/generic/xdrive-build-packages/sha-" +
                    item["build_commit"] + "/" + encoded)
    else:
        raise GateError("unknown package origin")
    if url != required or parsed.username or parsed.password or parsed.fragment:
        raise GateError("public package source differs from pinned Commit/filename")
    h = hashlib.sha256()
    length = 0
    opener = build_opener(PinnedPublicRedirect(origin))
    with opener.open(Request(url, headers={"User-Agent": "xDrive-live-release-bundle-audit/1",
                                          "Accept-Encoding": "identity"}),
                     timeout=60) as response:
        while data := response.read(1024 * 1024):
            length += len(data)
            if length > item["size"]:
                raise GateError(origin + " delivered oversized package")
            h.update(data)
    if length != item["size"] or h.hexdigest() != item["sha256"]:
        raise GateError(origin + " does not contain exact Commit package: " + item["filename"])




def check_authenticated_range_download(origin, token, artifact):
    """Exercise *real* authenticated GET/206 and resume using two byte ranges.

    This reads a public installer from the operator's own Server without
    writing anything on Host or client. Every byte is SHA-256 checked.
    """
    parsed = urlsplit(origin)
    if parsed.username or parsed.password or parsed.path not in ("", "/"):
        raise GateError("invalid Server download origin")
    if not token:
        raise GateError("authenticated range check requires Owner token")
    if not artifact.get("cached"):
        return False
    size = artifact["size"]
    if isinstance(size, bool) or not isinstance(size, int) or size < 2:
        raise GateError("two independent Range probes require a package of at least two bytes")
    name = artifact["filename"]
    url = origin.rstrip("/") + "/api/v1/release-bundles/current/artifacts/" + quote(name)
    midpoint = max(1, size // 2)
    spans = [(0, midpoint - 1)]
    if midpoint < size:
        spans.append((midpoint, size - 1))
    h = hashlib.sha256()
    opener = build_opener(NoRedirect)
    for first, last in spans:
        request = Request(url, headers={
            "Authorization": "Bearer " + token,
            "Accept-Encoding": "identity",
            "Range": "bytes=" + str(first) + "-" + str(last),
        })
        with opener.open(request, timeout=60) as response:
            if response.status != 206 or response.headers.get("Content-Range") != (
                "bytes " + str(first) + "-" + str(last) + "/" + str(size)
            ):
                raise GateError("authenticated Server did not honor exact resumable Range")
            received = 0
            while block := response.read(1024 * 1024):
                received += len(block)
                if received > last - first + 1:
                    raise GateError("Server streamed oversized Range")
                h.update(block)
            if received != last - first + 1:
                raise GateError("Server streamed incomplete Range")
    if h.hexdigest() != artifact["sha256"]:
        raise GateError("authenticated resumed Server download changed SHA-256: " + name)
    return True

def check_sigstore(commit, raw):
    """Independent GitHub OIDC/Sigstore verifier, using gh (no Host credentials)."""
    channel = json.loads(raw.decode("utf-8")).get("channel")
    if not COMMIT.fullmatch(commit) or channel not in ("master", "stable"):
        raise GateError("Sigstore acceptance requires exact Commit and release channel")
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
        if channel == "master":
            command += ["--source-ref", "refs/heads/master"]
        # The public verifier never needs an Owner bearer even if the operator
        # provided one for a later authenticated running Server API check.
        env = {key: value for key, value in os.environ.items() if key not in (
            "XD_BUNDLE_OWNER_TOKEN", "XD_OWNER_TOKEN", "XD_ACCESS_TOKEN",
            "XDRIVE_API_TOKEN",
        )}
        try:
            p = subprocess.run(command, env=env, capture_output=True, text=True,
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
    parser.add_argument("--require-complete-cache", action="store_true",
                        help="fail when any advertised client package is not cached")
    parser.add_argument("--server-url", help="authenticated Server origin")
    parser.add_argument("--allow-loopback-http", action="store_true")
    parser.add_argument("--require-immutable", action="store_true",
                        help="fail unless GitHub platform-level release immutability is enabled")
    parser.add_argument("--require-sigstore", action="store_true",
                        help="verify signed manifest with pinned CI identity and Git Commit")
    parser.add_argument("--check-server-download", action="store_true",
                        help="two authenticated Range requests per VERIFIED cached package; full SHA-256")
    parser.add_argument("--check-auth-denial", action="store_true",
                        help="real unauthenticated GET of metadata and one cached package must return 401/403")
    parser.add_argument("--check-package-bytes", action="store_true",
                        help="download and SHA-256 verify every GitLab/GitHub package; expensive")
    args = parser.parse_args(argv)
    try:
        manifest, raw = check_release(args.commit, require_immutable=args.require_immutable)
        verified_host = None
        api_count = None
        range_count = 0
        denied_count = 0
        if args.require_sigstore:
            check_sigstore(args.commit, raw)
        if args.host_home:
            verified_host = check_host(args.host_home, args.commit, manifest,
                                       require_complete=args.require_complete_cache)
        if args.server_url:
            api = server_listing(args.server_url, os.environ.get("XD_BUNDLE_OWNER_TOKEN", ""),
                                 allow_loopback_http=args.allow_loopback_http)
            api_count = check_server_listing(args.commit, manifest, api)
        if args.check_server_download or args.check_auth_denial:
            if not args.server_url:
                raise GateError("live download/auth checks require --server-url")
            cached = require_verified_cached_artifacts(api)
            if args.check_server_download:
                for item in cached:
                    if not check_authenticated_range_download(args.server_url,
                            os.environ.get("XD_BUNDLE_OWNER_TOKEN", ""), item):
                        raise GateError("cached package did not execute an authenticated Range check")
                    range_count += 1
            if args.check_auth_denial:
                denied_count = check_unauthenticated_denial(
                    args.server_url, sample_cached=cached[0]
                )
        if args.check_package_bytes:
            for item in manifest["artifacts"]:
                for origin in ("gitlab", "github"):
                    check_remote_bytes(item, origin)
        print(json.dumps({
            "commit": args.commit, "release": "verified",
            "platform_immutable": "verified" if args.require_immutable else "not_checked",
            "published_artifacts": len(manifest["artifacts"]),
            "sigstore": "verified" if args.require_sigstore else "not_checked",
            "host": "verified" if verified_host is not None else "not_checked",
            "host_packages": len(verified_host) if verified_host is not None else None,
            "api_packages": api_count,
            "remote_bytes": "verified" if args.check_package_bytes else "not_checked",
            "server_download": "verified" if range_count else "not_checked",
            "range_verified_packages": range_count,
            "guest_denial": "verified" if denied_count == 2 else "not_checked",
        }, sort_keys=True))
        return 0
    except (ValueError, HTTPError, URLError, OSError, json.JSONDecodeError) as exc:
        print("Release Bundle LIVE acceptance failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
