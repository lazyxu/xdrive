#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
source_file="$tmp/source.bin"
dest_file="$tmp/dest.bin"

python3 - "$source_file" <<'PY'
import sys
path = sys.argv[1]
with open(path, "wb") as f:
    f.write(bytes((i % 251 for i in range(1024 * 1024))))
PY

head -c 131072 "$source_file" > "$dest_file"
XDRIVE_CI_DOWNLOAD_ATTEMPTS=2 bash scripts/ci/download-with-fallback.sh \
  "$dest_file" \
  "file://$tmp/does-not-exist" \
  "file://$source_file"
cmp "$source_file" "$dest_file"

echo "CI resumable download fallback: OK"
