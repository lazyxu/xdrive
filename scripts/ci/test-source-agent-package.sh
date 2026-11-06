#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?release version is required}"
DIR="${2:-release/source-agent}"

for arch in amd64 arm64 armv7; do
  binary="$DIR/xdrive-source-agent-linux-$arch"
  test -f "$binary" || {
    echo "source-agent artifact is missing: $binary" >&2
    exit 1
  }
  expected_goarch="$arch"
  if [[ "$arch" == "armv7" ]]; then
    expected_goarch="arm"
  fi
  metadata="$(go version -m "$binary")"
  grep -Fq "GOOS=linux" <<< "$metadata"
  grep -Fq "GOARCH=$expected_goarch" <<< "$metadata"
  if [[ "$arch" == "armv7" ]]; then
    grep -Fq "GOARM=7" <<< "$metadata"
  fi
  chmod 0755 "$binary"
done

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  actual="$("$DIR/xdrive-source-agent-linux-amd64" version)"
  [[ "$actual" == "$VERSION" ]] || {
    echo "source-agent version mismatch: got $actual want $VERSION" >&2
    exit 1
  }
fi

echo "Synology source-agent exact release artifacts passed tests."
