#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/scripts/ci/client-artifact-version.sh"

commit="${GITHUB_SHA:-${CI_COMMIT_SHA:-}}"
if [[ -z "$commit" ]]; then
  commit="$(git -C "$ROOT" rev-parse HEAD)"
fi

message="$(git -C "$ROOT" show -s --format=%s "$commit" 2>/dev/null || git -C "$ROOT" show -s --format=%s HEAD)"
commit_time="$(git -C "$ROOT" show -s --format=%cI "$commit" 2>/dev/null || git -C "$ROOT" show -s --format=%cI HEAD)"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
message_b64="$(printf '%s' "$message" | base64 | tr -d '\r\n')"

XDRIVE_BUILD_VERSION="$XDRIVE_RELEASE_VERSION"
XDRIVE_BUILD_CHANNEL="$XDRIVE_ARTIFACT_CHANNEL"
XDRIVE_BUILD_COMMIT="$commit"
XDRIVE_BUILD_COMMIT_MESSAGE_B64="$message_b64"
XDRIVE_BUILD_COMMIT_TIME="$commit_time"
XDRIVE_BUILD_TIME="$build_time"

export XDRIVE_BUILD_VERSION XDRIVE_BUILD_CHANNEL XDRIVE_BUILD_COMMIT
export XDRIVE_BUILD_COMMIT_MESSAGE_B64 XDRIVE_BUILD_COMMIT_TIME XDRIVE_BUILD_TIME
