#!/usr/bin/env bash
# Read-only real-Host closeout entry point. No deployment, installation or signing.
set -euo pipefail
usage='usage: run-live-release-bundle-closeout.sh FULL_40_SHA /path/to/.xd https://server-origin /path/to/evidence'
if [[ "$#" -ne 4 ]]; then echo "$usage" >&2; exit 2; fi
commit="$1"
host_home="$2"
server_origin="$3"
evidence_dir="$4"
if [[ ! "$commit" =~ ^[a-f0-9]{40}$ ]]; then echo 'full source Commit required' >&2; exit 2; fi
if [[ ! "$server_origin" =~ ^https://[^/]+/?$ ]]; then echo 'HTTPS Server origin required' >&2; exit 2; fi
if [[ ! -d "$host_home" || -L "$host_home" ]]; then echo 'real installed Host .xd directory required' >&2; exit 2; fi
if [[ -z "$(printenv XD_BUNDLE_OWNER_TOKEN 2>/dev/null || true)" ]]; then
  echo 'XD_BUNDLE_OWNER_TOKEN required for authenticated Host acceptance' >&2
  exit 2
fi
if [[ -L "$evidence_dir" ]]; then echo 'refusing symlinked evidence directory' >&2; exit 2; fi
umask 077
mkdir -p -- "$evidence_dir"
script_dir="$(cd "$(dirname "$0")" && pwd)"
temp="$(mktemp "$evidence_dir/.live-release-bundle.XXXXXXXX")"
trap 'rm -f -- "$temp"' EXIT
# The validator rejects an empty cache and checks real two-Range bytes,
# authenticated Owner metadata, unauthenticated 401/403 and independent
# Sigstore provenance. It does NOT prove Host strict mode was enabled (R09).
python3 "$script_dir/verify-live-release-bundle.py" \
  --commit "$commit" --host-home "$host_home" --server-url "$server_origin" \
  --require-sigstore --check-server-download --check-auth-denial > "$temp"
# Atomic publish only after every live probe has succeeded.
mv -f -- "$temp" "$evidence_dir/R03-live.json"
python3 "$script_dir/release_bundle_closeout.py" \
  --commit "$commit" --evidence-dir "$evidence_dir" \
  --live-report "$evidence_dir/R03-live.json" \
  --output "$evidence_dir/R03-R13-matrix.json"
echo 'R03 live Host evidence recorded; remaining physical rows remain unverified until witnessed.'
echo 'Use release_bundle_closeout.py --strict only when R04–R13 receipts are attached.'
