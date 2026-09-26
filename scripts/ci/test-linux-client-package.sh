#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?release version is required}"
PACKAGE="${2:-release/xdrive-linux-amd64.deb}"

test -f "$PACKAGE" || {
  echo "Linux release package is missing: $PACKAGE" >&2
  exit 1
}

dpkg-deb --info "$PACKAGE" >/dev/null
dpkg-deb --contents "$PACKAGE" >/dev/null

pkg_root="$(mktemp -d)"
pkg_meta="$(mktemp -d)"
trap 'rm -rf "$pkg_root" "$pkg_meta"' EXIT

dpkg-deb -x "$PACKAGE" "$pkg_root"
test -x "$pkg_root/usr/bin/xd" || { echo "unified package missing xd" >&2; exit 1; }
test -x "$pkg_root/usr/bin/xdrive-agent" || { echo "unified package missing xdrive-agent" >&2; exit 1; }
test -x "$pkg_root/usr/bin/xdrive-updater" || { echo "unified package missing xdrive-updater" >&2; exit 1; }
test -f "$pkg_root/usr/lib/systemd/system/xdrive-update.timer" || { echo "unified package missing update timer" >&2; exit 1; }
test -f "$pkg_root/usr/share/applications/xdrive.desktop" || { echo "unified package missing desktop menu entry" >&2; exit 1; }
dpkg-deb --field "$PACKAGE" Depends | grep -q 'libgtk-3-0'
dpkg-deb --field "$PACKAGE" Recommends | grep -q 'libappindicator3-1'
test -L "$pkg_root/usr/bin/xdrive-desktop" || { echo "unified package missing xdrive-desktop link" >&2; exit 1; }
test -x "$pkg_root/usr/bin/xdrive-desktop" || { echo "unified package xdrive-desktop link is broken" >&2; exit 1; }
test "$(cat "$pkg_root/usr/share/doc/xdrive-client/client-version")" = "$VERSION"
actual="$("$pkg_root/usr/bin/xd" version)"
[[ "$actual" == "$VERSION" ]] || {
  echo "embedded xd version mismatch: got $actual want $VERSION" >&2
  exit 1
}
dpkg-deb --field "$PACKAGE" Provides | grep -q 'xdrive-desktop'
dpkg-deb --field "$PACKAGE" Replaces | grep -q 'xdrive-desktop'

dpkg-deb -e "$PACKAGE" "$pkg_meta"
grep -q 'xDrive client health check failed' "$pkg_meta/postinst"
grep -q '/usr/bin/xdrive-desktop' "$pkg_meta/postinst"

echo "Linux exact release package passed artifact tests: $PACKAGE"
