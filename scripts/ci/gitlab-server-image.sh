#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null
source scripts/ci/client-artifact-version.sh

docker build --build-arg "VERSION=$XDRIVE_RELEASE_VERSION" -t xdrive/server:test .
bash scripts/test-server-chunk-storage.sh
bash scripts/ci/export-docker-image.sh xdrive/server:test dist/server-image
