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
mkdir -p   "$PKG_ROOT/DEBIAN"   "$PKG_ROOT/usr/bin"   "$PKG_ROOT/usr/lib/systemd/user"   "$PKG_ROOT/usr/lib/systemd/system"   "$PKG_ROOT/usr/share/doc/xdrive-client"

VERSION_LDFLAG="-X github.com/lazyxu/xdrive/internal/version.Version=$VERSION"

pushd "$ROOT" >/dev/null
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$PKG_ROOT/usr/bin/xd" ./cmd/xd
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$PKG_ROOT/usr/bin/xdrive-agent" ./cmd/xdrive-agent
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$PKG_ROOT/usr/bin/xdrive-updater" ./cmd/xdrive-updater
popd >/dev/null

install -m 0644 "$ROOT/packaging/linux/xdrive-agent.service" "$PKG_ROOT/usr/lib/systemd/user/xdrive-agent.service"
install -m 0644 "$ROOT/packaging/linux/xdrive-update.service" "$PKG_ROOT/usr/lib/systemd/system/xdrive-update.service"
install -m 0644 "$ROOT/packaging/linux/xdrive-update.timer" "$PKG_ROOT/usr/lib/systemd/system/xdrive-update.timer"
install -m 0644 "$ROOT/README.md" "$PKG_ROOT/usr/share/doc/xdrive-client/README.md"
install -m 0644 "$ROOT/LICENSE" "$PKG_ROOT/usr/share/doc/xdrive-client/LICENSE"

cat > "$PKG_ROOT/DEBIAN/control" <<CONTROL
Package: xdrive-client
Version: $DEB_VERSION
Section: utils
Priority: optional
Architecture: amd64
Maintainer: xDrive Project <noreply@github.com>
Depends: fuse3, ca-certificates
Recommends: libsecret-tools
Homepage: https://github.com/lazyxu/xdrive
Description: xDrive Linux client
 Mount an xDrive server as a local filesystem using FUSE.
 Includes xd, the optional user mount agent, and the automatic release updater.
CONTROL

cat > "$PKG_ROOT/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now xdrive-update.timer >/dev/null 2>&1 || true
fi
printf '%s\n' 'xDrive client installed.'
printf '%s\n' 'Login with: xd login --server URL --username USER --password PASS'
printf '%s\n' 'Optional background mount: systemctl --user enable --now xdrive-agent'
printf '%s\n' 'Stable release updates are checked automatically by xdrive-update.timer.'
exit 0
POSTINST
chmod 0755 "$PKG_ROOT/DEBIAN/postinst"

cat > "$PKG_ROOT/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
case "$1" in
  remove|deconfigure)
    if command -v systemctl >/dev/null 2>&1; then
      systemctl disable --now xdrive-update.timer >/dev/null 2>&1 || true
    fi
    ;;
esac
exit 0
PRERM
chmod 0755 "$PKG_ROOT/DEBIAN/prerm"

cat > "$PKG_ROOT/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi
exit 0
POSTRM
chmod 0755 "$PKG_ROOT/DEBIAN/postrm"

mkdir -p "$OUT_DIR"
OUTPUT="$OUT_DIR/xdrive-client-linux-amd64.deb"
dpkg-deb --root-owner-group --build "$PKG_ROOT" "$OUTPUT"
dpkg-deb --info "$OUTPUT" >/dev/null
dpkg-deb --contents "$OUTPUT" >/dev/null
echo "$OUTPUT"
