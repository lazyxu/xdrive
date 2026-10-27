#!/usr/bin/env bash
# Allow only exact Backup CLI archives, the CI-built Caddy fallback archive,
# and the verified armada38x SPK.
set -euo pipefail

release_dir="${1:-release}"
if [[ ! -d "$release_dir" ]]; then
  echo "release archive verification: missing directory: $release_dir" >&2
  exit 1
fi

for name in xdrive-backup-linux-amd64.tar.gz xdrive-backup-windows-amd64.zip xdrive-caddy-image.tar.gz xdrive-caddy-image.id; do
  file="$release_dir/$name"
  if [[ ! -f "$file" || ! -s "$file" || -L "$file" ]]; then
    echo "release archive verification: missing, empty, or linked Backup CLI artifact: $name" >&2
    exit 1
  fi
done

# Include hidden names and links; GH Release must never silently publish
# another archive or substitute a symlink for one of the two exact packages.
shopt -s nullglob dotglob
for file in "$release_dir"/*.zip "$release_dir"/*.tar.gz "$release_dir"/*.tgz "$release_dir"/*.spk; do
  case "${file##*/}" in
    xdrive-backup-linux-amd64.tar.gz|xdrive-backup-windows-amd64.zip|xdrive-caddy-image.tar.gz|xdrivenas-armada38x-*.spk)
      [[ -f "$file" && -s "$file" && ! -L "$file" ]] || {
        echo "release archive verification: invalid Backup CLI artifact: $file" >&2
        exit 1
      }
      ;;
    *)
      echo "release archive verification: unexpected archive: $file" >&2
      exit 1
      ;;
  esac
done

echo "Release archive contract passed: two Backup CLI archives, signed Caddy image and armada38x SPK only."
