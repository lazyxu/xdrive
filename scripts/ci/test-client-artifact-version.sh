#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/ci/client-artifact-version.sh"
sha=0123456789abcdef0123456789abcdef01234567

check_case() {
  local want="$1"
  shift
  local got
  got="$(env -i PATH="$PATH" HOME="${HOME:-/tmp}" "$@" bash -c '
    source "'"$SCRIPT"'"
    printf "%s|%s|%s|%s\n" "$XDRIVE_RELEASE_VERSION" "$XDRIVE_DESKTOP_VERSION" "$XDRIVE_ARTIFACT_CHANNEL" "$XDRIVE_ARTIFACT_PUBLISHABLE"
  ')"
  [[ "$got" == "$want" ]] || {
    echo "artifact version mismatch: got=$got want=$want" >&2
    exit 1
  }
}

check_case "snapshot-0123456789ab|0.0.0-snapshot.0123456789ab|master|1"   GITHUB_SHA="$sha" GITHUB_REF_TYPE=branch GITHUB_REF_NAME=master GITHUB_REF=refs/heads/master
check_case "v1.2.3|1.2.3|stable|1"   GITHUB_SHA="$sha" GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v1.2.3 GITHUB_REF=refs/tags/v1.2.3
check_case "0.0.0-ci|0.0.0-ci|ci|0"   GITHUB_SHA="$sha" GITHUB_REF_TYPE=branch GITHUB_REF_NAME=feature/test GITHUB_REF=refs/heads/feature/test
check_case "snapshot-0123456789ab|0.0.0-snapshot.0123456789ab|master|1"   CI_COMMIT_SHA="$sha" CI_COMMIT_BRANCH=master
check_case "v2.0.0|2.0.0|stable|1"   CI_COMMIT_SHA="$sha" CI_COMMIT_TAG=v2.0.0
check_case "0.0.0-ci|0.0.0-ci|ci|0"   CI_COMMIT_SHA="$sha" CI_COMMIT_BRANCH=feature/test

echo "Client artifact version tests passed"
