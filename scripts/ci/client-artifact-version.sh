#!/usr/bin/env bash
set -euo pipefail

sha="${GITHUB_SHA:-${CI_COMMIT_SHA:-}}"
if [[ -z "$sha" ]]; then
  sha="$(git rev-parse HEAD)"
fi
short_sha="${sha:0:12}"

tag=""
branch_name=""
if [[ -n "${GITHUB_REF_TYPE:-}" ]]; then
  if [[ "$GITHUB_REF_TYPE" == "tag" ]]; then
    tag="${GITHUB_REF_NAME:-}"
  elif [[ "$GITHUB_REF_TYPE" == "branch" ]]; then
    branch_name="${GITHUB_REF_NAME:-}"
  fi
else
  tag="${CI_COMMIT_TAG:-}"
  branch_name="${CI_COMMIT_BRANCH:-}"
fi

if [[ -n "$tag" ]]; then
  [[ "$tag" == v* ]] || {
    echo "client artifact tag must start with v; got $tag" >&2
    exit 1
  }
  XDRIVE_RELEASE_VERSION="$tag"
  XDRIVE_DESKTOP_VERSION="${tag#v}"
  XDRIVE_ARTIFACT_CHANNEL="stable"
  XDRIVE_ARTIFACT_PUBLISHABLE="1"
elif [[ "$branch_name" == "master" || "${GITHUB_REF:-}" == "refs/heads/master" ]]; then
  XDRIVE_RELEASE_VERSION="snapshot-$short_sha"
  XDRIVE_DESKTOP_VERSION="0.0.0-snapshot.$short_sha"
  XDRIVE_ARTIFACT_CHANNEL="master"
  XDRIVE_ARTIFACT_PUBLISHABLE="1"
else
  XDRIVE_RELEASE_VERSION="0.0.0-ci"
  XDRIVE_DESKTOP_VERSION="0.0.0-ci"
  XDRIVE_ARTIFACT_CHANNEL="ci"
  XDRIVE_ARTIFACT_PUBLISHABLE="0"
fi

export XDRIVE_RELEASE_VERSION XDRIVE_DESKTOP_VERSION
export XDRIVE_ARTIFACT_CHANNEL XDRIVE_ARTIFACT_PUBLISHABLE
