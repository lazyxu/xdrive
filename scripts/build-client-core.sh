#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-release/core}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_LDFLAG="-X github.com/lazyxu/xdrive/internal/version.Version=$VERSION"

linux_dir="$OUT_DIR/linux-amd64"
windows_dir="$OUT_DIR/windows-amd64"
mkdir -p "$linux_dir" "$windows_dir"

build_linux() {
  (
    cd "$ROOT"
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$linux_dir/xd" ./cmd/xd
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$linux_dir/xdrive-agent" ./cmd/xdrive-agent
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$linux_dir/xdrive-updater" ./cmd/xdrive-updater
  )
}

build_windows() {
  (
    cd "$ROOT"
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w $VERSION_LDFLAG" -o "$windows_dir/xd.exe" ./cmd/xd
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H=windowsgui $VERSION_LDFLAG" -o "$windows_dir/xdrive-agent.exe" ./cmd/xdrive-agent
  )
}

build_linux &
linux_pid=$!
build_windows &
windows_pid=$!

if wait "$linux_pid"; then
  linux_status=0
else
  linux_status=$?
fi
if wait "$windows_pid"; then
  windows_status=0
else
  windows_status=$?
fi
if [[ "$linux_status" != "0" ]]; then
  exit "$linux_status"
fi
if [[ "$windows_status" != "0" ]]; then
  exit "$windows_status"
fi

chmod 0755 "$linux_dir/xd" "$linux_dir/xdrive-agent" "$linux_dir/xdrive-updater"

for binary in "$linux_dir/xd" "$linux_dir/xdrive-agent" "$linux_dir/xdrive-updater"; do
  go version -m "$binary" | grep -q "GOOS=linux"
  go version -m "$binary" | grep -q "GOARCH=amd64"
done
for binary in "$windows_dir/xd.exe" "$windows_dir/xdrive-agent.exe"; do
  go version -m "$binary" | grep -q "GOOS=windows"
  go version -m "$binary" | grep -q "GOARCH=amd64"
done

actual="$("$linux_dir/xd" version)"
[[ "$actual" == "$VERSION" ]] || {
  echo "client core version mismatch: got $actual want $VERSION" >&2
  exit 1
}

printf '%s\n' "$linux_dir" "$windows_dir"
