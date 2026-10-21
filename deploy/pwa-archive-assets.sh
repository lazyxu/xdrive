#!/bin/sh
# Only PUBLIC, content-hashed Vite build assets. No API, media or credentials.
set -eu
umask 022
if [ "$#" -ne 2 ]; then
  echo "xDrive archive: expected IMAGE_ASSETS ARCHIVE_DIR" >&2
  exit 2
fi
source_root="$1"
archive_root="$2"
if [ ! -d "$source_root" ] || [ -L "$source_root" ] ||
   [ ! -d "$archive_root" ] || [ -L "$archive_root" ]; then
  echo "xDrive archive: invalid asset directory" >&2
  exit 1
fi
if [ -z "$(find "$source_root" -type f -print -quit)" ] ||
   [ -n "$(find "$source_root" -type l -print -quit)" ] ||
   [ -n "$(find "$archive_root" -type l -print -quit)" ]; then
  echo "xDrive archive: empty source or symbolic link" >&2
  exit 1
fi
# Atomic hard-link publication guarantees older bytes are never overwritten.
find "$source_root" -type f -print | while IFS= read -r origin; do
  relative="${origin#"$source_root"/}"
  if ! printf '%s\n' "$relative" | grep -Eq '^([A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(js|css|svg|png|webp|woff|woff2|jpg|jpeg|gif|avif|wasm)$'; then
    echo "xDrive archive: non-hashed public asset rejected" >&2
    exit 1
  fi
  target="$archive_root/$relative"
  directory="${target%/*}"
  mkdir -p "$directory"
  if [ -e "$target" ] || [ -L "$target" ]; then
    if [ ! -f "$target" ] || [ -L "$target" ] || ! cmp -s "$origin" "$target"; then
      echo "xDrive archive: immutable asset collision" >&2
      exit 1
    fi
    continue
  fi
  temp="$(mktemp "$directory/.xdrive-new-asset.XXXXXX")"
  if ! cp "$origin" "$temp" || ! chmod 0644 "$temp"; then
    rm -f "$temp"
    echo "xDrive archive: copy failed" >&2
    exit 1
  fi
  if ! ln "$temp" "$target" 2>/dev/null; then
    if [ ! -f "$target" ] || [ -L "$target" ] || ! cmp -s "$origin" "$target"; then
      rm -f "$temp"
      echo "xDrive archive: concurrent hash collision" >&2
      exit 1
    fi
  fi
  rm -f "$temp"
done
