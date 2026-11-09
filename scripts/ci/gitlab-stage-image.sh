#!/usr/bin/env bash
# Stage a GitLab-built image directly in GitLab Registry, avoiding docker-save.
set -euo pipefail
name="${1:?image name required}"
artifact_dir="${2:?artifact directory required}"
local_image="${3:?local image required}"
[[ "$name" =~ ^xdrive-(server|caddy|photo-face|media-worker)$ ]] || exit 2
: "${CI_COMMIT_SHA:?full commit required}"
: "${CI_PIPELINE_ID:?pipeline ID required}"
: "${CI_JOB_ID:?job ID required}"
source scripts/ci/gitlab-release-version.sh
source scripts/ci/gitlab-registry-utils.sh
xdrive_assert_image_identity "$local_image" "$XDRIVE_RELEASE_VERSION" "$CI_COMMIT_SHA"
xdrive_registry_login

staged="${CI_REGISTRY_IMAGE}/$name:ci-${CI_PIPELINE_ID}-${CI_JOB_ID}"
mkdir -p "$artifact_dir"
docker tag "$local_image" "$staged"
push_log="$(mktemp)"
trap 'rm -f "$push_log"' EXIT
docker push "$staged" | tee "$push_log"
digest="$(sed -nE 's/.*digest: (sha256:[0-9a-f]{64}).*/\1/p' "$push_log" | tail -n 1)"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "[xDrive] GitLab Registry did not return an authoritative digest for $staged" >&2; exit 1;
}
image_id="$(docker image inspect --format '{{.Id}}' "$local_image")"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
printf '%s\n' "$staged" > "$artifact_dir/image.ref"
printf '%s\n' "$digest" > "$artifact_dir/image.digest"
printf '%s\n' "$image_id" > "$artifact_dir/image.id"
printf '%s\n' "$CI_COMMIT_SHA" > "$artifact_dir/image.commit"
echo "[xDrive] staged $name $CI_COMMIT_SHA as $staged@$digest"
