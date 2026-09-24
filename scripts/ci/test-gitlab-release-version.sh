#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
sha="0123456789abcdef0123456789abcdef01234567"

master_out="$(
  CI_COMMIT_SHA="$sha" CI_COMMIT_BRANCH=master CI_COMMIT_TAG= bash -c '
    source scripts/ci/gitlab-release-version.sh
    printf "%s\n" "$XDRIVE_RELEASE_VERSION" "$XDRIVE_DESKTOP_VERSION" "$XDRIVE_IMAGE_TAG" "$XDRIVE_RELEASE_CHANNEL" "$XDRIVE_RELEASE_TAG" "$XDRIVE_PROMOTION_TAG"
  '
)"
expected_master=$'snapshot-0123456789ab\n0.0.0-snapshot.0123456789ab\nsha-0123456789ab\nmaster\nsnapshot-0123456789ab\nedge'
[[ "$master_out" == "$expected_master" ]] || {
  printf 'unexpected master release version output:\n%s\n' "$master_out" >&2
  exit 1
}

tag_out="$(
  CI_COMMIT_SHA="$sha" CI_COMMIT_BRANCH= CI_COMMIT_TAG=v1.2.3 bash -c '
    source scripts/ci/gitlab-release-version.sh
    printf "%s\n" "$XDRIVE_RELEASE_VERSION" "$XDRIVE_DESKTOP_VERSION" "$XDRIVE_IMAGE_TAG" "$XDRIVE_RELEASE_CHANNEL" "$XDRIVE_RELEASE_TAG" "$XDRIVE_PROMOTION_TAG"
  '
)"
expected_tag=$'v1.2.3\n1.2.3\nv1.2.3\nstable\nv1.2.3\nlatest'
[[ "$tag_out" == "$expected_tag" ]] || {
  printf 'unexpected tag release version output:\n%s\n' "$tag_out" >&2
  exit 1
}

if CI_COMMIT_SHA="$sha" CI_COMMIT_BRANCH=feature CI_COMMIT_TAG= bash -c 'source scripts/ci/gitlab-release-version.sh' >/dev/null 2>&1; then
  echo "feature branches must not be accepted by release version resolution" >&2
  exit 1
fi

echo "GitLab release version semantics: OK"
