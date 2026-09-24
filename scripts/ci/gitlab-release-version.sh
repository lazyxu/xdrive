#!/usr/bin/env bash
set -euo pipefail

: "${CI_COMMIT_SHA:?CI_COMMIT_SHA is required}"
short_sha="${CI_COMMIT_SHA:0:12}"
tag="${CI_COMMIT_TAG:-}"
branch="${CI_COMMIT_BRANCH:-}"

if [[ -n "$tag" ]]; then
  [[ "$tag" == v* ]] || {
    echo "release tags must start with v; got $tag" >&2
    exit 1
  }
  XDRIVE_RELEASE_VERSION="$tag"
  XDRIVE_DESKTOP_VERSION="${tag#v}"
  XDRIVE_SOURCE_REF="$tag"
  XDRIVE_IMAGE_TAG="$tag"
  XDRIVE_RELEASE_CHANNEL="stable"
  XDRIVE_RELEASE_COMMIT=""
  XDRIVE_RELEASE_TAG="$tag"
  XDRIVE_PROMOTION_TAG="latest"
else
  [[ "$branch" == "master" ]] || {
    echo "release packaging is allowed only for master or v* tags; branch=$branch" >&2
    exit 1
  }
  XDRIVE_RELEASE_VERSION="snapshot-$short_sha"
  XDRIVE_DESKTOP_VERSION="0.0.0-snapshot.$short_sha"
  XDRIVE_SOURCE_REF="$CI_COMMIT_SHA"
  XDRIVE_IMAGE_TAG="sha-$short_sha"
  XDRIVE_RELEASE_CHANNEL="master"
  XDRIVE_RELEASE_COMMIT="$CI_COMMIT_SHA"
  XDRIVE_RELEASE_TAG="snapshot-$short_sha"
  XDRIVE_PROMOTION_TAG="edge"
fi

export XDRIVE_RELEASE_VERSION XDRIVE_DESKTOP_VERSION XDRIVE_SOURCE_REF
export XDRIVE_IMAGE_TAG XDRIVE_RELEASE_CHANNEL XDRIVE_RELEASE_COMMIT
export XDRIVE_RELEASE_TAG XDRIVE_PROMOTION_TAG
