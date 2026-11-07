#!/usr/bin/env python3
"""Generate a Commit-bound immutable Release Bundle from actual CI artifacts.

Run only on a trusted release runner after exact-SHA artifacts have been
verified. Missing platforms are intentionally omitted, never synthesized.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote

SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
KNOWN = (
    ("linux", "xdrive-linux-amd64.deb", True),
    ("windows", "xDriveSetup-amd64.exe", True),
    ("cli", "xdrive-backup-linux-amd64.tar.gz", True),
    ("cli", "xdrive-backup-windows-amd64.zip", True),
    ("dsm", "xdrivenas-armada38x-*.spk", True),
    ("ios", "xDrive-unsigned.ipa", False),
    ("android", "xdrive-android-*.apk", False),
)


def build(directory: Path, commit: str, channel: str):
    if not SHA_RE.fullmatch(commit):
        raise ValueError("release requires the full lowercase Git commit SHA")
    if channel not in {"master", "stable"}:
        raise ValueError("invalid release channel")
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("release directory missing or symlinked")
    items = []
    seen = set()
    for platform, pattern, required in KNOWN:
        matches = sorted(directory.glob(pattern))
        if required and len(matches) != 1:
            raise ValueError(f"required {platform} CI artifact absent or duplicated: {pattern}")
        if not required and len(matches) > 1:
            raise ValueError(f"ambiguous optional {platform} artifacts")
        for path in matches:
            if not path.is_file() or path.is_symlink() or path.name in seen:
                raise ValueError(f"unsafe or duplicate release file: {path.name}")
            seen.add(path.name)
            digest = hashlib.sha256()
            size = 0
            with path.open("rb") as source:
                while block := source.read(1024 * 1024):
                    digest.update(block)
                    size += len(block)
            if not size:
                raise ValueError(f"empty release file: {path.name}")
            # Only separately approved, fixed-key signed Android releases enter
            # the bundle. The independent Debug build is never a publish input.
            entry = {
                "platform": platform,
                "filename": path.name,
                "size": size,
                "sha256": digest.hexdigest(),
                "build_commit": commit,
                "install_mode": "manual",
                "sources": {
                    "gitlab": (
                        "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive"
                        "/packages/generic/xdrive-build-packages/sha-" + commit + "/" + quote(path.name)
                    ),
                    "github": (
                        "https://github.com/lazyxu/xdrive/releases/download/bundle-"
                        + commit + "/" + quote(path.name)
                    ),
                },
            }
            items.append(entry)
    return {"schema_version": 1, "commit": commit, "channel": channel, "artifacts": items}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("commit")
    parser.add_argument("channel", choices=("master", "stable"))
    parser.add_argument("--output", default="release-bundle.json")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.output):
        parser.error("invalid output filename")
    try:
        manifest = build(args.directory, args.commit, args.channel)
        target = args.directory / args.output
        if target.exists():
            raise ValueError("refusing to replace existing immutable release manifest")
        with target.open("x", encoding="utf-8") as out:
            json.dump(manifest, out, sort_keys=True, separators=(",", ":"))
            out.write("\n")
        print(f"Built exact-commit bundle with {len(manifest['artifacts'])} published client artifacts")
        return 0
    except (OSError, ValueError) as err:
        print(f"Release Bundle generation failed: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
