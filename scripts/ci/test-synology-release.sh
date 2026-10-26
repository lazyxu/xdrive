#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/release" "$tmp/package"
cat > "$tmp/package/INFO" <<'INFO'
package="xdrivenas"
version="0.0.0-123"
arch="armada38x"
os_min_ver="7.0-40759"
INFO
spk="$tmp/release/xdrivenas-armada38x-0.0.0-123.spk"
tar -C "$tmp/package" -cf "$spk" .
(cd "$tmp/release"; sha256sum "$(basename "$spk")" > "$(basename "$spk").sha256")
printf 'fake CLI asset' > "$tmp/release/xdrive-backup-linux-amd64.tar.gz"
printf 'fake CLI asset' > "$tmp/release/xdrive-backup-windows-amd64.zip"

bash "$ROOT/scripts/ci/verify-synology-spk-release.sh" "$tmp/release"
bash "$ROOT/scripts/ci/verify-release-archive-allowlist.sh" "$tmp/release"

printf 'tampered' >> "$spk"
if bash "$ROOT/scripts/ci/verify-synology-spk-release.sh" "$tmp/release" >/dev/null 2>&1; then
  echo "tampered Synology package passed release verification" >&2; exit 1
fi
tar -C "$tmp/package" -cf "$spk" .
(cd "$tmp/release"; sha256sum "$(basename "$spk")" > "$(basename "$spk").sha256")
cp "$spk" "$tmp/release/xdrivenas-armada38x-0.0.0-124.spk"
if bash "$ROOT/scripts/ci/verify-synology-spk-release.sh" "$tmp/release" >/dev/null 2>&1; then
  echo "duplicate Synology package accepted" >&2; exit 1
fi
rm "$tmp/release/xdrivenas-armada38x-0.0.0-124.spk"
mv "$tmp/release/xdrive-backup-windows-amd64.zip" "$tmp/release/unrelated.zip"
if bash "$ROOT/scripts/ci/verify-release-archive-allowlist.sh" "$tmp/release" >/dev/null 2>&1; then
  echo "unexpected release archive accepted" >&2; exit 1
fi
echo "Synology Release digest, package identity, duplicate/tamper and archive allowlist checks passed."
