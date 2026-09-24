#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-dist}"
DESKTOP_DEB="${3:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$VERSION" in
  v*) DEB_VERSION="${VERSION#v}" ;;
  snapshot-*) DEB_VERSION="0.0.0+${VERSION//[^0-9A-Za-z.+:~_-]/.}" ;;
  *) DEB_VERSION="${VERSION//[^0-9A-Za-z.+:~_-]/.}" ;;
esac

PKG_ROOT="$(mktemp -d)"
trap 'rm -rf "$PKG_ROOT"' EXIT

if [[ -z "$DESKTOP_DEB" ]]; then
  DESKTOP_DEB="$ROOT/desktop/release/xdrive-desktop-linux-amd64.deb"
elif [[ "$DESKTOP_DEB" != /* ]]; then
  DESKTOP_DEB="$ROOT/$DESKTOP_DEB"
fi
if [[ ! -f "$DESKTOP_DEB" ]]; then
  echo "Electron desktop package is required: $DESKTOP_DEB" >&2
  echo "Build desktop/release/xdrive-desktop-linux-amd64.deb first or pass it as the third argument." >&2
  exit 1
fi

DESKTOP_DEPENDS="$(dpkg-deb -f "$DESKTOP_DEB" Depends 2>/dev/null || true)"
dpkg-deb -x "$DESKTOP_DEB" "$PKG_ROOT"

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
Depends: fuse3, ca-certificates${DESKTOP_DEPENDS:+, $DESKTOP_DEPENDS}
Recommends: libsecret-tools
Conflicts: xdrive-desktop
Replaces: xdrive-desktop
Provides: xdrive-desktop
Homepage: https://github.com/lazyxu/xdrive
Description: xDrive Linux desktop client
 Mount an xDrive server as a local filesystem using FUSE.
 Includes xDrive Desktop, xd, the background agent, and the channel-aware automatic updater.
CONTROL

cat > "$PKG_ROOT/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now xdrive-update.timer >/dev/null 2>&1 || true
fi
printf '%s\n' 'xDrive Desktop, background agent, and xd CLI installed.'
printf '%s\n' 'Open xDrive Desktop from the applications menu, or login with xd from a terminal.'
printf '%s\n' 'The Desktop starts at login by default and keeps the background agent healthy.'
printf '%s\n' 'Updates are checked automatically: stable builds follow stable; snapshot builds follow master.'
printf '%s\n' 'Pin a commit with XD_UPDATE_CHANNEL=commit and XD_UPDATE_COMMIT=<sha>.'
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
