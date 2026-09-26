#!/usr/bin/env bash
set -euo pipefail

source scripts/ci/client-artifact-version.sh
mkdir -p desktop/release
tar -C desktop/release -xzf dist/desktop-runtime-linux-amd64.tar.gz
test -x desktop/release/linux-unpacked/xdrive-desktop

bash scripts/build-linux-deb.sh "$XDRIVE_RELEASE_VERSION" release desktop/release/linux-unpacked
test -f release/xdrive-linux-amd64.deb
