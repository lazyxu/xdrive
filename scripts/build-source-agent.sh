#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-release/source-agent}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_LDFLAG="-X github.com/lazyxu/xdrive/internal/version.Version=$VERSION"

mkdir -p "$OUT_DIR"

build_one() {
  local artifact_arch="$1"
  local goarch="$artifact_arch"
  local goarm=""
  if [[ "$artifact_arch" == "armv7" ]]; then
    goarch="arm"
    goarm="7"
  fi
  local output="$OUT_DIR/xdrive-source-agent-linux-$artifact_arch"
  local go_env=(CGO_ENABLED=0 GOOS=linux "GOARCH=$goarch")
  if [[ -n "$goarm" ]]; then
    go_env+=("GOARM=$goarm")
  fi

  (
    cd "$ROOT"
    env "${go_env[@]}" go build -trimpath \
      -ldflags="-s -w $VERSION_LDFLAG" -o "$output" ./cmd/xdrive-source-agent
  )
  chmod 0755 "$output"

  local metadata
  metadata="$(go version -m "$output")"
  grep -Fq "GOOS=linux" <<< "$metadata"
  grep -Fq "GOARCH=$goarch" <<< "$metadata"
  if [[ -n "$goarm" ]]; then
    grep -Fq "GOARM=$goarm" <<< "$metadata"
  fi
}

build_one amd64
build_one arm64
build_one armv7

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  actual="$("$OUT_DIR/xdrive-source-agent-linux-amd64" version)"
  [[ "$actual" == "$VERSION" ]] || {
    echo "source-agent version mismatch: got $actual want $VERSION" >&2
    exit 1
  }
fi

printf '%s\n' \
  "$OUT_DIR/xdrive-source-agent-linux-amd64" \
  "$OUT_DIR/xdrive-source-agent-linux-arm64" \
  "$OUT_DIR/xdrive-source-agent-linux-armv7"
