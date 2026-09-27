#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null
source scripts/ci/build-metadata.sh

docker build \
  --build-arg "VERSION=$XDRIVE_BUILD_VERSION" \
  --build-arg "BUILD_CHANNEL=$XDRIVE_BUILD_CHANNEL" \
  --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT" \
  --build-arg "BUILD_COMMIT_MESSAGE_B64=$XDRIVE_BUILD_COMMIT_MESSAGE_B64" \
  --build-arg "BUILD_COMMIT_TIME=$XDRIVE_BUILD_COMMIT_TIME" \
  --build-arg "BUILD_TIME=$XDRIVE_BUILD_TIME" \
  -t xdrive/server:test .

server_version_output="$(docker run --rm xdrive/server:test version)"
grep -Fqx "server version: $XDRIVE_BUILD_VERSION" <<<"$server_version_output"
grep -Fqx "channel: $XDRIVE_BUILD_CHANNEL" <<<"$server_version_output"
grep -Fqx "commit: $XDRIVE_BUILD_COMMIT" <<<"$server_version_output"
grep -Fqx "commit time: $XDRIVE_BUILD_COMMIT_TIME" <<<"$server_version_output"
grep -Fqx "build time: $XDRIVE_BUILD_TIME" <<<"$server_version_output"

bash scripts/test-server-chunk-storage.sh
bash scripts/ci/export-docker-image.sh xdrive/server:test dist/server-image
