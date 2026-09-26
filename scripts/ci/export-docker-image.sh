#!/usr/bin/env bash
set -euo pipefail

image="${1:?image reference is required}"
out_dir="${2:?output directory is required}"

command -v docker >/dev/null
command -v gzip >/dev/null
docker image inspect "$image" >/dev/null

mkdir -p "$out_dir"
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
archive="$out_dir/image.tar.gz"

docker save "$image" | gzip -1 > "$archive"
gzip -t "$archive"
printf '%s\n' "$image_id" > "$out_dir/image.id"
printf '%s\n' "$image" > "$out_dir/image.ref"

echo "Exported exact Docker image $image ($image_id) to $archive"
