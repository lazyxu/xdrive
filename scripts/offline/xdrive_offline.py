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
SUPPORTED_PROFILES = frozenset(("media-worker", "photo-intelligence", "caddy-rescue"))
IMAGE_MEMBERS = {
    "server": ("app", "images/server.tar.gz"),
    "caddy": ("app", "images/caddy.tar.gz"),
    "postgres": ("postgres", "images/postgres.tar.gz"),
    "media-worker": ("media-worker", "images/media-worker.tar.gz"),
    "ai-runtime": ("ai-runtime", "images/ai-runtime.tar.gz"),
}
# Keep accepted pre-Share manifests readable for immutable dependency reuse.
# Current App builds and Share activation enforce the additional provider asset.
BASE_REQUIRED_ASSETS = (
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
SHARE_PROVIDER_ASSET = "assets/scripts/xdrive-share-update.py"
REQUIRED_ASSETS = (*BASE_REQUIRED_ASSETS, SHARE_PROVIDER_ASSET)
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
COMMIT_RE = re.compile(r"[a-f0-9]{40}\Z")
IMAGE_ID_RE = re.compile(r"sha256:[a-f0-9]{64}\Z")
REF_RE = re.compile(r"[a-z0-9._/-]+(?::[a-zA-Z0-9_.-]+)?\Z")
CHUNK = 1024 * 1024
IMAGE_METADATA_LIMIT = 1024 * 1024
IMAGE_METADATA_TOTAL_LIMIT = 16 * 1024 * 1024
IMAGE_ARCHIVE_ENTRIES = 4096
IMAGE_ARCHIVE_BYTES = 16 * 1024**3
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
OCI_INDEX = "application/vnd.oci.image.index.v1+json"
DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json"
DOCKER_INDEX = "application/vnd.docker.distribution.manifest.list.v2+json"


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
    require(isinstance(manifest, dict) and manifest.get("schema") in (1, 2), "unsupported manifest schema")
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
    if manifest["schema"] == 2:
        fingerprints = manifest.get("fingerprints")
        contracts = manifest.get("contracts")
        require(isinstance(fingerprints, dict) and set(fingerprints) == set(COMPONENTS),
                "missing component fingerprints")
        require(all(isinstance(value, str) and bool(SHA_RE.fullmatch(value))
                    for value in fingerprints.values()), "invalid component fingerprint")
        expected_contracts = {"postgres_major", "media_worker_api",
                              "photo_intelligence_api", "model_runtime_api"}
        require(isinstance(contracts, dict) and set(contracts) == expected_contracts
                and all(type(v) is int and v > 0 for v in contracts.values()),
                "invalid compatibility contracts")
        for component in COMPONENTS:
            entry = packages[component]
            revision = entry.get("built_from_commit")
            tag = entry.get("release_tag")
            require(isinstance(revision, str) and bool(COMMIT_RE.fullmatch(revision))
                    and isinstance(tag, str) and
                    bool(re.fullmatch(r"offline-(app|postgres|media-worker|ai-runtime|ai-models)-[a-f0-9]{12}", tag)),
                    f"invalid immutable release identity: {component}")
            require(entry.get("fingerprint") == fingerprints[component],
                    f"component fingerprint mismatch: {component}")
            require(tag == f"offline-{component}-{entry['sha256'][:12]}",
                    f"immutable release tag not bound to archive digest: {component}")
        if manifest["channel"] == "master":
            revision = packages["app"]["built_from_commit"]
            suffix = ":sha-" + revision[:12]
            require(images["server"]["ref"].endswith(suffix)
                    and images["caddy"]["ref"].endswith(suffix),
                    "App images are not bound to the exact App build commit")
    elif manifest["channel"] == "master":
        suffix = ":sha-" + commit[:12]
        require(images["server"]["ref"].endswith(suffix)
                and images["caddy"]["ref"].endswith(suffix),
                "App images are not bound to the exact release commit")
    require(set(BASE_REQUIRED_ASSETS).issubset(packages["app"]["members"]), "missing app host deployment assets")
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


class ImageTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive):
        # Reject extension headers before tarfile allocates their payload. Docker
        # save paths fit ordinary headers; no links, PAX overrides or sparse files.
        require(self.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE),
                "unsupported image tar entry")
        return super()._proc_member(archive)


