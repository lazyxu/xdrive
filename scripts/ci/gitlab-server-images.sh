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

publish_exact() {
  local name="$1"
  local artifact_dir="$2"
  local local_image="$3"
  local image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"

  bash scripts/ci/import-docker-image.sh "$artifact_dir" "$local_image"

  local image_version
  image_version="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$local_image")"
  [[ "$image_version" == "$XDRIVE_RELEASE_VERSION" ]] || {
    echo "exact image version label mismatch: got $image_version want $XDRIVE_RELEASE_VERSION for $local_image" >&2
    exit 1
  }

  docker tag "$local_image" "$image"
  docker push "$image"
}

publish_exact xdrive-server dist/server-image xdrive/server:test
publish_exact xdrive-web dist/web-image xdrive/web:test
publish_exact xdrive-caddy dist/caddy-image xdrive/caddy:test

echo "Published exact CI-tested GitLab server images with tag $XDRIVE_IMAGE_TAG"
