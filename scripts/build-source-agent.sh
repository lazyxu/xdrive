#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-release/source-agent}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_LDFLAG="-X github.com/lazyxu/xdrive/internal/version.Version=$VERSION"

mkdir -p "$OUT_DIR"

build_one() {
  local arch="$1"
  local output="$OUT_DIR/xdrive-source-agent-linux-$arch"

  (
    cd "$ROOT"
    CGO_ENABLED=0 GOOS=linux GOARCH="$arch"       go build -trimpath -ldflags="-s -w $VERSION_LDFLAG"       -o "$output" ./cmd/xdrive-source-agent
  )
  chmod 0755 "$output"

  go version -m "$output" | grep -q "GOOS=linux"
  go version -m "$output" | grep -q "GOARCH=$arch"
}

build_one amd64
build_one arm64

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  actual="$("$OUT_DIR/xdrive-source-agent-linux-amd64" version)"
  [[ "$actual" == "$VERSION" ]] || {
    echo "source-agent version mismatch: got $actual want $VERSION" >&2
    exit 1
  }
fi

printf '%s\n'   "$OUT_DIR/xdrive-source-agent-linux-amd64"   "$OUT_DIR/xdrive-source-agent-linux-arm64"