def image_archive_metadata(path: Path) -> dict:
    entries, retained, total = {}, 0, 0
    try:
        with tarfile.open(safe_file(path), mode="r|gz", tarinfo=ImageTarInfo) as archive:
            for member in archive:
                name = member.name
                require(valid_member(name) and name not in entries and len(entries) < IMAGE_ARCHIVE_ENTRIES,
                        "unsafe, duplicate or excessive image tar entries")
                total += member.size + 512
                require(0 <= member.size <= IMAGE_ARCHIVE_BYTES and total <= IMAGE_ARCHIVE_BYTES,
                        "image archive exceeds unpacked byte limit")
                if member.isdir():
                    require(member.size == 0, "invalid image directory")
                    entries[name] = None
                    continue
                content = archive.extractfile(member)
                require(content is not None, "missing image tar content")
                digest, remaining, data = hashlib.sha256(), member.size, None
                with content:
                    while remaining:
                        block = content.read(min(CHUNK, remaining))
                        require(bool(block), "truncated image tar content")
                        # Keep bounded JSON metadata only; layer bytes are hashed
                        # incrementally and never accumulated in memory.
                        if remaining == member.size and member.size <= IMAGE_METADATA_LIMIT and block.lstrip()[:1] in (b"{", b"["):
                            retained += member.size
                            require(retained <= IMAGE_METADATA_TOTAL_LIMIT, "excessive image JSON metadata")
                            data = bytearray()
                        if data is not None:
                            data.extend(block)
                        digest.update(block)
                        remaining -= len(block)
                entries[name] = dict(size=member.size, digest="sha256:" + digest.hexdigest(), data=data)
    except (tarfile.TarError, OSError, EOFError) as error:
        raise PackageError("cannot read image archive") from error
    return entries


def image_json(entry: dict) -> object:
    require(isinstance(entry, dict) and entry.get("data") is not None, "missing or excessive image metadata")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate image JSON key")
            result[key] = value
        return result

    try:
        return json.loads(entry["data"], object_pairs_hook=unique)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise PackageError("invalid image JSON metadata") from error


def canonical_image_ref(reference: str) -> str:
    """Expand Docker's default registry/library without changing namespace or tag."""
    require(isinstance(reference, str) and REF_RE.fullmatch(reference), "invalid image reference")
    parts = reference.split("/")
    if len(parts) == 1:
        return "docker.io/library/" + reference
    if parts[0] == "docker.io":
        return "docker.io/library/" + parts[1] if len(parts) == 2 else reference
    if "." not in parts[0] and ":" not in parts[0] and parts[0] != "localhost":
        return "docker.io/" + reference
    return reference


