#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh

# GitLab never re-runs the GitHub test suite. Before a stable v* tag
# changes any mutable registry tag, require the exact GitHub tag's
# completed full CI Final Gate and OCR smoke. Fail closed if unavailable.
if [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  go run scripts/ci/verify-github-stable-final-gate.go
fi

: "${CI_REGISTRY:?GitLab Container Registry must be enabled}"
: "${CI_REGISTRY_IMAGE:?CI_REGISTRY_IMAGE is required}"
: "${CI_REGISTRY_USER:?CI_REGISTRY_USER is required}"
: "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD is required}"

printf '%s' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin

for name in xdrive-server xdrive-caddy xdrive-photo-face xdrive-media-worker; do
  source_image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"
  target_image="$CI_REGISTRY_IMAGE/$name:$XDRIVE_PROMOTION_TAG"
  docker pull "$source_image"
  docker tag "$source_image" "$target_image"
  docker push "$target_image"
done

echo "Promoted GitLab server images: $XDRIVE_IMAGE_TAG -> $XDRIVE_PROMOTION_TAG"
