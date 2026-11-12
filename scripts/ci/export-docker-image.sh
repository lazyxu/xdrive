#!/usr/bin/env bash
set -euo pipefail

image="${1:?image reference is required}"
out_dir="${2:?output directory is required}"

command -v docker >/dev/null
command -v gzip >/dev/null
command -v python3 >/dev/null
docker image inspect "$image" >/dev/null

mkdir -p "$out_dir"
archive="$out_dir/image.tar.gz"
# Never leave a successful-looking sidecar from a prior export if a new image
# cannot be serialized or its config is unverified.
rm -f -- "$out_dir/image.id" "$out_dir/image.ref"

docker save "$image" | gzip -1 > "$archive"
gzip -t "$archive"

# Docker BuildKit can tag an OCI manifest *list* with attestations. On the
# builder, docker image inspect .Id then reports that index's sha256; docker
# save/load on a fresh (including rootless) daemon imports its selected
# platform config, whose sha256 is the actual loaded image ID. Derive the
# identity from the exact saved artifact instead of recording the index ID.
# Require a tagged, regular config member and verify its actual bytes: this
# preserves import-docker-image.sh's exact-ID fail-closed check.
image_id="$(python3 - "$archive" "$image" <<'PY'
import hashlib
import json
import re
import sys
import tarfile

archive_path, requested = sys.argv[1:]
def fail(reason):
    raise SystemExit("Invalid Docker image export: " + reason)

try:
    with tarfile.open(archive_path, mode="r:gz") as saved:
        manifest = saved.getmember("manifest.json")
        if not manifest.isfile() or not 0 < manifest.size <= 1 << 20:
            fail("manifest.json missing or invalid")
        stream = saved.extractfile(manifest)
        if stream is None:
            fail("manifest.json cannot be read")
        entries = json.load(stream)
        if not isinstance(entries, list):
            fail("manifest.json is not a list")
        tagged = [
            entry for entry in entries
            if isinstance(entry, dict)
            and isinstance(entry.get("RepoTags"), list)
            and requested in entry["RepoTags"]
        ]
        if len(tagged) != 1:
            fail("archive does not contain exactly one requested image tag")
        config_path = tagged[0].get("Config")
        if not isinstance(config_path, str) or re.fullmatch(
            r"(?:blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}\.json)", config_path
        ) is None:
            fail("unsafe Docker image config path")
        config = saved.getmember(config_path)
        if not config.isfile() or not 0 < config.size <= 16 << 20:
            fail("Docker image config is missing or invalid")
        content = saved.extractfile(config)
        if content is None:
            fail("Docker image config is unreadable")
        digest = hashlib.sha256()
        for chunk in iter(lambda: content.read(1 << 20), b""):
            digest.update(chunk)
        hex_digest = digest.hexdigest()
        named_digest = config_path.rsplit("/", 1)[-1].removesuffix(".json")
        if hex_digest != named_digest:
            fail("archive config filename and content digest differ")
        print("sha256:" + hex_digest)
except (KeyError, OSError, ValueError, tarfile.TarError, json.JSONDecodeError) as exc:
    fail(str(exc))
PY
)"
printf '%s\n' "$image_id" > "$out_dir/image.id"
printf '%s\n' "$image" > "$out_dir/image.ref"

echo "Exported exact Docker image $image ($image_id) to $archive"
