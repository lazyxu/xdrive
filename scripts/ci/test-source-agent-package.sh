#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?release version is required}"
DIR="${2:-release/source-agent}"

for arch in amd64 arm64; do
  binary="$DIR/xdrive-source-agent-linux-$arch"
  test -f "$binary" || {
    echo "source-agent artifact is missing: $binary" >&2
    exit 1
  }
  go version -m "$binary" | grep -q "GOOS=linux"
  go version -m "$binary" | grep -q "GOARCH=$arch"
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
