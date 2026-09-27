#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ci/build-metadata.sh"

output="$(
  GITHUB_SHA="$(git -C "$ROOT" rev-parse HEAD)" \
  GITHUB_REF_TYPE=branch \
  GITHUB_REF_NAME=master \
  GITHUB_REF=refs/heads/master \
  bash -c '
    source "'"$SCRIPT"'"
    printf "%s\n%s\n%s\n%s\n%s\n%s\n" \
      "$XDRIVE_BUILD_VERSION" \
      "$XDRIVE_BUILD_CHANNEL" \
      "$XDRIVE_BUILD_COMMIT" \
      "$XDRIVE_BUILD_COMMIT_MESSAGE_B64" \
      "$XDRIVE_BUILD_COMMIT_TIME" \
      "$XDRIVE_BUILD_TIME"
  '
)"

mapfile -t values <<<"$output"
[[ "${values[0]}" == snapshot-* ]]
[[ "${values[1]}" == master ]]
[[ "${values[2]}" =~ ^[0-9a-f]{40}$ ]]
[[ -n "${values[3]}" ]]
[[ "${values[4]}" == *T* ]]
[[ "${values[5]}" == *T* ]]

echo "Build metadata tests passed"
