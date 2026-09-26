#!/usr/bin/env bash
set -euo pipefail
source scripts/ci/client-artifact-version.sh
bash scripts/ci/test-linux-client-package.sh "$XDRIVE_RELEASE_VERSION" release/xdrive-linux-amd64.deb
