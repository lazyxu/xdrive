#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh

test -f release/xDriveSetup-amd64.exe || {
  echo "CI-tested Windows installer artifact is missing: release/xDriveSetup-amd64.exe" >&2
  exit 1
}

if find release -maxdepth 1 -type f -name '*DesktopSetup*' | grep -q .; then
  echo "standalone Desktop installer must not be published" >&2
  exit 1
fi

echo "Collected exact GitLab Windows installer for $XDRIVE_RELEASE_TAG"
