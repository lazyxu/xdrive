#!/usr/bin/env bash
set -euo pipefail

source scripts/ci/client-artifact-version.sh

mkdir -p desktop/release
tar -C desktop/release -xzf dist/desktop-runtime-linux-amd64.tar.gz
test -x desktop/release/linux-unpacked/xdrive-desktop

for binary in xd xdrive-agent xdrive-updater; do
  test -f "release/core/linux-amd64/$binary" || {
    echo "prebuilt Linux core binary is missing: release/core/linux-amd64/$binary" >&2
    exit 1
  }
done

bash scripts/build-linux-deb.sh "$XDRIVE_RELEASE_VERSION" release desktop/release/linux-unpacked release/core/linux-amd64

test -f release/xdrive-linux-amd64.deb
