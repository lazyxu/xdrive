#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh

: "${CI_REGISTRY:?GitLab Container Registry must be enabled}"
: "${CI_REGISTRY_IMAGE:?CI_REGISTRY_IMAGE is required}"
: "${CI_REGISTRY_USER:?CI_REGISTRY_USER is required}"
: "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD is required}"

printf '%s' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin

prepare_exact() {
  local name="$1"
  local artifact_dir="$2"
  local local_image="$3"
  local remote_image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"

  bash scripts/ci/import-docker-image.sh "$artifact_dir" "$local_image"

  local image_version
  image_version="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$local_image")"
  [[ "$image_version" == "$XDRIVE_RELEASE_VERSION" ]] || {
    echo "exact image version label mismatch: got $image_version want $XDRIVE_RELEASE_VERSION for $local_image" >&2
    exit 1
  }

  docker tag "$local_image" "$remote_image"
}

prepare_exact xdrive-server dist/server-image xdrive/server:test
prepare_exact xdrive-web dist/web-image xdrive/web:test
prepare_exact xdrive-caddy dist/caddy-image xdrive/caddy:test

images=(
  "$CI_REGISTRY_IMAGE/xdrive-server:$XDRIVE_IMAGE_TAG"
  "$CI_REGISTRY_IMAGE/xdrive-web:$XDRIVE_IMAGE_TAG"
  "$CI_REGISTRY_IMAGE/xdrive-caddy:$XDRIVE_IMAGE_TAG"
)
pids=()

for image in "${images[@]}"; do
  docker push "$image" &
  pids+=("$!")
done

status=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    echo "failed to push ${images[$i]}" >&2
    status=1
  fi
done
[[ "$status" == "0" ]] || exit "$status"

echo "Published exact CI-tested GitLab server images with tag $XDRIVE_IMAGE_TAG"
