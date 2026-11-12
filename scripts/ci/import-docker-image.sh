#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:?artifact directory is required}"
image="${2:?expected image reference is required}"
archive="$artifact_dir/image.tar.gz"
id_file="$artifact_dir/image.id"

# Release artifacts are exact CI-produced regular files, never links or pipes.
[[ -f "$archive" && ! -L "$archive" && -s "$archive" ]] || {
  echo "Docker image archive is missing or unsafe: $archive" >&2
  exit 1
}
[[ -f "$id_file" && ! -L "$id_file" && -s "$id_file" ]] || {
  echo "Docker image ID file is missing or unsafe: $id_file" >&2
  exit 1
}
expected_id="$(tr -d '\r\n' < "$id_file")"
[[ "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Invalid CI-produced Docker image ID: $id_file" >&2
  exit 1
}

# A large image could previously strand a release job indefinitely during
# gzip -dc | docker load. One pipefail-bound pass verifies gzip CRC AND loads
# the exact archive; never decompress the entire archive twice.
import_seconds="${XD_IMPORT_DOCKER_TIMEOUT_SECONDS:-900}"
if [[ ! "$import_seconds" =~ ^[1-9][0-9]{0,3}$ ]] || (( import_seconds > 1800 )); then
  echo "Invalid Docker image import timeout (expected 1..1800 seconds)" >&2
  exit 2
fi
command -v timeout >/dev/null 2>&1 || {
  echo "timeout is required for bounded Docker image import" >&2
  exit 1
}
printf '[xDrive] Loading CI image %s (compressed %s bytes, timeout %ss)\n' \
  "$image" "$(wc -c < "$archive")" "$import_seconds" >&2
if timeout --signal=TERM --kill-after=10s "${import_seconds}s" \
    bash -o pipefail -c 'gzip -dc -- "$1" | docker load' _ "$archive"; then
  :
else
  result=$?
  if [[ "$result" == 124 || "$result" == 137 ]]; then
    echo "Docker image import timed out for $image (no release promoted)" >&2
  else
    echo "Docker image import failed for $image (exit $result; no release promoted)" >&2
  fi
  exit "$result"
fi

if ! actual_id="$(timeout --signal=TERM --kill-after=10s 30s \
    docker image inspect --format '{{.Id}}' "$image")"; then
  echo "Docker image inspection failed or timed out: $image" >&2
  exit 1
fi
if [[ "$actual_id" != "$expected_id" ]]; then
  # Docker 29's containerd image store may report the attested OCI *index*
  # as .Id, while Docker's classic/rootless store reports the platform config
  # digest. In that case, do not accept an unrelated index or waive the check:
  # re-export the EXACT LOADED TAG and verify its config bytes against the
  # cryptographic config ID derived from the original CI archive at export.
  command -v python3 >/dev/null 2>&1 || {
    echo "loaded Docker image ID mismatch: Python verification unavailable" >&2
    exit 1
  }
  verification_dir="$(mktemp -d /tmp/xdrive-docker-identity.XXXXXXXX)" || exit 1
  trap 'rm -rf -- "$verification_dir"' EXIT
  if ! timeout --signal=TERM --kill-after=10s 120s \
      docker save "$image" > "$verification_dir/loaded.tar"; then
    echo "loaded Docker image ID mismatch: cannot verify the loaded tag config (got $actual_id want $expected_id)" >&2
    exit 1
  fi
  if ! loaded_config_id="$(python3 - "$verification_dir/loaded.tar" "$image" <<'PY'
import hashlib
import json
import re
import sys
import tarfile

archive_path, requested = sys.argv[1:]
def fail(reason):
    raise SystemExit("Invalid loaded Docker image config: " + reason)

try:
    with tarfile.open(archive_path, mode="r:") as saved:
        manifest = saved.getmember("manifest.json")
        if not manifest.isfile() or not 0 < manifest.size <= 1 << 20:
            fail("missing or invalid manifest")
        stream = saved.extractfile(manifest)
        if stream is None:
            fail("cannot read manifest")
        entries = json.load(stream)
        if not isinstance(entries, list):
            fail("manifest must be a list")
        matches = [
            entry for entry in entries
            if isinstance(entry, dict)
            and isinstance(entry.get("RepoTags"), list)
            and requested in entry["RepoTags"]
        ]
        if len(matches) != 1:
            fail("loaded archive does not have exactly one requested tag")
        config_path = matches[0].get("Config")
        if not isinstance(config_path, str) or re.fullmatch(
            r"(?:blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}\.json)", config_path
        ) is None:
            fail("unsafe or missing config path")
        config = saved.getmember(config_path)
        if not config.isfile() or not 0 < config.size <= 16 << 20:
            fail("missing or invalid config member")
        stream = saved.extractfile(config)
        if stream is None:
            fail("cannot read config bytes")
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
        raw_digest = digest.hexdigest()
        if raw_digest != config_path.rsplit("/", 1)[-1].removesuffix(".json"):
            fail("config bytes do not match their content-addressed path")
        print("sha256:" + raw_digest)
except (KeyError, OSError, ValueError, tarfile.TarError) as exc:
    fail(str(exc))
PY
)"; then
    echo "loaded Docker image ID mismatch: invalid loaded archive (got $actual_id want $expected_id)" >&2
    exit 1
  fi
  if [[ "$loaded_config_id" != "$expected_id" ]]; then
    echo "loaded Docker image ID mismatch: index=$actual_id config=$loaded_config_id expected=$expected_id for $image" >&2
    exit 1
  fi
  echo "Loaded exact Docker image $image (index $actual_id; verified platform config $loaded_config_id)"
else
  echo "Loaded exact Docker image $image ($actual_id)"
fi
