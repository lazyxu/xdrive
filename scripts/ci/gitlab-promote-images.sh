#!/usr/bin/env bash
# Promote only verified immutable images, never downgrade a mutable edge/latest.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh
source scripts/ci/gitlab-registry-utils.sh

if [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  go run scripts/ci/verify-github-stable-final-gate.go
fi
xdrive_registry_login

if [[ $# == 0 ]]; then
  images=(xdrive-server xdrive-caddy)
else
  images=("$@")
fi

# Preflight ALL inputs and existing mutable tags before changing ANY tag.
# The resource_group in GitLab serializes promotion for each image group.
XDRIVE_VERIFIED_SERVER_EDGE=0
for name in "${images[@]}"; do
  case "$name" in
    xdrive-server|xdrive-caddy|xdrive-photo-face|xdrive-media-worker) ;;
    *) echo "unsupported image name: $name" >&2; exit 2 ;;
  esac
  source_ref="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"
  docker pull "$source_ref"
  xdrive_assert_image_identity "$source_ref" "$XDRIVE_RELEASE_VERSION" "$CI_COMMIT_SHA"
  target="$CI_REGISTRY_IMAGE/$name:$XDRIVE_PROMOTION_TAG"
  xdrive_assert_promotion_ancestry "$name" "$CI_COMMIT_SHA" "$target"
done

for name in "${images[@]}"; do
  source_ref="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"
  target="$CI_REGISTRY_IMAGE/$name:$XDRIVE_PROMOTION_TAG"
  docker tag "$source_ref" "$target"
  docker push "$target"
  # Fail closed if the Registry did not retain the exact image we published.
  docker pull "$target"
  xdrive_assert_image_identity "$target" "$XDRIVE_RELEASE_VERSION" "$CI_COMMIT_SHA"
done
echo "[xDrive] promoted ${images[*]} from $XDRIVE_IMAGE_TAG to $XDRIVE_PROMOTION_TAG ($CI_COMMIT_SHA)"
