#!/usr/bin/env bash
# GitLab builds and stages all bytes locally. Publish verified immutable tags.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh
source scripts/ci/gitlab-registry-utils.sh

# Stable image tags are public immediately after docker push. The exact
# GitHub Final Gate is a preflight, never a post-publication check.
if [[ -n "${CI_COMMIT_TAG:-}" ]]; then
  go run scripts/ci/verify-github-stable-final-gate.go
fi
xdrive_registry_login

core=0
if [[ $# == 0 ]]; then
  core=1
  images=(
    "xdrive-server|dist/server-image|xdrive/server:test"
    "xdrive-caddy|dist/caddy-image|xdrive/caddy:test"
  )
elif [[ $# == 3 ]]; then
  images=("$1|$2|$3")
else
  echo "usage: gitlab-server-images.sh [image-name artifact-dir local-ref]" >&2
  exit 2
fi

if [[ "$core" == 1 ]]; then
  mkdir -p dist/release-image
  manifest="dist/release-image/image-manifest.tsv"
  printf 'commit\t%s\nchannel\t%s\n' "$CI_COMMIT_SHA" "$XDRIVE_RELEASE_CHANNEL" > "$manifest"
fi

for row in "${images[@]}"; do
  IFS='|' read -r name artifact_dir local_image tail <<< "$row"
  [[ -z "${tail:-}" ]] || { echo "unexpected image row: $row" >&2; exit 2; }
  case "$name" in
    xdrive-server|xdrive-caddy|xdrive-photo-face|xdrive-media-worker) ;;
    *) echo "unsupported image name: $name" >&2; exit 2 ;;
  esac
  bash scripts/ci/gitlab-fetch-staged-image.sh "$name" "$artifact_dir" "$local_image"
  release_ref="$CI_REGISTRY_IMAGE/$name:$XDRIVE_IMAGE_TAG"
  expected_id="$(cat "$artifact_dir/image.id")"
  expected_digest="$(cat "$artifact_dir/image.digest")"
  if xdrive_pull_or_absent "$release_ref"; then
    existing_id="$(docker image inspect --format '{{.Id}}' "$release_ref")"
    [[ "$existing_id" == "$expected_id" ]] || {
      echo "[xDrive] immutable release tag is already occupied by DIFFERENT bytes: $release_ref" >&2
      exit 1
    }
    xdrive_assert_image_identity "$release_ref" "$XDRIVE_RELEASE_VERSION" "$CI_COMMIT_SHA"
    echo "[xDrive] reuse verified immutable image $release_ref"
  else
    status=$?
    [[ "$status" == 10 ]] || exit 1
    docker tag "$local_image" "$release_ref"
    push_log="$(mktemp)"
    if ! docker push "$release_ref" > "$push_log" 2>&1; then
      cat "$push_log" >&2
      rm -f "$push_log"
      exit 1
    fi
    cat "$push_log"
    actual_digest="$(sed -nE 's/.*digest: (sha256:[0-9a-f]{64}).*/\1/p' "$push_log" | tail -n 1)"
    rm -f "$push_log"
    [[ "$actual_digest" == "$expected_digest" ]] || {
      echo "[xDrive] release digest differs from verified staged digest for $name" >&2; exit 1;
    }
  fi
  if [[ "$core" == 1 ]]; then
    printf 'image\t%s\t%s\t%s\n' "$name" "$release_ref" "$expected_digest" >> "$manifest"
  fi
done

if [[ "$core" == 1 ]]; then
  [[ "$(grep -c '^image' "$manifest")" == 2 ]] || exit 1
  echo "[xDrive] two core images published for exact Commit $CI_COMMIT_SHA"
fi
