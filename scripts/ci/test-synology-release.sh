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
printf 'fixture Caddy image' > "$tmp/release/xdrive-caddy-image.tar.gz"
printf 'sha256:%064d\n' 0 > "$tmp/release/xdrive-caddy-image.id"

bash "$ROOT/scripts/ci/verify-synology-spk-release.sh" "$tmp/release"
if bash "$ROOT/scripts/ci/verify-synology-spk-release.sh" "$tmp/release" --require-mui >/dev/null 2>&1; then
  echo "CLI-only SPK incorrectly admitted as a GUI release" >&2; exit 1
fi
# Verify GUI payload admission with a self-contained fixture; source-exact
# binaries and UI bytes are independently tested by test-synology-spk-ui.py.
mkdir -p "$tmp/payload/ui/assets"
printf 'DSM HTML entry' > "$tmp/payload/ui/synology.html"
printf 'DSM config' > "$tmp/payload/ui/config"
printf 'DSM CGI' > "$tmp/payload/ui/backup.cgi"
printf 'DSM JavaScript' > "$tmp/payload/ui/assets/app.js"
tar -C "$tmp/payload" -czf "$tmp/package/package.tgz" .
cat >> "$tmp/package/INFO" <<'INFO'
dsmuidir="ui"
dsmappname="com.xdrive.NASBackup"
INFO
tar -C "$tmp/package" -cf "$spk" .
(cd "$tmp/release"; sha256sum "$(basename "$spk")" > "$(basename "$spk").sha256")
bash "$ROOT/scripts/ci/verify-synology-spk-release.sh" "$tmp/release" --require-mui
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