def archive_image_identity(archive: Path, image: dict) -> dict:
    """Bind one exact ref to its config and optional single OCI descriptor path.

    The caller has already authenticated this complete archive through the signed
    package/member hashes. Docker stores may report either the config digest or
    a descriptor digest; the index.json export wrapper is never an image ID.
    """
    entries = image_archive_metadata(archive)
    docker_manifest = image_json(entries.get("manifest.json"))
    require(isinstance(docker_manifest, list) and len(docker_manifest) == 1 and
            isinstance(docker_manifest[0], dict), "ambiguous Docker image manifest")
    selected = docker_manifest[0]
    reference = canonical_image_ref(image["ref"])
    tags = selected.get("RepoTags")
    require(isinstance(tags, list) and len(tags) == 1 and canonical_image_ref(tags[0]) == reference,
            "image archive tag does not match signed reference")
    config_name, layers = selected.get("Config"), selected.get("Layers")
    require(isinstance(config_name, str) and valid_member(config_name) and
            isinstance(layers, list) and len(layers) <= 128 and
            all(isinstance(name, str) and valid_member(name) and isinstance(entries.get(name), dict) for name in layers),
            "invalid Docker image config or layers")
    config_entry = entries.get(config_name)
    config = image_json(config_entry)
    config_id = config_entry["digest"]
    require(config_name in (config_id[7:] + ".json", "blobs/sha256/" + config_id[7:]),
            "image config content does not match its archive name")
    require(isinstance(config, dict) and config.get("os") == "linux" and config.get("architecture") == "amd64" and
            config.get("variant", "") == "", "image config platform is not linux/amd64")
    rootfs = config.get("rootfs")
    require(isinstance(rootfs, dict) and rootfs.get("type") == "layers" and
            isinstance(rootfs.get("diff_ids"), list) and len(rootfs["diff_ids"]) == len(layers) and
            all(isinstance(value, str) and IMAGE_ID_RE.fullmatch(value) for value in rootfs["diff_ids"]),
            "invalid image root filesystem identity")
    chain = []
    if "index.json" in entries or "oci-layout" in entries:
        require(image_json(entries.get("oci-layout")) == {"imageLayoutVersion": "1.0.0"}, "unsupported OCI layout")
        index = image_json(entries.get("index.json"))
        for depth in range(8):
            require(isinstance(index, dict) and index.get("schemaVersion") == 2 and
                    index.get("mediaType", OCI_INDEX) in (OCI_INDEX, DOCKER_INDEX) and
                    isinstance(index.get("manifests"), list) and len(index["manifests"]) == 1,
                    "ambiguous or unsupported OCI image index")
            descriptor = index["manifests"][0]
            require(isinstance(descriptor, dict), "invalid OCI descriptor")
            annotations = descriptor.get("annotations", {})
            require(isinstance(annotations, dict), "invalid OCI image name annotations")
            if depth == 0:
                require(any(isinstance(value, str) and ("/" in value or ":" in value) and
                            canonical_image_ref(value) == reference for value in (
                                annotations.get("io.containerd.image.name"),
                                annotations.get("org.opencontainers.image.ref.name"))),
                        "OCI descriptor does not name the exact signed image")
            if "io.containerd.image.name" in annotations:
                require(canonical_image_ref(annotations["io.containerd.image.name"]) == reference,
                        "conflicting OCI image name")
            if "org.opencontainers.image.ref.name" in annotations:
                tag = annotations["org.opencontainers.image.ref.name"]
                require(tag == image["ref"].rsplit(":", 1)[-1] or canonical_image_ref(tag) == reference,
                        "conflicting OCI image tag")
            platform = descriptor.get("platform")
            require(platform is None or isinstance(platform, dict) and platform.get("os") == "linux" and
                    platform.get("architecture") == "amd64" and platform.get("variant", "") == "",
                    "OCI descriptor platform is not linux/amd64")
            identity, media_type = descriptor.get("digest"), descriptor.get("mediaType")
            require(isinstance(identity, str) and IMAGE_ID_RE.fullmatch(identity) and identity not in chain and
                    media_type in (OCI_MANIFEST, DOCKER_MANIFEST, OCI_INDEX, DOCKER_INDEX),
                    "invalid or cyclic OCI image descriptor")
            entry = entries.get("blobs/sha256/" + identity[7:])
            require(isinstance(entry, dict) and entry["digest"] == identity and
                    type(descriptor.get("size")) is int and descriptor["size"] == entry["size"],
                    "OCI image descriptor bytes differ")
            document = image_json(entry)
            require(isinstance(document, dict) and document.get("schemaVersion") == 2 and
                    document.get("mediaType") == media_type, "OCI image descriptor type differs")
            chain.append(identity)
            if media_type in (OCI_INDEX, DOCKER_INDEX):
                index = document
                continue
            config_descriptor = document.get("config")
            require(isinstance(config_descriptor, dict) and config_descriptor.get("digest") == config_id and
                    type(config_descriptor.get("size")) is int and config_descriptor["size"] == config_entry["size"] and
                    config_descriptor.get("mediaType") in ("application/vnd.oci.image.config.v1+json",
                                                          "application/vnd.docker.container.image.v1+json"),
                    "OCI and Docker config identities differ")
            oci_layers = document.get("layers")
            require(isinstance(oci_layers, list) and len(oci_layers) == len(layers), "OCI and Docker layers differ")
            for name, layer, diff_id in zip(layers, oci_layers, rootfs["diff_ids"]):
                require(isinstance(layer, dict) and layer.get("digest") == entries[name]["digest"] and
                        type(layer.get("size")) is int and layer["size"] == entries[name]["size"] and
                        layer.get("mediaType") in ("application/vnd.oci.image.layer.v1.tar",
                                                  "application/vnd.oci.image.layer.v1.tar+gzip",
                                                  "application/vnd.docker.image.rootfs.diff.tar.gzip"),
                        "OCI layer does not match Docker archive layer")
                if layer["mediaType"] == "application/vnd.oci.image.layer.v1.tar":
                    require(layer["digest"] == diff_id, "uncompressed image layer differs from config rootfs")
            break
        else:
            raise PackageError("OCI image descriptor chain is too deep")
    else:
        require(all(entries[name]["digest"] == diff_id for name, diff_id in zip(layers, rootfs["diff_ids"])),
                "classic image layers differ from config rootfs")
    require(image["id"] == config_id or image["id"] in chain, "signed image identity is not linked to its archive reference")
    return dict(config=config_id, descriptors=tuple(chain))


