#!/usr/bin/env bash
set -euo pipefail

[[ "$#" == 2 ]] || { echo "usage: export-docker-image.sh IMAGE OUTPUT_DIR" >&2; exit 2; }
image="$1"
out_dir="$2"

command -v docker >/dev/null
command -v gzip >/dev/null
command -v python3 >/dev/null
docker image inspect "$image" >/dev/null

mkdir -p "$out_dir"
archive="$out_dir/image.tar.gz"
docker save "$image" | gzip -1 > "$archive"
gzip -t "$archive"

# Docker 29 containerd-backed stores may expose the OCI index digest as .Id.
# The saved config blob SHA-256 is the identity a second Docker daemon loads.
# Derive the expected ID from the actual gzip-verified archive, not a tag.
image_id="$(python3 - "$archive" "$image" <<'PY'
import hashlib
import json
import re
import sys
import tarfile

archive_path, image = sys.argv[1:]
def fail(message):
    raise SystemExit(f"Invalid Docker save image artifact: {message}")

try:
    with tarfile.open(archive_path, "r:gz") as tf:
        manifest = tf.getmember("manifest.json")
        if not manifest.isfile() or not 0 < manifest.size <= 2 * 1024 * 1024:
            fail("manifest.json missing or too large")
        entries = json.loads(tf.extractfile(manifest).read())
        if not isinstance(entries, list):
            fail("expected Docker save manifest array")
        matching = [
            entry for entry in entries
            if isinstance(entry, dict) and (
                image in (entry.get("RepoTags") or []) or
                "docker.io/" + image in (entry.get("RepoTags") or [])
            )
        ]
        if len(entries) != 1 or len(matching) != 1:
            fail("archive must contain exactly the requested image/tag")
        config_name = matching[0].get("Config")
        if not isinstance(config_name, str) or not re.fullmatch(
            r"(?:blobs/sha256/)?[0-9a-f]{64}(?:\.json)?", config_name
        ):
            fail("invalid config blob path")
        config = tf.getmember(config_name)
        if not config.isfile() or not 0 < config.size <= 4 * 1024 * 1024:
            fail("config blob missing or too large")
        content = tf.extractfile(config).read()
        digest = hashlib.sha256(content).hexdigest()
        declared = config_name.rsplit("/", 1)[-1].removesuffix(".json")
        if digest != declared:
            fail("config blob bytes disagree with Docker archive manifest")
        print("sha256:" + digest)
except (OSError, KeyError, ValueError, tarfile.TarError) as error:
    fail(str(error))
PY
)" || { echo "Failed to derive verified Docker config ID: $image" >&2; exit 1; }
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Invalid config ID in CI-produced Docker archive: $image" >&2
  exit 1
}
printf '%s\n' "$image_id" > "$out_dir/image.id"
printf '%s\n' "$image" > "$out_dir/image.ref"
echo "Exported exact Docker image $image ($image_id) to $archive"
