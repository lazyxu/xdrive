#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.0+dev}"
OUT_DIR="${2:-release/core}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Release/update-capable client artifacts must carry the same build identity as
# the Desktop runtime. Snapshot update resolution compares version.Metadata().Commit
# with the rolling release commit, so building only Version causes a client to
# incorrectly offer its own snapshot as an update.
if [[ -n "${GITHUB_SHA:-}${CI_COMMIT_SHA:-}" ]]; then
  source "$ROOT/scripts/ci/build-metadata.sh"
fi

BUILD_VERSION="${XDRIVE_BUILD_VERSION:-$VERSION}"
BUILD_CHANNEL="${XDRIVE_BUILD_CHANNEL:-}"
BUILD_COMMIT="${XDRIVE_BUILD_COMMIT:-}"
BUILD_COMMIT_MESSAGE_B64="${XDRIVE_BUILD_COMMIT_MESSAGE_B64:-}"
BUILD_COMMIT_TIME="${XDRIVE_BUILD_COMMIT_TIME:-}"
BUILD_TIME="${XDRIVE_BUILD_TIME:-}"

[[ "$BUILD_VERSION" == "$VERSION" ]] || {
  echo "client core build version mismatch: metadata=$BUILD_VERSION requested=$VERSION" >&2
  exit 1
}

expected_channel=""
case "$VERSION" in
  snapshot)
    expected_channel="master"
    ;;
  v*)
    expected_channel="stable"
    ;;
esac

if [[ -n "$expected_channel" ]]; then
  [[ "$BUILD_CHANNEL" == "$expected_channel" ]] || {
    echo "client core $VERSION build requires channel=$expected_channel; got ${BUILD_CHANNEL:-<empty>}" >&2
    exit 1
  }
  [[ "$BUILD_COMMIT" =~ ^[0-9a-fA-F]{40}$ ]] || {
    echo "client core $VERSION build requires a full 40-character commit SHA" >&2
    exit 1
  }
  for value_name in BUILD_COMMIT_MESSAGE_B64 BUILD_COMMIT_TIME BUILD_TIME; do
    [[ -n "${!value_name}" ]] || {
      echo "client core $VERSION build requires $value_name" >&2
      exit 1
    }
  done
fi

BUILD_LDFLAGS="-s -w -X github.com/lazyxu/xdrive/internal/version.Version=$BUILD_VERSION"
if [[ -n "$BUILD_CHANNEL" ]]; then
  BUILD_LDFLAGS+=" -X github.com/lazyxu/xdrive/internal/version.Channel=$BUILD_CHANNEL"
fi
if [[ -n "$BUILD_COMMIT" ]]; then
  BUILD_LDFLAGS+=" -X github.com/lazyxu/xdrive/internal/version.Commit=$BUILD_COMMIT"
fi
if [[ -n "$BUILD_COMMIT_MESSAGE_B64" ]]; then
  BUILD_LDFLAGS+=" -X github.com/lazyxu/xdrive/internal/version.CommitMessageBase64=$BUILD_COMMIT_MESSAGE_B64"
fi
if [[ -n "$BUILD_COMMIT_TIME" ]]; then
  BUILD_LDFLAGS+=" -X github.com/lazyxu/xdrive/internal/version.CommitTime=$BUILD_COMMIT_TIME"
fi
if [[ -n "$BUILD_TIME" ]]; then
  BUILD_LDFLAGS+=" -X github.com/lazyxu/xdrive/internal/version.BuildTime=$BUILD_TIME"
fi

printf 'client core build metadata: version=%s channel=%s commit=%s\n' \
  "$BUILD_VERSION" "${BUILD_CHANNEL:-dev}" "${BUILD_COMMIT:-none}"

linux_dir="$OUT_DIR/linux-amd64"
windows_dir="$OUT_DIR/windows-amd64"
mkdir -p "$linux_dir" "$windows_dir"

build_linux() {
  (
    cd "$ROOT"
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$BUILD_LDFLAGS" -o "$linux_dir/xd" ./cmd/xd
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$BUILD_LDFLAGS" -o "$linux_dir/xdrive-agent" ./cmd/xdrive-agent
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$BUILD_LDFLAGS" -o "$linux_dir/xdrive-updater" ./cmd/xdrive-updater
  )
}

build_windows() {
  (
    cd "$ROOT"
    agent_resource="$ROOT/cmd/xdrive-agent/rsrc_windows_amd64.syso"
    rm -f "$agent_resource"
    trap 'rm -f "$agent_resource"' EXIT
    go run github.com/tc-hib/go-winres@v0.3.3 make --in packaging/windows/xdrive-agent-winres.json --arch amd64 --out cmd/xdrive-agent/rsrc
    [[ -f "$agent_resource" ]] || {
      echo "Windows agent icon resource was not generated: $agent_resource" >&2
      exit 1
    }
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="$BUILD_LDFLAGS" -o "$windows_dir/xd.exe" ./cmd/xd
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="$BUILD_LDFLAGS -H=windowsgui" -o "$windows_dir/xdrive-agent.exe" ./cmd/xdrive-agent
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
[[ "$actual" == "$BUILD_VERSION" ]] || {
  echo "client core version mismatch: got $actual want $BUILD_VERSION" >&2
  exit 1
}

printf '%s\n' "$linux_dir" "$windows_dir"