def load_image(archive: Path, image: dict) -> None:
    identity = archive_image_identity(archive, image)
    docker("load", "-i", str(archive), quiet=True)
    actual = docker("image", "inspect", "--format", "{{.Id}}", image["ref"], quiet=True)
    require(actual == identity["config"] or actual in identity["descriptors"],
            f"imported Docker image identity mismatch: {image['ref']}")
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


def read_active_environment(home: Path) -> dict[str, str]:
    """Read only existing module settings as literal values, never shell code."""
    keys = {"COMPOSE_PROFILES", "XD_MEDIA_WORKER_IMAGE", "XD_PHOTO_FACE_IMAGE"}
    for env_path in (home / "config" / ".env", home / ".env"):
        if env_path.is_file() and not env_path.is_symlink():
            values = {}
            for line in env_path.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator and key in keys:
                    values[key] = value.strip('"')
            return values
    return {}


def active_profiles(environment: dict[str, str], process_profiles: set[str]) -> set[str]:
    enabled = {part.strip() for part in process_profiles if part.strip()}
    enabled.update(part.strip() for part in environment.get("COMPOSE_PROFILES", "").split(",")
                   if part.strip())
    require(enabled.issubset(SUPPORTED_PROFILES), "unsupported Compose profile in offline configuration")
    return enabled


def validate_active_contracts(home: Path, manifest: dict, selection: tuple[str, ...],
                              process_profiles: set[str]) -> dict:
    """Fail closed when enabled old optional modules cannot be proven compatible."""
    state_file = home / "state" / "offline-installed.json"
    state: dict = {}
    if state_file.exists() or state_file.is_symlink():
        safe_file(state_file)
        value = json.loads(state_file.read_text(encoding="utf-8"))
        require(isinstance(value, dict) and value.get("schema") == 1,
                "invalid installed offline compatibility state")
        state = value
    environment = read_active_environment(home)
    enabled = active_profiles(environment, process_profiles)
    active_refs = {"media-worker": environment.get("XD_MEDIA_WORKER_IMAGE", ""),
                   "photo-intelligence": environment.get("XD_PHOTO_FACE_IMAGE", "")}
    contracts = manifest.get("contracts", {})
    module_rules = (
        ("media-worker", "media-worker", ("media_worker_api",)),
        ("photo-intelligence", "ai-runtime", ("photo_intelligence_api", "model_runtime_api")),
    )
    for profile, component, keys in module_rules:
        if profile not in enabled or component in selection:
            continue
        old_contracts = state.get("contracts")
        require(isinstance(old_contracts, dict) and
                all(k in old_contracts and k in contracts and
                    type(contracts[k]) is int and old_contracts[k] == contracts[k] for k in keys)
                and bool(active_refs.get(profile))
                and state.get("active_refs", {}).get(profile) == active_refs[profile],
                f"enabled {profile} compatibility is unverified; supply its offline module")
    return state


