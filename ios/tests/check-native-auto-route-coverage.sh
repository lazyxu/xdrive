#!/usr/bin/env bash
set -euo pipefail
# Enforce that every native URLSession sending HTTP to xDrive uses the
# single route policy. These four files deliberately create *direct* probe
# sessions to avoid recursion during TLS / Owner / BG Grant verification.
ignored='^(NativeAutoNetworkRoute|NativeLANLoginRoute|OwnerRootVerifier|ApprovedBackgroundPhotoVault)\.swift$'
fail=0
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  path="${entry%%:*}"
  filename="${path##*/}"
  if [[ "$filename" =~ $ignored ]]; then continue; fi
  printf 'Unrouted native URLSession: %s\n' "$entry"
  fail=1
done < <(
  git grep -nE 'URLSessionConfiguration\.(ephemeral|default|background)|URLSession\.shared' \
    -- ios/XDriveIOS ':!ios/XDriveIOS/Assets.xcassets' || true
)
if (( fail )); then
  echo 'ERROR: xDrive native sessions must use XDriveIOSAutoRoute.ephemeralConfiguration()'
  exit 1
fi
echo 'iOS LAN/WAN route coverage: no unowned URLSession clients'
