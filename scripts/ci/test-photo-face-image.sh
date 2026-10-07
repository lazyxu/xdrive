#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source scripts/ci/build-metadata.sh

artifact_dir="${1:-dist/photo-face-image}"
runtime_image="xdrive/photo-face:test-runtime"
final_image="xdrive/photo-face:test"
analyzer_dir="$ROOT/services/photo-face-analyzer"

# The runtime image contains only stable interpreter/native/dependency/model
# inputs. Current xDrive business code and tests are mounted read-only below.
docker build \
  --target runtime \
  -f services/photo-face-analyzer/Dockerfile \
  -t "$runtime_image" \
  services/photo-face-analyzer

runtime_mount="type=bind,src=$analyzer_dir,dst=/workspace,readonly"
docker run --rm \
  --mount "$runtime_mount" \
  --workdir /workspace \
  "$runtime_image" \
  python -m unittest discover -s tests -v

docker run --rm \
  --mount "$runtime_mount" \
  --workdir /workspace \
  "$runtime_image" \
  python analyzer.py --self-test

docker run --rm \
  --mount "$runtime_mount" \
  --workdir /workspace \
  "$runtime_image" \
  python analyzer.py --benchmark --iterations 1

# The final image is the release artifact. Build and validate it separately so
# bind mounts never mask the packaged business code that will be published.
docker build \
  --target final \
  --build-arg "VERSION=$XDRIVE_BUILD_VERSION" \
  --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT" \
  -f services/photo-face-analyzer/Dockerfile \
  -t "$final_image" \
  services/photo-face-analyzer

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
