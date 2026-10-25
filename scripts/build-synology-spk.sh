#!/usr/bin/env bash
set -euo pipefail

# Build the SAME cmd/xd and cmd/xdrive-agent as Desktop, with GOARM=7,
# or package an already compiled pair without recompiling either binary.
SPK_VERSION="${1:-0.1.0-1}"
OUTPUT_DIR="${2:-release/synology}"
CORE_DIR="${3:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$SPK_VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}-[0-9]+$ ]] || {
  echo "expected numeric DSM package version such as 0.1.0-1" >&2
  exit 2
}

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
pkg="$staging/spk"
payload="$staging/payload"
mkdir -p "$pkg/conf" "$pkg/scripts" "$payload/bin"

if [[ -z "$CORE_DIR" ]]; then
  CORE_DIR="$OUTPUT_DIR/core"
  mkdir -p "$CORE_DIR"
  build_version="${XDRIVE_BUILD_VERSION:-$SPK_VERSION}"
  flags="-s -w -X github.com/lazyxu/xdrive/internal/version.Version=$build_version"
  for field in Channel Commit CommitMessageBase64 CommitTime BuildTime; do
    case "$field" in
      Channel) value="${XDRIVE_BUILD_CHANNEL:-}" ;;
      Commit) value="${XDRIVE_BUILD_COMMIT:-}" ;;
      CommitMessageBase64) value="${XDRIVE_BUILD_COMMIT_MESSAGE_B64:-}" ;;
      CommitTime) value="${XDRIVE_BUILD_COMMIT_TIME:-}" ;;
      BuildTime) value="${XDRIVE_BUILD_TIME:-}" ;;
    esac
    if [[ -n "$value" ]]; then
      flags+=" -X github.com/lazyxu/xdrive/internal/version.$field=$value"
    fi
  done
  (
    cd "$ROOT"
    CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -trimpath -ldflags="$flags" -o "$CORE_DIR/xd" ./cmd/xd
    CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -trimpath -ldflags="$flags" -o "$CORE_DIR/xdrive-agent" ./cmd/xdrive-agent
  )
else
  CORE_DIR="$(cd "$CORE_DIR" && pwd)"
fi

for name in xd xdrive-agent; do
  binary="$CORE_DIR/$name"
  [[ -s "$binary" ]] || { echo "missing core executable: $binary" >&2; exit 1; }
  info="$(go version -m "$binary")"
  for required in 'GOOS=linux' 'GOARCH=arm' 'GOARM=7'; do
    grep -Fq "$required" <<< "$info" || {
      echo "wrong Synology executable $name: expected $required" >&2
      exit 1
    }
  done
  grep -Fq "github.com/lazyxu/xdrive/cmd/$name" <<< "$info" || {
    echo "wrong executable: expected original xDrive cmd/$name" >&2
    exit 1
  }
  install -m 0755 "$binary" "$payload/bin/$name"
done

# DSM 7 FHS manages persistent home/var; only immutable executables live in target.
install -m 0644 "$ROOT/packaging/synology/conf/privilege" "$pkg/conf/privilege"
install -m 0755 "$ROOT/packaging/synology/scripts/start-stop-status" "$pkg/scripts/start-stop-status"
for phase in preinst postinst preuninst postuninst preupgrade postupgrade; do
  install -m 0755 "$ROOT/packaging/synology/scripts/noop" "$pkg/scripts/$phase"
done
install -m 0644 "$ROOT/LICENSE" "$pkg/LICENSE"

cat > "$pkg/INFO" <<INFO
package="xdrivenas"
version="$SPK_VERSION"
displayname="xDrive NAS Backup"
description="xDrive Backup-only agent for Synology NAS (no server, GUI or Docker)"
maintainer="xDrive Project"
arch="armada38x"
os_min_ver="7.0-40759"
ctl_stop="yes"
silent_upgrade="yes"
INFO

# Derived from the existing PWA icon; no independent DSM icon design.
(cd "$ROOT" && GO111MODULE=off go run scripts/synology-spk-icons.go \
  assets/icon/web/pwa-512.png "$pkg/PACKAGE_ICON.PNG" "$pkg/PACKAGE_ICON_256.PNG")

# DSM's .spk is an outer tar archive containing the gzip-compressed payload.
# Normalize package metadata for reproducibility from byte-identical binaries.
epoch="${SOURCE_DATE_EPOCH:-0}"
[[ "$epoch" =~ ^[0-9]+$ ]] || { echo 'SOURCE_DATE_EPOCH must be numeric' >&2; exit 2; }
tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner \
  -C "$payload" -cf - . | gzip -n > "$pkg/package.tgz"
spk="$OUTPUT_DIR/xdrivenas-armada38x-$SPK_VERSION.spk"
tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner \
  -C "$pkg" -cf "$spk" .
(cd "$OUTPUT_DIR" && sha256sum "$(basename "$spk")" > "$(basename "$spk").sha256")
echo "SPK: $spk"
echo 'Contains the original ARMv7 xd + xdrive-agent; never Electron or a second upload engine.'
