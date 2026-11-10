#!/usr/bin/env python3
"""Fail-closed validation of GitLab's exact-Commit two-image Release manifest.

This runs on the GitLab release runner before publishing *any* mutable Release
links. It validates the CI-produced manifest as data (not shell source).
"""
import os
from pathlib import Path
import re
import sys

SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
STABLE_TAG = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+(?:[+-][A-Za-z0-9.-]+)?\Z")

class ManifestError(ValueError):
    pass


def require_env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise ManifestError(f"missing required {name}")
    return value


def expected_identity() -> tuple[str, str, str, str]:
    commit = require_env("CI_COMMIT_SHA")
    if not SHA.fullmatch(commit):
        raise ManifestError("CI_COMMIT_SHA is not a complete lowercase Git commit")
    registry = require_env("CI_REGISTRY_IMAGE")
    if registry.endswith("/") or any(c.isspace() for c in registry):
        raise ManifestError("CI_REGISTRY_IMAGE is not a canonical registry path")
    tag = os.environ.get("CI_COMMIT_TAG", "")
    if tag:
        if not STABLE_TAG.fullmatch(tag):
            raise ManifestError("invalid stable release tag")
        channel, image_tag = "stable", tag
    elif os.environ.get("CI_COMMIT_BRANCH") == "master":
        channel, image_tag = "master", f"sha-{commit[:12]}"
    else:
        raise ManifestError("not a GitLab master or stable release")
    return commit, channel, registry, image_tag


def verify(path: Path) -> None:
    commit, channel, registry, tag = expected_identity()
    if path.is_symlink() or not path.is_file():
        raise ManifestError("manifest is missing, symlinked or not a regular file")
    raw = path.read_bytes()
    if not raw.endswith(b"\n") or b"\r" in raw or b"\0" in raw:
        raise ManifestError("invalid manifest line endings or embedded bytes")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ManifestError("manifest contains invalid UTF-8") from exc
    lines = text.splitlines()
    if len(lines) != 4:
        raise ManifestError(f"expected 4 manifest lines, got {len(lines)}")
    if lines[0] != f"commit\t{commit}":
        raise ManifestError("manifest commit differs from CI_COMMIT_SHA")
    if lines[1] != f"channel\t{channel}":
        raise ManifestError("manifest channel does not match release")
    for pos, name in enumerate(("xdrive-server", "xdrive-caddy"), 2):
        fields = lines[pos].split("\t")
        if len(fields) != 4 or fields[0] != "image" or fields[1] != name:
            raise ManifestError(f"expected unique ordered {name} image entry")
        expected_ref = f"{registry}/{name}:{tag}"
        if fields[2] != expected_ref:
            raise ManifestError(f"{name} image reference mismatch")
        if not DIGEST.fullmatch(fields[3]):
            raise ManifestError(f"{name} is missing a valid SHA256 manifest digest")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify-gitlab-core-manifest.py <manifest.tsv>", file=sys.stderr)
        return 2
    try:
        verify(Path(sys.argv[1]))
    except (ManifestError, OSError) as exc:
        print(f"[xDrive] GitLab core image manifest rejected: {exc}", file=sys.stderr)
        return 1
    print("[xDrive] GitLab Server+Caddy image manifest verified for exact Commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
