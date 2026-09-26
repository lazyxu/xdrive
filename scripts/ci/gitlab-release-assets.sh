#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh

for arch in amd64 arm64; do
  source_agent="release/source-agent/xdrive-source-agent-linux-$arch"
  test -f "$source_agent" || {
    echo "CI-tested source-agent artifact is missing: $source_agent" >&2
    exit 1
  }
  cp "$source_agent" "release/xdrive-source-agent-linux-$arch"
  chmod +x "release/xdrive-source-agent-linux-$arch"
done

sed \
  -e "s|@SOURCE_REF@|$XDRIVE_SOURCE_REF|g" \
  -e "s|@IMAGE_TAG@|$XDRIVE_IMAGE_TAG|g" \
  -e "s|@IMAGE_REGISTRY@|$CI_REGISTRY_IMAGE|g" \
  -e "s|@RELEASE_CHANNEL@|$XDRIVE_RELEASE_CHANNEL|g" \
  -e "s|@RELEASE_COMMIT@|$XDRIVE_RELEASE_COMMIT|g" \
  deploy/install-server.sh > release/xdrive-server-install.sh
chmod +x release/xdrive-server-install.sh

cp deploy/docker-compose.yml release/docker-compose.yml
cp deploy/Caddyfile release/Caddyfile
cp deploy/.env.example release/xdrive.env.example
cp scripts/server-backup.sh scripts/server-backup-scheduled.sh scripts/server-restore.sh scripts/server-verify.sh scripts/server-doctor.sh release/
cp scripts/xdrive-server-host.sh release/xdrive-server
chmod +x release/server-backup.sh release/server-backup-scheduled.sh release/server-restore.sh release/server-verify.sh release/server-doctor.sh release/xdrive-server

echo "Collected GitLab source-agent and server deployment assets for $XDRIVE_RELEASE_TAG"
