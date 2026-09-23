#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-dist}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$VERSION" in
  v*) DEB_VERSION="${VERSION#v}" ;;
  snapshot-*) DEB_VERSION="0.0.0+${VERSION//[^0-9A-Za-z.+:~_-]/.}" ;;
  *) DEB_VERSION="${VERSION//[^0-9A-Za-z.+:~_-]/.}" ;;
esac

PKG_ROOT="$(mktemp -d)"
trap 'rm -rf "$PKG_ROOT"' EXIT
mkdir -p "$PKG_ROOT/DEBIAN" "$PKG_ROOT/usr/bin" "$PKG_ROOT/usr/lib/systemd/user" "$PKG_ROOT/usr/share/doc/xdrive-client"

pushd "$ROOT" >/dev/null
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$PKG_ROOT/usr/bin/xd" ./cmd/xd
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$PKG_ROOT/usr/bin/xdrive-agent" ./cmd/xdrive-agent
popd >/dev/null
install -m 0644 "$ROOT/packaging/linux/xdrive-agent.service" "$PKG_ROOT/usr/lib/systemd/user/xdrive-agent.service"
install -m 0644 "$ROOT/README.md" "$PKG_ROOT/usr/share/doc/xdrive-client/README.md"
install -m 0644 "$ROOT/LICENSE" "$PKG_ROOT/usr/share/doc/xdrive-client/LICENSE"

cat > "$PKG_ROOT/DEBIAN/control" <<CONTROL
Package: xdrive-client
Version: $DEB_VERSION
Section: utils
Priority: optional
Architecture: amd64
Maintainer: xDrive Project <noreply@github.com>
Depends: fuse3
Homepage: https://github.com/lazyxu/xdrive
Description: xDrive Linux client
 Mount an xDrive server as a local filesystem using FUSE.
 Includes the xd CLI and optional xdrive-agent user service.
CONTROL

cat > "$PKG_ROOT/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
printf '%s\n' 'xDrive client installed.'
printf '%s\n' 'Login with: xd login --server URL --username USER --password PASS'
printf '%s\n' 'Optional background agent: systemctl --user enable --now xdrive-agent'
exit 0
POSTINST
chmod 0755 "$PKG_ROOT/DEBIAN/postinst"

mkdir -p "$OUT_DIR"
OUTPUT="$OUT_DIR/xdrive-client-linux-amd64.deb"
dpkg-deb --root-owner-group --build "$PKG_ROOT" "$OUTPUT"
dpkg-deb --info "$OUTPUT" >/dev/null
dpkg-deb --contents "$OUTPUT" >/dev/null
echo "$OUTPUT"
