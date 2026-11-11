#!/usr/bin/env python3
"""Read-only proof of bytes exported directly from deployed NAS/CAS storage.

Requires a current authenticated Owner/Source/Target/Node receipt obtained
separately. No credentials, photos, paths, or device IDs are logged. A local
temporary-CAS test is NOT deployed NAS evidence.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
import zlib


class InvalidOriginal(Exception):
    pass


def _digest(file_path):
    h = hashlib.sha256()
    size = 0
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
            size += len(chunk)
    return size, h.hexdigest()


def _decode(file_path):
    executable = shutil.which("ffmpeg")
    if not executable:
        raise InvalidOriginal("ffmpeg is required for actual media decoding")
    try:
        result = subprocess.run(
            [executable, "-nostdin", "-hide_banner", "-v", "error",
             "-xerror", "-i", str(file_path), "-f", "null", "-"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            timeout=7200, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise InvalidOriginal("media decoder unavailable or timed out") from exc
    if result.returncode != 0:
        raise InvalidOriginal("media failed full decode")


def _verify_live(file_path, decode):
    try:
        with zipfile.ZipFile(file_path, "r") as archive:
            entries = archive.infolist()
            names = [item.filename for item in entries]
            if len(names) != 3 or len(set(names)) != 3 or "manifest.json" not in names:
                raise InvalidOriginal("Live archive must contain two originals and manifest")
            if any(item.compress_type != zipfile.ZIP_STORED or
                   stat.S_ISLNK(item.external_attr >> 16) for item in entries):
                raise InvalidOriginal("Live archive cannot contain compressed/symlink entries")
            info = archive.getinfo("manifest.json")
            if info.file_size > 65535:
                raise InvalidOriginal("oversized Live manifest")
            manifest = json.loads(archive.read("manifest.json"))
            if not isinstance(manifest, dict) or \
               manifest.get("format") != "xdrive-live-originals" or \
               manifest.get("version") != 1:
                raise InvalidOriginal("unexpected Live archive format")
            parts = manifest.get("resources")
            if not isinstance(parts, list) or len(parts) != 2 or \
               not all(isinstance(part, dict) for part in parts) or \
               {part.get("role") for part in parts} != {"still", "motion"}:
                raise InvalidOriginal("incomplete Live still/motion pair")
            expected = {"manifest.json"}
            with tempfile.TemporaryDirectory(prefix="xdrive-nas-proof-") as temp:
                for part in parts:
                    role = part["role"]
                    name = part.get("path", "")
                    if not re.fullmatch(r"media/" + role + r"\.[a-z0-9]{1,12}", name):
                        raise InvalidOriginal("invalid Live resource path")
                    expected.add(name)
                    byte_count = part.get("bytes")
                    crc_text = part.get("crc32")
                    if not isinstance(byte_count, int) or byte_count <= 0 or \
                       not isinstance(crc_text, str) or \
                       not re.fullmatch(r"[0-9a-f]{8}", crc_text):
                        raise InvalidOriginal("invalid Live part size/checksum")
                    member = archive.getinfo(name)
                    if member.file_size != byte_count:
                        raise InvalidOriginal("Live part byte count differs from manifest")
                    count, crc = 0, 0
                    output = Path(temp) / Path(name).name if decode else None
                    sink = output.open("wb") if output else None
                    try:
                        with archive.open(member, "r") as source:
                            while True:
                                chunk = source.read(1024 * 1024)
                                if not chunk:
                                    break
                                count += len(chunk)
                                crc = zlib.crc32(chunk, crc)
                                if sink:
                                    sink.write(chunk)
                    finally:
                        if sink:
                            sink.close()
                    if count != byte_count or f"{crc & 0xffffffff:08x}" != crc_text:
                        raise InvalidOriginal("Live part checksum mismatch")
                    if decode:
                        _decode(output)
            if set(names) != expected:
                raise InvalidOriginal("unexpected Live archive member")
    except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError, RuntimeError) as exc:
        raise InvalidOriginal("invalid or corrupted Live archive") from exc
    return 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, help="Original read directly from mounted deployed NAS or independent readback")
    parser.add_argument("--expected-sha256", required=True, help="Current Owner Node original SHA-256 receipt")
    parser.add_argument("--expected-bytes", type=int, required=True, help="Current Owner Node original size")
    parser.add_argument("--kind", choices=("image", "video", "live"), required=True)
    parser.add_argument("--decode", action="store_true", help="Require full ffmpeg decode for every media component")
    args = parser.parse_args(argv)
    try:
        if not re.fullmatch(r"[0-9a-fA-F]{64}", args.expected_sha256) or args.expected_bytes <= 0:
            raise InvalidOriginal("invalid expected current Node identity")
        path = Path(args.file)
        if not stat.S_ISREG(path.lstat().st_mode):
            raise InvalidOriginal("must be a regular non-symlink original")
        count, digest = _digest(path)
        if count != args.expected_bytes or digest != args.expected_sha256.lower():
            raise InvalidOriginal("original bytes differ from current authenticated Node receipt")
        parts = _verify_live(path, args.decode) if args.kind == "live" else 0
        if args.kind != "live" and args.decode:
            _decode(path)
        print(json.dumps({
            "status": "PASS", "kind": args.kind, "sha256": digest,
            "bytes": count, "live_parts": parts, "full_decode": args.decode
        }, sort_keys=True))
        return 0
    except (InvalidOriginal, OSError) as exc:
        # Never include file paths or raw media in CI/issue comments.
        detail = str(exc) if isinstance(exc, InvalidOriginal) else "source read failure"
        print("FAIL: " + detail, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
