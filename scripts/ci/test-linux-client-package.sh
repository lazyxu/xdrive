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
if [[ -e "$pkg_root/usr/lib/systemd/system/xdrive-update.timer" || -e "$pkg_root/usr/lib/systemd/system/xdrive-update.service" ]]; then
  echo "unified package must not ship legacy automatic update systemd units" >&2
  exit 1
fi
test -f "$pkg_root/usr/share/applications/xdrive.desktop" || { echo "unified package missing desktop menu entry" >&2; exit 1; }
test -f "$pkg_root/usr/share/icons/hicolor/scalable/apps/xdrive.svg" || { echo "unified package missing xDrive application icon" >&2; exit 1; }
grep -q '^Icon=xdrive$' "$pkg_root/usr/share/applications/xdrive.desktop"
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
# Verify real extracted executable metadata and bundled Electron resources
# against the independent source Commit selected by this CI run.
expected_commit="${GITHUB_SHA:-${CI_COMMIT_SHA:-}}"
if [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]]; then
  "$pkg_root/usr/bin/xd" version --json > "$pkg_root/xd-build-info.json"
  "$pkg_root/usr/bin/xdrive-agent" --build-info-json > "$pkg_root/agent-build-info.json"
  test -f "$pkg_root/opt/xdrive-desktop/resources/xdrive-build-info.json" || {
    echo "unified package is missing Desktop source-Commit metadata" >&2
    exit 1
  }
  python3 - "$pkg_root" "$expected_commit" <<'PY'
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
commit = sys.argv[2]
for label, path in (
    ("xd", root / "xd-build-info.json"),
    ("Agent", root / "agent-build-info.json"),
    ("Desktop", root / "opt/xdrive-desktop/resources/xdrive-build-info.json"),
):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("commit") != commit:
        raise SystemExit(f"{label} packaged source Commit {data.get('commit')!r} != CI Commit {commit}")
PY
fi

dpkg-deb --field "$PACKAGE" Provides | grep -q 'xdrive-desktop'
dpkg-deb --field "$PACKAGE" Replaces | grep -q 'xdrive-desktop'

dpkg-deb -e "$PACKAGE" "$pkg_meta"
grep -q 'xDrive client health check failed' "$pkg_meta/postinst"
grep -q '/usr/bin/xdrive-desktop' "$pkg_meta/postinst"
grep -q 'systemctl disable --now xdrive-update.timer' "$pkg_meta/postinst"
grep -q 'background auto-update is disabled by default' "$pkg_meta/postinst"
if grep -q 'systemctl enable --now xdrive-update.timer' "$pkg_meta/postinst"; then
  echo "Linux client package must not enable automatic updates by default" >&2
  exit 1
fi

echo "Linux exact release package passed artifact tests: $PACKAGE"