def record_successful_offline_install(home: Path, previous: dict, manifest: dict,
                                      selection: tuple[str, ...]) -> None:
    """Record installed identities only after the existing transactional installer succeeds."""
    state_dir = home / "state"
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not state_dir.is_symlink(), "unsafe offline state directory")
    state_file = state_dir / "offline-installed.json"
    require(not state_file.is_symlink(), "unsafe offline state file")
    installed = dict(previous.get("installed", {}))
    for component in selection:
        installed[component] = {
            "fingerprint": manifest.get("fingerprints", {}).get(component),
            "sha256": manifest["packages"][component]["sha256"],
            "build_commit": manifest["packages"][component].get("built_from_commit"),
        }
    active_refs = {}
    for env_path in (home / "config" / ".env", home / ".env"):
        if env_path.is_file() and not env_path.is_symlink():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("XD_MEDIA_WORKER_IMAGE="):
                    active_refs["media-worker"] = line.partition("=")[2].strip('"')
                if line.startswith("XD_PHOTO_FACE_IMAGE="):
                    active_refs["photo-intelligence"] = line.partition("=")[2].strip('"')
            break
    value = {
        "schema": 1,
        "active_refs": active_refs,
        "source_commit": manifest["source_commit"],
        "contracts": manifest.get("contracts", {}),
        "installed": installed,
    }
    with tempfile.NamedTemporaryFile(mode="w", prefix=".offline-installed-", dir=state_dir,
                                     encoding="utf-8", delete=False) as stream:
        temp = Path(stream.name)
        json.dump(value, stream, sort_keys=True)
        stream.write("\n")
    try:
        temp.chmod(0o600)
        temp.replace(state_file)
    finally:
        if temp.exists():
            temp.unlink()


def offline_install(args: argparse.Namespace, manifest: dict, selection: tuple[str, ...]) -> None:
    require("app" in selection, "offline install requires the App package")
    update_source = getattr(args, "update_source", None)
    if update_source is not None:
        require(update_source == "xdrive" and manifest["source"] == "github"
                and manifest["channel"] == "master",
                "Share update preference requires a verified GitHub master package")
        require(SHARE_PROVIDER_ASSET in manifest["packages"]["app"]["members"],
                "Share provider is missing from the App package; rebuild App before Share activation")
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
                if line.startswith("XD_POSTGRES_IMAGE="):
                    current = line.split("=", 1)[1].strip('"')
                    if current not in ("", postgres_ref, "postgres:17-alpine") and not re.fullmatch(
                            r"xdrive/offline-postgres:sha-[a-f0-9]{12}", current):
                        raise PackageError("existing custom PostgreSQL image needs a separate migration plan")
            break
    profiles = active_profiles(read_active_environment(home),
                               set(os.environ.get("COMPOSE_PROFILES", "").split(",")))
    previous_state = validate_active_contracts(home, manifest, selection, profiles)
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
        # A shell/CI image override must not outrank the authenticated package
        # or the transactional .env restored on failure. Supply only dedicated
        # offline inputs, including when an App package predates this delivery.
        for key in ("XD_SERVER_IMAGE", "XD_CADDY_IMAGE", "XD_POSTGRES_IMAGE", "XD_WEB_IMAGE",
                    "XD_MEDIA_WORKER_IMAGE", "XD_PHOTO_FACE_IMAGE", "XD_CADDY_RESCUE_IMAGE",
                    "XD_SOURCE_REF", "XD_IMAGE_TAG", "XD_IMAGE_REGISTRY", "XD_BUILT_CHANNEL",
                    "XD_BUILT_COMMIT", "XD_BUILT_SOURCE", "XD_OFFLINE_SERVER_IMAGE",
                    "XD_OFFLINE_CADDY_IMAGE", "XD_OFFLINE_POSTGRES_IMAGE",
                    "XD_OFFLINE_MEDIA_IMAGE", "XD_OFFLINE_PHOTO_IMAGE"):
            environment.pop(key, None)
        environment["XD_OFFLINE_ASSET_DIR"] = str(app_assets)
        environment["XD_INSTALL_SOURCE"] = manifest["source"]
        environment["XD_INSTALL_CHANNEL"] = manifest["channel"]
        environment.pop("XD_OFFLINE_UPDATE_SOURCE", None)
        if update_source:
            environment["XD_OFFLINE_UPDATE_SOURCE"] = update_source
        for name in ("server", "caddy", "postgres"):
            environment["XD_OFFLINE_" + name.upper() + "_IMAGE"] = manifest["images"][name]["ref"]
        # Accepted older offline installers use this input name. Current
        # installers capture it and remove the export before Compose/rollback.
        environment["XD_POSTGRES_IMAGE"] = postgres_ref
        # Never let an inherited online pull be enabled on this process.
        environment["XD_OFFLINE_NO_PULL"] = "1"
        if "media-worker" in selection:
            environment["XD_OFFLINE_MEDIA_IMAGE"] = manifest["images"]["media-worker"]["ref"]
        if photo_ref:
            environment["XD_OFFLINE_PHOTO_IMAGE"] = photo_ref
        environment["XD_CONFIG_DIR"] = str(home)
        environment.pop("XD_INSTALL_NO_START", None)
        if args.no_start:
            environment["XD_INSTALL_NO_START"] = "1"
        if args.enable_media:
            require("media-worker" in selection, "--enable-media requires the Media Worker package")
            profiles.add("media-worker")
        if args.enable_ai:
            require(photo_ref is not None, "--enable-ai requires AI Runtime and AI Models packages")
            profiles.add("photo-intelligence")
        environment["COMPOSE_PROFILES"] = ",".join(sorted(profiles))
        command = ["bash", str(installer), "--source", manifest["source"],
                   "--channel", manifest["channel"]]
        if getattr(args, "backup_file_data", False):
            command.append("--backup-file-data")
        print("[offline] activating verified local release via xDrive transactional installer", flush=True)
        subprocess.run(command, env=environment, stdin=None, check=True)
        if not args.no_start:
            record_successful_offline_install(home, previous_state, manifest, selection)


