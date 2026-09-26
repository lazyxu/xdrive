#!/usr/bin/env bash
set -euo pipefail

bash scripts/ci/check-go-min-version.sh 1.25
source scripts/ci/client-artifact-version.sh
bash scripts/build-source-agent.sh "$XDRIVE_RELEASE_VERSION" release/source-agent
test -x release/source-agent/xdrive-source-agent-linux-amd64
test -x release/source-agent/xdrive-source-agent-linux-arm64
