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
  # The standalone macOS LAN trust policy test compiles AuthService without
  # the iOS router's Owner/Grant graph. Permit exactly one direct fallback
  # solely in #else of #if os(iOS); this must never excuse an iOS HTTP bypass.
  if [[ "$filename" == "AuthService.swift" &&
        "$entry" == *"URLSessionConfiguration.ephemeral"* ]] &&
     python3 - "$path" <<'PY'
import re, sys
source = open(sys.argv[1], encoding="utf-8").read()
block = (r"#if os\(iOS\)\s+"
         r"let config = XDriveIOSAutoRoute\.ephemeralConfiguration\(\)\s+"
         r"#else\s+let config = URLSessionConfiguration\.ephemeral\s+#endif")
if (len(re.findall(block, source)) != 1
        or len(re.findall(r"URLSessionConfiguration\.ephemeral", source)) != 1):
    sys.exit(1)
PY
  then
    continue
  fi
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
