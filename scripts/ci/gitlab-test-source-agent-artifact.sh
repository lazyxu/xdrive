#!/usr/bin/env bash
set -euo pipefail
source scripts/ci/client-artifact-version.sh
bash scripts/ci/test-source-agent-package.sh "$XDRIVE_RELEASE_VERSION" release/source-agent
