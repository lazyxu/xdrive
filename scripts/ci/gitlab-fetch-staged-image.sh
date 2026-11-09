#!/usr/bin/env bash
# Import exactly the manifest + bytes staged by this GitLab pipeline.
set -euo pipefail
name="${1:?image name required}"
artifact_dir="${2:?artifact directory required}"
local_image="${3:?local image required}"
source scripts/ci/gitlab-release-version.sh
source scripts/ci/gitlab-registry-utils.sh
for file in ref digest id commit; do
  [[ -f "$artifact_dir/image.$file" && ! -L "$artifact_dir/image.$file" && -s "$artifact_dir/image.$file" ]] || {
    echo "[xDrive] missing or unsafe staged image.$file" >&2; exit 1;
  }
done
staged="$(cat "$artifact_dir/image.ref")"
digest="$(cat "$artifact_dir/image.digest")"
expected_id="$(cat "$artifact_dir/image.id")"
commit="$(cat "$artifact_dir/image.commit")"
expected_prefix="${CI_REGISTRY_IMAGE:?}/$name:ci-${CI_PIPELINE_ID:?}-"
[[ "$staged" == "$expected_prefix"* ]] || { echo "foreign staged image reference: $staged" >&2; exit 1; }
[[ "${staged#$expected_prefix}" =~ ^[0-9]+$ ]] || exit 1
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ && "$expected_id" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "$commit" == "$CI_COMMIT_SHA" ]] || { echo "staged image commit mismatch" >&2; exit 1; }

# A digest pull, never an unverified mutable staging tag.
remote_repo="${staged%:*}"
docker pull "$remote_repo@$digest"
actual_id="$(docker image inspect --format '{{.Id}}' "$remote_repo@$digest")"
[[ "$actual_id" == "$expected_id" ]] || { echo "staged image ID mismatch" >&2; exit 1; }
xdrive_assert_image_identity "$remote_repo@$digest" "$XDRIVE_RELEASE_VERSION" "$CI_COMMIT_SHA"
docker tag "$remote_repo@$digest" "$local_image"
echo "[xDrive] imported verified GitLab staged image $name@$digest"
