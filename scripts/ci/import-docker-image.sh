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

# Containerd-backed builders can identify an OCI index, while docker save
# exports the selected platform config. Engine versions can report either
# immutable ID after loading. Accept only the two IDs from the same export.
source_id_file="$artifact_dir/image.source.id"
source_id=""
if [[ -e "$source_id_file" || -L "$source_id_file" ]]; then
  [[ -f "$source_id_file" && ! -L "$source_id_file" && -s "$source_id_file" ]] || {
    echo "Docker image source ID file is missing or unsafe: $source_id_file" >&2
    exit 1
  }
  source_id="$(tr -d '\r\n' < "$source_id_file")"
  [[ "$source_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Invalid CI-produced source image ID: $source_id_file" >&2
    exit 1
  }
fi

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
if [[ "$actual_id" != "$expected_id" && ( -z "$source_id" || "$actual_id" != "$source_id" ) ]]; then
  echo "loaded Docker image ID mismatch: got $actual_id want exported platform $expected_id or OCI index ${source_id:-<absent>} for $image" >&2
  exit 1
fi

echo "Loaded exact Docker image $image ($actual_id)"
