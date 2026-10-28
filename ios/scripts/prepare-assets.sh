#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
original="$repo_root/assets/icon/web/pwa-512.png"
assets="$repo_root/ios/XDriveIOS/Assets.xcassets"
test -s "$original"
mkdir -p "$assets/Brand.imageset" "$assets/AppIcon.appiconset"
cp "$original" "$assets/Brand.imageset/Brand.png"

if command -v sips >/dev/null 2>&1; then
  sips -z 1024 1024 "$original" --out "$assets/AppIcon.appiconset/AppIcon.png" >/dev/null
elif command -v magick >/dev/null 2>&1; then
  magick "$original" -resize 1024x1024 "$assets/AppIcon.appiconset/AppIcon.png"
else
  echo "A PNG resizer is required (macOS sips or ImageMagick magick)." >&2
  exit 1
fi

test -s "$assets/Brand.imageset/Brand.png"
test -s "$assets/AppIcon.appiconset/AppIcon.png"
