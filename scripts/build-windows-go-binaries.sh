#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-release/windows-go}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_LDFLAG="-X github.com/lazyxu/xdrive/internal/version.Version=$VERSION"

mkdir -p "$OUT_DIR"

(
  cd "$ROOT"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64     go build -trimpath -ldflags="-s -w $VERSION_LDFLAG"     -o "$OUT_DIR/xd.exe" ./cmd/xd
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64     go build -trimpath -ldflags="-s -w -H=windowsgui $VERSION_LDFLAG"     -o "$OUT_DIR/xdrive-agent.exe" ./cmd/xdrive-agent
)

for binary in "$OUT_DIR/xd.exe" "$OUT_DIR/xdrive-agent.exe"; do
  test -f "$binary"
  go version -m "$binary" | grep -q 'GOOS=windows'
  go version -m "$binary" | grep -q 'GOARCH=amd64'
done

printf '%s\n' "$OUT_DIR/xd.exe" "$OUT_DIR/xdrive-agent.exe"