def build_packages(args: argparse.Namespace) -> None:
    require(bool(COMMIT_RE.fullmatch(args.commit)), "--commit must be a full source SHA")
    require(args.channel in ("master", "stable"), "invalid --channel")
    require(args.source in ("github", "gitlab"), "invalid --source")
    source = args.prepared
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    require(not output.is_symlink(), "output must not be a symlink")
    previous = None
    if getattr(args, "reuse_manifest", None):
        require(args.reuse_manifest.name == "manifest.json", "previous manifest must be named manifest.json")
        previous = parse_manifest(args.reuse_manifest.parent, None, require_trust=False)
        require(previous.get("schema") == 2, "cannot reuse legacy schema 1 packages")
        require(previous["source"] == args.source and previous["channel"] == args.channel,
                "cannot reuse a different provider or channel")
    plan = None
    if getattr(args, "plan", None):
        plan = json.loads(safe_file(args.plan).read_text(encoding="utf-8"))
        require(isinstance(plan, dict) and plan.get("schema") == 1, "invalid content-change plan")
        fingerprints = plan.get("fingerprints")
        changed = plan.get("changed")
        contracts = plan.get("contracts")
        require(isinstance(fingerprints, dict) and set(fingerprints) == set(COMPONENTS)
                and all(isinstance(x, str) and bool(SHA_RE.fullmatch(x))
                        for x in fingerprints.values()), "invalid planned fingerprints")
        require(isinstance(changed, list) and set(changed).issubset(COMPONENTS)
                and len(changed) == len(set(changed)), "invalid changed components")
        require(isinstance(contracts, dict) and set(contracts) == {"postgres_major", "media_worker_api",
                "photo_intelligence_api", "model_runtime_api"}
                and all(type(x) is int and x > 0 for x in contracts.values()),
                "invalid planned compatibility contracts")
        if previous:
            require(set(previous["packages"]) == set(COMPONENTS), "incomplete previous manifest")
            require(all(previous["fingerprints"][n] == fingerprints[n] for n in COMPONENTS
                        if n not in changed), "changed plan disagrees with previous manifest")
            require(all(previous["fingerprints"][n] != fingerprints[n] for n in changed),
                    "unchanged component marked for rebuilt publication")
        else:
            require(set(changed) == set(COMPONENTS), "first release must build all five components")
    else:
        changed = list(COMPONENTS)
        fingerprints = None
        contracts = None
    images = json.loads(safe_file(source / "images.json").read_text(encoding="utf-8"))
    require(isinstance(images, dict) and set(images) == set(IMAGE_MEMBERS), "invalid images.json keys")
    for key, value in images.items():
        require(isinstance(value, dict) and isinstance(value.get("ref"), str)
                and bool(REF_RE.fullmatch(value["ref"]))
                and isinstance(value.get("id"), str)
                and bool(IMAGE_ID_RE.fullmatch(value["id"])), f"invalid image metadata: {key}")
        if previous and IMAGE_MEMBERS[key][0] not in changed:
            require(value == previous["images"][key], f"reused Docker image identity changed: {key}")

    packages = {}
    for component in COMPONENTS:
        if component not in changed:
            require(previous is not None, "cannot reuse without previous release")
            packages[component] = previous["packages"][component]
            continue
        component_dir = source / component
        members = component_members(component_dir)
        for key, (owner, member) in IMAGE_MEMBERS.items():
            if component == owner:
                require(member in members, f"missing component image archive: {member}")
        if component == "app":
            require(set(REQUIRED_ASSETS).issubset(members), "App package missing deployment scripts")
        with tempfile.NamedTemporaryFile(prefix=f".{component}-", suffix=".tar.gz",
                                         dir=output, delete=False) as tempfile_handle:
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
            entry = {"filename": name, "sha256": digest,
                     "size": destination.stat().st_size, "members": members}
            if plan:
                entry.update({"fingerprint": fingerprints[component],
                              "built_from_commit": args.commit,
                              "release_tag": f"offline-{component}-{digest[:12]}"})
            packages[component] = entry
        finally:
            if temp_path.exists():
                temp_path.unlink()
    require(set(REQUIRED_ASSETS).issubset(packages["app"]["members"]),
            "App package missing deployment scripts; rebuild App instead of reusing it")
    manifest = {
        "schema": 2 if plan else 1,
        "platform": "linux/amd64", "source": args.source,
        "source_commit": args.commit, "channel": args.channel,
        "packages": packages, "images": images,
    }
    if plan:
        manifest["fingerprints"] = fingerprints
        manifest["contracts"] = contracts
    manifest_path = output / "manifest.json"
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2)
                      + "\n").encode("utf-8")
    if manifest_path.exists():
        require(manifest_path.read_bytes() == manifest_bytes,
                "refusing to overwrite a different manifest")
    else:
        manifest_path.write_bytes(manifest_bytes)
    checksums = [f"{hash_file(manifest_path)}  manifest.json"]
    for component in COMPONENTS:
        item = packages[component]
        # Omit reused archives from this release's local checksum list.
        if (output / item["filename"]).is_file():
            checksums.append(f"{item['sha256']}  {item['filename']}")
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")
    print(f"[offline] manifest SHA-256: {hash_file(manifest_path)}")
    for component in COMPONENTS:
        entry = packages[component]
        action = "new" if component in changed else "reuse"
        print(f"[offline] {component} ({action}): {entry['filename']} ({entry['size']} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description="xDrive five-package offline distribution")
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("build", help="Create five deterministic, immutable offline package archives")
    make.add_argument("--prepared", required=True, type=Path)
    make.add_argument("--output", required=True, type=Path)
    make.add_argument("--commit", required=True)
    make.add_argument("--source", choices=("github", "gitlab"), default="github")
    make.add_argument("--channel", choices=("master", "stable"), default="master")
    make.add_argument("--plan", type=Path, help="Content-fingerprint plan from component_plan.py")
    make.add_argument("--reuse-manifest", type=Path, help="Previously authenticated immutable release Manifest")
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
            item.add_argument("--update-source", choices=("xdrive",),
                              help="Persist the Share transport independently of package provenance")
            item.add_argument("--backup-file-data", action="store_true")
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
