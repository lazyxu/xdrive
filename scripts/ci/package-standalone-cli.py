#!/usr/bin/env python3
"""Package source-exact portable xd/Agent CLI without a Desktop or installer.

Both archives contain the existing CI-built client-core binaries byte-for-byte.
They are distinct from the Backup-only CLI distribution and never authorize
automatic or privileged installation.
"""
import argparse
import gzip
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import zipfile

FULL_SHA = re.compile(r"[a-f0-9]{40}\Z")
LINUX = ("linux-amd64/xd", "linux-amd64/xdrive-agent")
WINDOWS = ("windows-amd64/xd.exe", "windows-amd64/xdrive-agent.exe")


def read_regular(core, relative):
    path = core / relative
    if path.is_symlink() or not path.is_file() or not path.stat().st_size:
        raise ValueError("missing, empty or symlinked original core: " + relative)
    return path.read_bytes()


def build(core, out, commit, readme=None):
    core = Path(core)
    out = Path(out)
    if not FULL_SHA.fullmatch(commit):
        raise ValueError("requires exact lowercase 40-character source Commit")
    if core.is_symlink() or not core.is_dir() or out.is_symlink():
        raise ValueError("unsafe source or output directory")
    originals = {name: read_regular(core, name) for name in LINUX + WINDOWS}
    # A portable archive cannot be trusted merely because the workflow
    # environment advertised GITHUB_SHA. Check the actual built Linux tools.
    for relative, args in (("linux-amd64/xd", ["version", "--json"]),
                           ("linux-amd64/xdrive-agent", ["--build-info-json"])):
        try:
            result = subprocess.run([str((core / relative).resolve()), *args],
                                    capture_output=True, text=True, timeout=20, check=True)
            embedded = json.loads(result.stdout).get("commit")
        except (OSError, ValueError, subprocess.CalledProcessError,
                subprocess.TimeoutExpired) as exc:
            raise ValueError("unable to validate source-exact " + relative) from exc
        if embedded != commit:
            raise ValueError("source Commit mismatch in " + relative)
    if readme is None:
        readme = Path(__file__).resolve().parents[2] / "docs/xd-standalone-cli.md"
    doc = Path(readme)
    if doc.is_symlink() or not doc.is_file():
        raise ValueError("standalone CLI instructions missing or symlinked")
    instructions = doc.read_bytes() + ("\nSource Git Commit: " + commit + "\n").encode()
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError("standalone CLI output must be an empty directory")
    members_linux = {"xdrive-cli/README.md": (instructions, 0o644)}
    members_linux.update({"xdrive-cli/" + name.split("/")[-1]: (originals[name], 0o755)
                          for name in LINUX})
    linux = out / "xdrive-cli-linux-amd64.tar.gz"
    with linux.open("xb") as stream:
        with gzip.GzipFile(fileobj=stream, mode="wb", filename="", mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode="w") as tar:
                folder = tarfile.TarInfo("xdrive-cli/")
                folder.type = tarfile.DIRTYPE
                folder.mode, folder.mtime, folder.uid, folder.gid = 0o755, 0, 0, 0
                tar.addfile(folder)
                for name, (raw, mode) in sorted(members_linux.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mode = len(raw), mode
                    entry.uid = entry.gid = entry.mtime = 0
                    import io
                    tar.addfile(entry, io.BytesIO(raw))
    windows = out / "xdrive-cli-windows-amd64.zip"
    members_windows = {"xdrive-cli/README.md": instructions}
    members_windows.update({"xdrive-cli/" + name.split("/")[-1]: originals[name]
                            for name in WINDOWS})
    with zipfile.ZipFile(windows, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(members_windows.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (0o100644 << 16)
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, raw)
    return linux, windows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("core", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args(argv)
    try:
        packages = build(args.core, args.output, args.commit)
    except (OSError, ValueError) as exc:
        print("Standalone CLI packaging failed: " + str(exc), file=sys.stderr)
        return 1
    print("Source-exact portable CLI archives: " +
          ", ".join(p.name for p in packages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
