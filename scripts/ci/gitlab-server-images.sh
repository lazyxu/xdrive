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

build_and_push() {
  local name="$1"
  local dockerfile="$2"
  local context="$3"
  local image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"
  docker build --build-arg "VERSION=$XDRIVE_RELEASE_VERSION" -f "$dockerfile" -t "$image" "$context"
  docker push "$image"
}

build_and_push xdrive-server ./Dockerfile .
build_and_push xdrive-web ./web/Dockerfile .
build_and_push xdrive-caddy ./deploy/Caddy.Dockerfile .

echo "Published immutable GitLab server images with tag $XDRIVE_IMAGE_TAG"
