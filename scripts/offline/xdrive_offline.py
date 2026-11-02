#!/usr/bin/env python3
"""Prepare, verify and install xDrive's five independently transportable offline packages.

Only Python's standard library is needed. A SHA-256 obtained from the same
untrusted medium is NOT an authentication mechanism; install requires a
manifest digest learned independently from an authenticated release.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile

COMPONENTS = ("app", "postgres", "media-worker", "ai-runtime", "ai-models")
IMAGE_MEMBERS = {
    "server": ("app", "images/server.tar.gz"),
    "caddy": ("app", "images/caddy.tar.gz"),
    "postgres": ("postgres", "images/postgres.tar.gz"),
    "media-worker": ("media-worker", "images/media-worker.tar.gz"),
    "ai-runtime": ("ai-runtime", "images/ai-runtime.tar.gz"),
}
REQUIRED_ASSETS = (
    "assets/xdrive-server-install.sh",
    "assets/deploy/docker-compose.yml",
    "assets/scripts/server-backup.sh",
    "assets/scripts/server-backup-scheduled.sh",
    "assets/scripts/server-restore.sh",
    "assets/scripts/server-verify.sh",
    "assets/scripts/server-doctor.sh",
    "assets/scripts/server-migrate-user.sh",
    "assets/scripts/server-control.sh",
    "assets/scripts/caddy-env-config.py",
    "assets/scripts/caddy-admission.py",
    "assets/scripts/xdrive-server-host.sh",
)
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
COMMIT_RE = re.compile(r"[a-f0-9]{40}\Z")
IMAGE_ID_RE = re.compile(r"sha256:[a-f0-9]{64}\Z")
REF_RE = re.compile(r"[a-z0-9._/-]+(?::[a-zA-Z0-9_.-]+)?\Z")
CHUNK = 1024 * 1024


class PackageError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PackageError(message)


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_file(path: Path) -> Path:
    require(not path.is_symlink() and path.is_file(), f"missing or unsafe regular file: {path}")
    return path


def component_members(source: Path) -> dict[str, dict[str, object]]:
    require(source.is_dir() and not source.is_symlink(), f"invalid component directory: {source}")
    result: dict[str, dict[str, object]] = {}
    for root, dirs, files in os.walk(source, followlinks=False):
        for folder in dirs:
            require(not (Path(root) / folder).is_symlink(), "component contains a directory symlink")
        for filename in files:
            path = safe_file(Path(root) / filename)
            rel = path.relative_to(source).as_posix()
            require(valid_member(rel), f"unsafe member path: {rel}")
            require(len(result) < 2000, "too many files in one package")
            require(path.stat().st_size <= 8 * 1024**3, f"oversize file: {rel}")
            result[rel] = {"sha256": hash_file(path), "size": path.stat().st_size}
    require(result, f"empty component: {source}")
    return dict(sorted(result.items()))


def valid_member(name: str) -> bool:
    path = PurePosixPath(name)
    return (
        isinstance(name, str) and len(name) < 512 and
        bool(name) and not name.startswith("/") and
        all(part not in (".", "..", "") for part in path.parts) and
        str(path) == name and "\\" not in name
    )


def deterministic_archive(source: Path, dest: Path, members: dict[str, dict[str, object]]) -> None:
    with dest.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", filename="", compresslevel=1, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                for rel in members:
                    path = source / rel
                    size = int(members[rel]["size"])
                    info = tarfile.TarInfo(rel)
                    info.size = size
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mtime = 0
                    info.mode = 0o755 if rel.startswith("assets/") and (
                        rel.endswith(".sh") or rel == "assets/scripts/xdrive-server-host.sh"
                    ) else 0o644
                    with path.open("rb") as handle:
                        archive.addfile(info, handle)


def parse_manifest(directory: Path, trusted_digest: str | None, *, require_trust: bool) -> dict:
    path = safe_file(directory / "manifest.json")
    if require_trust:
        require(bool(trusted_digest), "offline install requires --trusted-manifest-sha256 from an independent trusted channel")
    if trusted_digest:
        require(bool(SHA_RE.fullmatch(trusted_digest.lower())), "invalid trusted manifest SHA-256")
        require(hash_file(path) == trusted_digest.lower(), "trusted manifest digest mismatch")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError) as error:
        raise PackageError(f"invalid manifest JSON: {error}") from error
    require(isinstance(manifest, dict) and manifest.get("schema") == 1, "unsupported manifest schema")
    require(manifest.get("platform") == "linux/amd64", "unsupported offline platform")
    commit = manifest.get("source_commit")
    require(isinstance(commit, str) and bool(COMMIT_RE.fullmatch(commit)), "invalid source commit")
    require(manifest.get("channel") in ("master", "stable"), "invalid release channel")
    require(manifest.get("source") in ("github", "gitlab"), "invalid release source")
    packages = manifest.get("packages")
    require(isinstance(packages, dict) and set(packages) == set(COMPONENTS), "manifest must declare all five packages")
    seen_files: set[str] = set()
    for name in COMPONENTS:
        entry = packages[name]
        require(isinstance(entry, dict), f"invalid package metadata: {name}")
        filename = entry.get("filename")
        require(isinstance(filename, str) and bool(re.fullmatch(r"xdrive-[a-z0-9-]+-[a-f0-9]{12}\.tar\.gz", filename)), f"invalid package filename: {name}")
        require(filename not in seen_files, "duplicate package filenames")
        seen_files.add(filename)
        require(isinstance(entry.get("size"), int) and 0 < entry["size"] <= 8 * 1024**3, "invalid package byte size")
        require(isinstance(entry.get("sha256"), str) and bool(SHA_RE.fullmatch(entry["sha256"])), "invalid package SHA-256")
        members = entry.get("members")
        require(isinstance(members, dict) and members and len(members) <= 2000, f"invalid members: {name}")
        for member, meta in members.items():
            require(valid_member(member) and isinstance(meta, dict), f"unsafe manifest member: {member}")
            require(isinstance(meta.get("sha256"), str) and bool(SHA_RE.fullmatch(meta["sha256"])), "invalid member digest")
            require(isinstance(meta.get("size"), int) and 0 <= meta["size"] <= 8 * 1024**3, "invalid member size")
    images = manifest.get("images")
    require(isinstance(images, dict) and set(images) == set(IMAGE_MEMBERS), "missing image identities")
    for key, (component, name) in IMAGE_MEMBERS.items():
        image = images[key]
        require(isinstance(image, dict) and isinstance(image.get("ref"), str)
                and bool(REF_RE.fullmatch(image["ref"]))
                and isinstance(image.get("id"), str)
                and bool(IMAGE_ID_RE.fullmatch(image["id"])), f"invalid image identity: {key}")
        require(name in packages[component]["members"], f"missing image archive: {name}")
    if manifest["channel"] == "master":
        suffix = ":sha-" + commit[:12]
        require(images["server"]["ref"].endswith(suffix)
                and images["caddy"]["ref"].endswith(suffix),
                "App images are not bound to the exact release commit")
    require(set(REQUIRED_ASSETS).issubset(packages["app"]["members"]), "missing app host deployment assets")
    require(any(p.startswith("models/") for p in packages["ai-models"]["members"]), "AI models package has no models")
    require(any(p.startswith("licenses/") for p in packages["ai-models"]["members"]), "AI models package has no licenses")
    return manifest


def selected_components(directory: Path, manifest: dict, requested: str | None) -> tuple[str, ...]:
    if requested:
        items = requested.split(",")
        require(len(items) == len(set(items)) and all(item in COMPONENTS for item in items), "invalid --components selection")
    else:
        items = [name for name in COMPONENTS if (directory / manifest["packages"][name]["filename"]).is_file()]
    return tuple(x for x in COMPONENTS if x in items)


def verify_archive(path: Path, expected: dict, extract_to: Path | None) -> None:
    require(path.stat().st_size == expected["size"], f"package length mismatch: {path.name}")
    require(hash_file(path) == expected["sha256"], f"package SHA-256 mismatch: {path.name}")
    expected_members = expected["members"]
    seen: set[str] = set()
    try:
        with tarfile.open(path, mode="r:gz") as archive:
            for member in archive:
                name = member.name
                require(valid_member(name) and member.isfile(), f"unsafe tar entry: {name}")
                require(name in expected_members and name not in seen, f"unexpected or duplicate tar entry: {name}")
                seen.add(name)
                metadata = expected_members[name]
                require(member.size == metadata["size"], f"tar size mismatch: {name}")
                stream = archive.extractfile(member)
                require(stream is not None, f"missing tar content: {name}")
                dest = None
                if extract_to is not None:
                    target = extract_to / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    require(not target.exists() and not target.is_symlink(), f"duplicate extraction path: {name}")
                    dest = target.open("xb")
                digest = hashlib.sha256()
                remaining = member.size
                try:
                    while remaining:
                        chunk = stream.read(min(CHUNK, remaining))
                        require(bool(chunk), f"truncated tar content: {name}")
                        digest.update(chunk)
                        if dest is not None:
                            dest.write(chunk)
                        remaining -= len(chunk)
                finally:
                    if dest is not None:
                        dest.close()
                    stream.close()
                require(digest.hexdigest() == metadata["sha256"], f"tar member SHA-256 mismatch: {name}")
                if extract_to is not None:
                    (extract_to / name).chmod(0o700 if name.startswith("assets/") and (
                        name.endswith(".sh") or name.endswith("xdrive-server-host.sh")
                    ) else 0o600)
    except (tarfile.TarError, OSError, EOFError) as error:
        raise PackageError(f"cannot read package {path.name}: {error}") from error
    require(seen == set(expected_members), f"missing tar entries: {set(expected_members) - seen}")


def verify_selection(directory: Path, manifest: dict, selection: tuple[str, ...], extracted: Path | None = None) -> None:
    require(selection, "no offline packages found or selected")
    for name in selection:
        entry = manifest["packages"][name]
        package = safe_file(directory / entry["filename"])
        target = extracted / name if extracted else None
        if target:
            target.mkdir(mode=0o700)
        print(f"[offline] verifying {name}: {package.name}", flush=True)
        verify_archive(package, entry, target)
        print(f"[offline] {name}: verified", flush=True)


def docker(*args: str, quiet: bool = False) -> str:
    process = subprocess.run(["docker", *args], stdin=subprocess.DEVNULL,
                             capture_output=True, text=True, check=False)
    if process.returncode:
        raise PackageError(f"Docker command failed: {' '.join(args[:4])}: {process.stderr.strip()[:500]}")
    if not quiet and process.stdout.strip():
        print(process.stdout.strip(), flush=True)
    return process.stdout.strip()


def image_exists(image_ref: str) -> bool:
    return subprocess.run(["docker", "image", "inspect", image_ref], stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False).returncode == 0


def load_image(archive: Path, image: dict) -> None:
    docker("load", "-i", str(archive), quiet=True)
    actual = docker("image", "inspect", "--format", "{{.Id}}", image["ref"], quiet=True)
    require(actual == image["id"], f"imported Docker image identity mismatch: {image['ref']}")
    print(f"[offline] imported {image['ref']}", flush=True)


def assemble_photo_runtime(root: Path, manifest: dict) -> str:
    runtime = manifest["images"]["ai-runtime"]["ref"]
    photo_ref = f"xdrive/offline-photo-face:{manifest['source_commit'][:12]}"
    context = root / "photo-build"
    context.mkdir(mode=0o700)
    models = root / "ai-models" / "models"
    licenses = root / "ai-models" / "licenses"
    require(models.is_dir() and licenses.is_dir(), "AI model directories missing")
    shutil.copytree(models, context / "models")
    shutil.copytree(licenses, context / "licenses")
    (context / "Dockerfile").write_text(
        f"FROM {runtime}\nCOPY --chown=65532:65532 models/ /models/\n"
        "COPY --chown=65532:65532 licenses/ /licenses/\n"
        "USER 65532:65532\n", encoding="utf-8"
    )
    docker("build", "--pull=false", "--network=none", "-t", photo_ref, str(context), quiet=True)
    return photo_ref


def offline_install(args: argparse.Namespace, manifest: dict, selection: tuple[str, ...]) -> None:
    require("app" in selection, "offline install requires the App package")
    require(not ("ai-models" in selection) != ("ai-runtime" in selection),
            "AI Runtime and AI Models must be installed together")
    require(shutil.which("docker") is not None, "Docker must already be installed on the host")
    require(shutil.which("bash") is not None, "bash is required")
    require(subprocess.run(["docker", "info"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, check=False).returncode == 0,
            "Docker daemon is not available")
    postgres_ref = manifest["images"]["postgres"]["ref"]
    if "postgres" not in selection:
        require(image_exists(postgres_ref), "PostgreSQL package missing and required image is not cached")
        actual_id = docker("image", "inspect", "--format", "{{.Id}}", postgres_ref, quiet=True)
        require(actual_id == manifest["images"]["postgres"]["id"],
                "cached PostgreSQL image identity differs from this release; supply its package")
    home = args.config_dir or (Path.home() / ".xd")
    for env_path in (home / "config" / ".env", home / ".env"):
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("XD_POSTGRES_IMAGE=") and line.split("=", 1)[1].strip('"') not in ("", postgres_ref):
                    raise PackageError("existing custom PostgreSQL image must be handled separately; refusing replacement")
            break
    # All hashes, paths and individual file contents are verified BEFORE any Docker
    # mutation or xDrive deployment change. The staged scripts are never fetched online.
    with tempfile.TemporaryDirectory(prefix="xdrive-offline-", dir=args.workdir) as tmp:
        root = Path(tmp)
        verify_selection(args.directory, manifest, selection, root)
        for key, (component, relpath) in IMAGE_MEMBERS.items():
            if component in selection:
                load_image(root / component / relpath, manifest["images"][key])
        photo_ref = None
        if "ai-runtime" in selection:
            photo_ref = assemble_photo_runtime(root, manifest)
        app_assets = root / "app" / "assets"
        installer = app_assets / "xdrive-server-install.sh"
        require(installer.is_file(), "offline rendered installer is missing")
        environment = os.environ.copy()
        environment["XD_OFFLINE_ASSET_DIR"] = str(app_assets)
        environment["XD_INSTALL_SOURCE"] = manifest["source"]
        environment["XD_INSTALL_CHANNEL"] = manifest["channel"]
        environment["XD_POSTGRES_IMAGE"] = postgres_ref
        if "media-worker" in selection:
            environment["XD_OFFLINE_MEDIA_IMAGE"] = manifest["images"]["media-worker"]["ref"]
        if photo_ref:
            environment["XD_OFFLINE_PHOTO_IMAGE"] = photo_ref
        if args.config_dir:
            environment["XD_CONFIG_DIR"] = str(args.config_dir)
        if args.no_start:
            environment["XD_INSTALL_NO_START"] = "1"
        profiles = set(filter(None, environment.get("COMPOSE_PROFILES", "").split(",")))
        if args.enable_media:
            require("media-worker" in selection, "--enable-media requires the Media Worker package")
            profiles.add("media-worker")
        if args.enable_ai:
            require(photo_ref is not None, "--enable-ai requires AI Runtime and AI Models packages")
            profiles.add("photo-intelligence")
        environment["COMPOSE_PROFILES"] = ",".join(sorted(profiles))
        command = ["bash", str(installer), "--source", manifest["source"],
                   "--channel", manifest["channel"]]
        print("[offline] activating verified local release via xDrive transactional installer", flush=True)
        subprocess.run(command, env=environment, stdin=None, check=True)


def build_packages(args: argparse.Namespace) -> None:
    require(bool(COMMIT_RE.fullmatch(args.commit)), "--commit must be a full source SHA")
    require(args.channel in ("master", "stable"), "invalid --channel")
    require(args.source in ("github", "gitlab"), "invalid --source")
    source = args.prepared
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    require(not output.is_symlink(), "output must not be a symlink")
    images = json.loads(safe_file(source / "images.json").read_text(encoding="utf-8"))
    require(isinstance(images, dict) and set(images) == set(IMAGE_MEMBERS), "invalid images.json keys")
    for key, value in images.items():
        require(isinstance(value, dict) and isinstance(value.get("ref"), str)
                and bool(REF_RE.fullmatch(value["ref"]))
                and isinstance(value.get("id"), str)
                and bool(IMAGE_ID_RE.fullmatch(value["id"])), f"invalid image metadata: {key}")
    for key, (component, member) in IMAGE_MEMBERS.items():
        safe_file(source / component / member)
    for asset in REQUIRED_ASSETS:
        safe_file(source / "app" / asset)
    packages = {}
    for component in COMPONENTS:
        component_dir = source / component
        members = component_members(component_dir)
        with tempfile.NamedTemporaryFile(prefix=f".{component}-", suffix=".tar.gz", dir=output, delete=False) as tempfile_handle:
            temp_path = Path(tempfile_handle.name)
        try:
            deterministic_archive(component_dir, temp_path, members)
            digest = hash_file(temp_path)
            name = f"xdrive-{component}-{digest[:12]}.tar.gz"
            destination = output / name
            if destination.exists():
                require(hash_file(destination) == digest, f"immutable package collision: {name}")
                temp_path.unlink()
            else:
                temp_path.rename(destination)
            packages[component] = {"filename": name, "sha256": digest,
                                   "size": destination.stat().st_size, "members": members}
        finally:
            if temp_path.exists():
                temp_path.unlink()
    manifest = {
        "schema": 1, "platform": "linux/amd64", "source": args.source,
        "source_commit": args.commit, "channel": args.channel,
        "packages": packages, "images": images,
    }
    manifest_path = output / "manifest.json"
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    if manifest_path.exists():
        require(manifest_path.read_bytes() == manifest_bytes, "refusing to overwrite a different manifest")
    else:
        manifest_path.write_bytes(manifest_bytes)
    checksums = [f"{hash_file(manifest_path)}  manifest.json"]
    for component in COMPONENTS:
        item = packages[component]
        checksums.append(f"{item['sha256']}  {item['filename']}")
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")
    print(f"[offline] trusted manifest SHA-256 (publish through authenticated release): {hash_file(manifest_path)}")
    for component in COMPONENTS:
        item = packages[component]
        print(f"[offline] {component}: {item['filename']} ({item['size']} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description="xDrive five-package offline distribution")
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("build", help="Create five deterministic, immutable offline package archives")
    make.add_argument("--prepared", required=True, type=Path)
    make.add_argument("--output", required=True, type=Path)
    make.add_argument("--commit", required=True)
    make.add_argument("--source", choices=("github", "gitlab"), default="github")
    make.add_argument("--channel", choices=("master", "stable"), default="master")
    for verb in ("list", "verify", "install"):
        item = sub.add_parser(verb)
        item.add_argument("--dir", dest="directory", type=Path, required=True)
        item.add_argument("--components", help="Comma-separated components; default: all available")
        item.add_argument("--trusted-manifest-sha256", help="SHA-256 from an independently authenticated release")
        if verb == "install":
            item.add_argument("--workdir", type=Path, help="Private temporary staging parent")
            item.add_argument("--config-dir", type=Path, help="Existing xDrive home (default ~/.xd)")
            item.add_argument("--no-start", action="store_true")
            item.add_argument("--enable-media", action="store_true")
            item.add_argument("--enable-ai", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "build":
            build_packages(args)
        else:
            require(args.directory.is_dir() and not args.directory.is_symlink(), "invalid offline bundle directory")
            manifest = parse_manifest(args.directory, args.trusted_manifest_sha256,
                                      require_trust=args.command == "install")
            selection = selected_components(args.directory, manifest, args.components)
            if args.command == "list":
                for component in COMPONENTS:
                    item = manifest["packages"][component]
                    available = "present" if (args.directory / item["filename"]).is_file() else "missing"
                    print(f"{component:14s} {available:8s} {item['filename']}")
            elif args.command == "verify":
                verify_selection(args.directory, manifest, selection)
            else:
                offline_install(args, manifest, selection)
        return 0
    except (PackageError, OSError, subprocess.CalledProcessError) as error:
        print(f"xDrive offline: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
