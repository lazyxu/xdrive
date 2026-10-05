#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source scripts/ci/build-metadata.sh

artifact_dir="${1:-dist/photo-face-image}"
test_image="xdrive/photo-face:test-stage"
final_image="xdrive/photo-face:test"

docker build   --target test   --build-arg "VERSION=$XDRIVE_BUILD_VERSION"   --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT"   -f services/photo-face-analyzer/Dockerfile   -t "$test_image"   services/photo-face-analyzer

docker build   --target final   --build-arg "VERSION=$XDRIVE_BUILD_VERSION"   --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT"   -f services/photo-face-analyzer/Dockerfile   -t "$final_image"   services/photo-face-analyzer

version_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$final_image")"
revision_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$final_image")"
[[ "$version_label" == "$XDRIVE_BUILD_VERSION" ]] || {
  echo "photo-face image version label mismatch: got $version_label want $XDRIVE_BUILD_VERSION" >&2
  exit 1
}
[[ "$revision_label" == "$XDRIVE_BUILD_COMMIT" ]] || {
  echo "photo-face image revision label mismatch: got $revision_label want $XDRIVE_BUILD_COMMIT" >&2
  exit 1
}

docker run --rm "$final_image" --self-test
docker run --rm "$final_image" --benchmark --iterations 1

rm -rf "$artifact_dir"
bash scripts/ci/export-docker-image.sh "$final_image" "$artifact_dir"
