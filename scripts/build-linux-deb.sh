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

desktop_version() {
  local value="$1"
  case "$value" in
    v[0-9]*)
      printf '%s\n' "${value#v}"
      ;;
    snapshot-*)
      local sha="${value#snapshot-}"
      printf '0.0.0-snapshot.%s\n' "${sha:0:12}"
      ;;
    *)
      if [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
        printf '%s\n' "$value"
      else
        local suffix
        suffix="$(printf '%s' "$value" | sed -E 's/[^0-9A-Za-z.-]+/./g; s/^\.+//; s/\.+$//')"
        [[ -n "$suffix" ]] || suffix="dev"
        printf '0.0.0-%s\n' "$suffix"
      fi
      ;;
  esac
}

PKG_ROOT="$(mktemp -d)"
PACKAGE_BACKUP="$(mktemp)"
DESKTOP_ROOT="$ROOT/desktop"
DESKTOP_PACKAGE="$DESKTOP_ROOT/package.json"
cp "$DESKTOP_PACKAGE" "$PACKAGE_BACKUP"

cleanup() {
  cp "$PACKAGE_BACKUP" "$DESKTOP_PACKAGE" >/dev/null 2>&1 || true
  rm -rf "$PKG_ROOT" "$PACKAGE_BACKUP"
}
trap cleanup EXIT INT TERM

DESKTOP_VERSION="$(desktop_version "$VERSION")"

pushd "$DESKTOP_ROOT" >/dev/null
npm install --no-audit --no-fund
node scripts/set-version.mjs "$DESKTOP_VERSION"
npm run dist:linux
popd >/dev/null

cp "$PACKAGE_BACKUP" "$DESKTOP_PACKAGE"

DESKTOP_DEB="$DESKTOP_ROOT/release/xdrive-desktop-linux-amd64.deb"
if [[ ! -f "$DESKTOP_DEB" ]]; then
  echo "Electron desktop package was not created: $DESKTOP_DEB" >&2
  exit 1
fi

dpkg-deb -R "$DESKTOP_DEB" "$PKG_ROOT"

mkdir -p \
  "$PKG_ROOT/usr/bin" \
  "$PKG_ROOT/usr/lib/systemd/user" \
  "$PKG_ROOT/usr/lib/systemd/system" \
  "$PKG_ROOT/usr/share/doc/xdrive-client"

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

DESKTOP_DEPENDS="$(sed -n 's/^Depends:[[:space:]]*//p' "$PKG_ROOT/DEBIAN/control" | head -n1)"
if [[ -n "$DESKTOP_DEPENDS" ]]; then
  UNIFIED_DEPENDS="$DESKTOP_DEPENDS, fuse3, ca-certificates"
else
  UNIFIED_DEPENDS="fuse3, ca-certificates"
fi

cat > "$PKG_ROOT/DEBIAN/control" <<CONTROL
Package: xdrive-client
Version: $DEB_VERSION
Section: utils
Priority: optional
Architecture: amd64
Maintainer: xDrive Project <noreply@github.com>
Depends: $UNIFIED_DEPENDS
Recommends: libsecret-tools
Conflicts: xdrive-desktop
Replaces: xdrive-desktop
Provides: xdrive-desktop
Homepage: https://github.com/lazyxu/xdrive
Description: xDrive unified desktop client
 xDrive Desktop plus the headless sync Agent, xd CLI, FUSE integration,
 secure credential storage support, and the channel-aware automatic updater.
CONTROL

insert_maintainer_snippet() {
  local file="$1"
  local snippet="$2"
  python3 - "$file" "$snippet" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
snippet = sys.argv[2].replace("\\n", "\n").rstrip() + "\n"
if path.exists():
    text = path.read_text()
else:
    text = "#!/bin/sh\nset -e\nexit 0\n"
lines = text.splitlines(keepends=True)
insert = len(lines)
for index in range(len(lines) - 1, -1, -1):
    if lines[index].strip() == "exit 0":
        insert = index
        break
lines.insert(insert, snippet)
path.write_text("".join(lines))
path.chmod(0o755)
PY
}

insert_maintainer_snippet "$PKG_ROOT/DEBIAN/postinst" 'if command -v systemctl >/dev/null 2>&1; then\n  systemctl daemon-reload >/dev/null 2>&1 || true\n  systemctl enable --now xdrive-update.timer >/dev/null 2>&1 || true\nfi\nprintf "%s\\n" "xDrive unified client installed: Desktop + Agent + xd."'
insert_maintainer_snippet "$PKG_ROOT/DEBIAN/prerm" 'case "$1" in\n  remove|deconfigure)\n    if command -v systemctl >/dev/null 2>&1; then\n      systemctl disable --now xdrive-update.timer >/dev/null 2>&1 || true\n    fi\n    ;;\nesac'
insert_maintainer_snippet "$PKG_ROOT/DEBIAN/postrm" 'if command -v systemctl >/dev/null 2>&1; then\n  systemctl daemon-reload >/dev/null 2>&1 || true\nfi'

mkdir -p "$OUT_DIR"
OUTPUT="$OUT_DIR/xdrive-client-linux-amd64.deb"
dpkg-deb --root-owner-group --build "$PKG_ROOT" "$OUTPUT"
dpkg-deb --info "$OUTPUT" >/dev/null
dpkg-deb --contents "$OUTPUT" >/dev/null

if ! dpkg-deb --contents "$OUTPUT" | grep -q 'usr/bin/xdrive-desktop'; then
  echo "unified Linux package is missing xdrive-desktop" >&2
  exit 1
fi
if ! dpkg-deb --contents "$OUTPUT" | grep -q 'usr/bin/xdrive-agent'; then
  echo "unified Linux package is missing xdrive-agent" >&2
  exit 1
fi
if ! dpkg-deb --contents "$OUTPUT" | grep -q 'usr/bin/xd'; then
  echo "unified Linux package is missing xd" >&2
  exit 1
fi

echo "$OUTPUT"
