#!/usr/bin/env bash
set -euo pipefail

image="$1"
out_dir="$2"
[[ -n "$image" && -n "$out_dir" ]] || {
  echo "image reference and output directory are required" >&2
  exit 2
}

command -v docker >/dev/null
command -v gzip >/dev/null
command -v python3 >/dev/null
mkdir -p "$out_dir"
archive="$out_dir/image.tar.gz"

# On containerd-backed Docker, inspect .Id can be an OCI INDEX digest,
# whereas docker load reports the selected PLATFORM CONFIG digest. These are
# distinct correct hashes. Fail closed if the referenced tag changes while
# saving, but bind image.id to the actual exported platform config bytes.
source_before="$(docker image inspect --format '{{.Id}}' "$image")"
[[ "$source_before" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Docker source image has no valid immutable reference ID" >&2
  exit 1
}
docker save "$image" | gzip -1 > "$archive"
gzip -t "$archive"
source_after="$(docker image inspect --format '{{.Id}}' "$image")"
[[ "$source_after" == "$source_before" ]] || {
  echo "Docker image reference changed while exporting; refusing mixed artifact" >&2
  exit 1
}

# Never assume an index digest equals the archive's platform-specific config.
# Read only manifest.json and its named config; never extract tar paths.
archive_id="$(python3 - "$archive" "$image" <<'PY'
import hashlib
import json
import re
import sys
import tarfile

archive, expected_ref = sys.argv[1:]
with tarfile.open(archive, mode="r:gz") as tar:
    manifest_file = tar.extractfile("manifest.json")
    if manifest_file is None:
        raise SystemExit("Docker archive is missing manifest.json")
    manifest = json.load(manifest_file)
    if not isinstance(manifest, list) or len(manifest) != 1:
        raise SystemExit("Docker archive must contain exactly one platform image")
    entry = manifest[0]
    if not isinstance(entry, dict) or entry.get("RepoTags") != [expected_ref]:
        raise SystemExit("Docker archive tag does not match the expected reference")
    config_path = entry.get("Config")
    if not isinstance(config_path, str):
        raise SystemExit("Docker archive has no platform image config")
    match = re.fullmatch(
        r"(?:blobs/sha256/([0-9a-f]{64})|([0-9a-f]{64})\.json)",
        config_path,
    )
    if not match:
        raise SystemExit("Docker archive config path is not a digest-addressed file")
    member = tar.getmember(config_path)
    if not member.isfile() or member.size < 2 or member.size > 16 * 1024 * 1024:
        raise SystemExit("Docker image config is not a bounded regular file")
    stream = tar.extractfile(member)
    if stream is None:
        raise SystemExit("Docker image config is not readable")
    content = stream.read()
    digest = hashlib.sha256(content).hexdigest()
    if digest != (match.group(1) or match.group(2)):
        raise SystemExit("Docker image config SHA-256 does not match archive path")
    config = json.loads(content)
    if (not isinstance(config, dict) or
            config.get("os") != "linux" or
            config.get("architecture") not in ("amd64", "arm64") or
            not isinstance(config.get("rootfs"), dict) or
            config["rootfs"].get("type") != "layers" or
            not isinstance(config["rootfs"].get("diff_ids"), list)):
        raise SystemExit("Docker archive does not contain an actual Linux platform config")
    print("sha256:" + digest)
PY
)"
[[ "$archive_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Docker export did not establish a verified platform image config ID" >&2
  exit 1
}
printf '%s\n' "$archive_id" > "$out_dir/image.id"
printf '%s\n' "$image" > "$out_dir/image.ref"

echo "Exported exact Docker platform image $image ($archive_id) to $archive"
