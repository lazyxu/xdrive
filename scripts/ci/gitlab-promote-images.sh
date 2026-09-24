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

for name in xdrive-server xdrive-web xdrive-caddy; do
  source_image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"
  target_image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_PROMOTION_TAG"
  docker pull "$source_image"
  docker tag "$source_image" "$target_image"
  docker push "$target_image"
done

echo "Promoted GitLab server images: $XDRIVE_IMAGE_TAG -> $XDRIVE_PROMOTION_TAG"
