#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:?artifact directory is required}"
image="${2:?expected image reference is required}"

archive="$artifact_dir/image.tar.gz"
id_file="$artifact_dir/image.id"

test -s "$archive" || {
  echo "Docker image archive is missing: $archive" >&2
  exit 1
}
test -s "$id_file" || {
  echo "Docker image ID file is missing: $id_file" >&2
  exit 1
}

expected_id="$(tr -d '\r\n' < "$id_file")"
gzip -t "$archive"
gzip -dc "$archive" | docker load >/dev/null

actual_id="$(docker image inspect --format '{{.Id}}' "$image")"
if [[ "$actual_id" != "$expected_id" ]]; then
  echo "loaded Docker image ID mismatch: got $actual_id want $expected_id for $image" >&2
  exit 1
fi

echo "Loaded exact Docker image $image ($actual_id)"
