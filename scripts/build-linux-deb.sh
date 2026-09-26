#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-dist}"
DESKTOP_RUNTIME="${3:-}"
CORE_RUNTIME="${4:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$VERSION" in
  v*) DEB_VERSION="${VERSION#v}" ;;
  snapshot-*) DEB_VERSION="0.0.0+${VERSION//[^0-9A-Za-z.+:~_-]/.}" ;;
  *) DEB_VERSION="${VERSION//[^0-9A-Za-z.+:~_-]/.}" ;;
esac

PKG_ROOT="$(mktemp -d)"
trap 'rm -rf "$PKG_ROOT"' EXIT

if [[ -z "$DESKTOP_RUNTIME" ]]; then
  DESKTOP_RUNTIME="$ROOT/desktop/release/linux-unpacked"
elif [[ "$DESKTOP_RUNTIME" != /* ]]; then
  DESKTOP_RUNTIME="$ROOT/$DESKTOP_RUNTIME"
fi
desktop_exe="$DESKTOP_RUNTIME/xdrive-desktop"
if [[ ! -x "$desktop_exe" ]]; then
  echo "Electron desktop runtime is required: $desktop_exe" >&2
  echo "Build desktop/release/linux-unpacked first or pass the runtime directory as the third argument." >&2
  exit 1
fi

mkdir -p \
  "$PKG_ROOT/DEBIAN" \
  "$PKG_ROOT/opt/xdrive-desktop" \
  "$PKG_ROOT/usr/bin" \
  "$PKG_ROOT/usr/lib/systemd/user" \
  "$PKG_ROOT/usr/lib/systemd/system" \
  "$PKG_ROOT/usr/share/applications" \
  "$PKG_ROOT/usr/share/doc/xdrive-client"

cp -a "$DESKTOP_RUNTIME/." "$PKG_ROOT/opt/xdrive-desktop/"
ln -sfn ../../opt/xdrive-desktop/xdrive-desktop "$PKG_ROOT/usr/bin/xdrive-desktop"

if [[ ! -x "$PKG_ROOT/usr/bin/xdrive-desktop" ]]; then
  echo "Electron desktop launcher is not executable after runtime merge: /usr/bin/xdrive-desktop" >&2
  exit 1
fi

VERSION_LDFLAG="-X github.com/lazyxu/xdrive/internal/version.Version=$VERSION"

if [[ -n "$CORE_RUNTIME" ]]; then
  if [[ "$CORE_RUNTIME" != /* ]]; then
    CORE_RUNTIME="$ROOT/$CORE_RUNTIME"
  fi
  for binary in xd xdrive-agent xdrive-updater; do
    source_binary="$CORE_RUNTIME/$binary"
    if [[ ! -f "$source_binary" ]]; then
      echo "prebuilt Linux client core is missing: $source_binary" >&2
      exit 1
    fi
    install -m 0755 "$source_binary" "$PKG_ROOT/usr/bin/$binary"
  done
else
  pushd "$ROOT" >/dev/null
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$PKG_ROOT/usr/bin/xd" ./cmd/xd
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$PKG_ROOT/usr/bin/xdrive-agent" ./cmd/xdrive-agent
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$PKG_ROOT/usr/bin/xdrive-updater" ./cmd/xdrive-updater
  popd >/dev/null
fi

install -m 0644 "$ROOT/packaging/linux/xdrive-agent.service" "$PKG_ROOT/usr/lib/systemd/user/xdrive-agent.service"
install -m 0644 "$ROOT/packaging/linux/xdrive-update.service" "$PKG_ROOT/usr/lib/systemd/system/xdrive-update.service"
install -m 0644 "$ROOT/packaging/linux/xdrive-update.timer" "$PKG_ROOT/usr/lib/systemd/system/xdrive-update.timer"
install -m 0644 "$ROOT/packaging/linux/xdrive.desktop" "$PKG_ROOT/usr/share/applications/xdrive.desktop"
install -m 0644 "$ROOT/README.md" "$PKG_ROOT/usr/share/doc/xdrive-client/README.md"
install -m 0644 "$ROOT/LICENSE" "$PKG_ROOT/usr/share/doc/xdrive-client/LICENSE"
printf '%s\n' "$VERSION" > "$PKG_ROOT/usr/share/doc/xdrive-client/client-version"

cat > "$PKG_ROOT/DEBIAN/control" <<CONTROL
Package: xdrive-client
Version: $DEB_VERSION
Section: utils
Priority: optional
Architecture: amd64
Maintainer: xDrive Project <noreply@github.com>
Depends: fuse3, ca-certificates, libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0
Recommends: libsecret-tools, libappindicator3-1
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
for binary in /usr/bin/xd /usr/bin/xdrive-agent /usr/bin/xdrive-desktop; do
  if [ ! -x "$binary" ]; then
    printf '%s\n' "xDrive client health check failed: missing $binary" >&2
    exit 1
  fi
done
expected_version="$(cat /usr/share/doc/xdrive-client/client-version)"
actual_version="$(/usr/bin/xd version)"
if [ "$actual_version" != "$expected_version" ]; then
  printf '%s\n' "xDrive client health check failed: xd version $actual_version != $expected_version" >&2
  exit 1
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable --now xdrive-update.timer >/dev/null 2>&1 || true
fi
printf '%s\n' 'xDrive Desktop, background agent, and xd CLI installed and verified.'
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
OUTPUT="$OUT_DIR/xdrive-linux-amd64.deb"

DPKG_DEB_ARGS=(--root-owner-group)
case "$VERSION" in
  v*)
    echo "Building stable Debian package with dpkg-deb default compression."
    ;;
  *)
    DPKG_DEB_ARGS+=(-Zxz -z1)
    echo "Building development Debian package with fast XZ level 1 compression."
    ;;
esac

dpkg-deb "${DPKG_DEB_ARGS[@]}" --build "$PKG_ROOT" "$OUTPUT"
dpkg-deb --info "$OUTPUT" >/dev/null
dpkg-deb --contents "$OUTPUT" >/dev/null
echo "$OUTPUT"
