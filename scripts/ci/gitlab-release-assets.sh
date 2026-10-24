#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh

for arch in amd64 arm64; do
  source_agent="release/source-agent/xdrive-source-agent-linux-$arch"
  test -f "$source_agent" || {
    echo "CI-produced source-agent artifact is missing: $source_agent" >&2
    exit 1
  }
  cp "$source_agent" "release/xdrive-source-agent-linux-$arch"
  chmod +x "release/xdrive-source-agent-linux-$arch"
done

# Bind every fetched deployment asset to the exact CI source commit.
# This Release installer must never be treated as an unverified raw bootstrap.
deploy_hash_manifest="$(mktemp)"
trap 'rm -f "$deploy_hash_manifest"' EXIT
sha256sum \
  deploy/docker-compose.yml \
  scripts/server-backup.sh \
  scripts/server-backup-scheduled.sh \
  scripts/server-restore.sh \
  scripts/server-verify.sh \
  scripts/server-doctor.sh \
  scripts/server-migrate-user.sh \
  scripts/server-control.sh \
  scripts/caddy-env-config.py \
  scripts/caddy-admission.py \
  scripts/xdrive-server-host.sh \
  > "$deploy_hash_manifest"
deploy_hash_manifest_b64="$(base64 -w0 "$deploy_hash_manifest")"
sed \
  -e "s|@DEPLOY_ASSET_MANIFEST_B64@|$deploy_hash_manifest_b64|g" \
  -e "s|@SOURCE_REF@|$XDRIVE_SOURCE_REF|g" \
  -e "s|@IMAGE_TAG@|$XDRIVE_IMAGE_TAG|g" \
  -e "s|@IMAGE_REGISTRY@|$CI_REGISTRY_IMAGE|g" \
  -e "s|@RELEASE_CHANNEL@|$XDRIVE_RELEASE_CHANNEL|g" \
  -e "s|@RELEASE_COMMIT@|$XDRIVE_RELEASE_COMMIT|g" \
  -e "s|@UPDATE_SOURCE@|gitlab|g" \
  deploy/install-server.sh > release/xdrive-server-install.sh
chmod +x release/xdrive-server-install.sh
if grep -Fq 'EMBEDDED_DEPLOY_ASSET_MANIFEST_B64="@DEPLOY_ASSET_MANIFEST_B64@"' release/xdrive-server-install.sh; then
  echo "GitLab Release installer missing embedded deployment asset hashes" >&2
  exit 1
fi

cp deploy/docker-compose.yml release/docker-compose.yml
cp deploy/.env.example release/xdrive.env.example
cp scripts/server-backup.sh scripts/server-backup-scheduled.sh scripts/server-restore.sh scripts/server-verify.sh scripts/server-doctor.sh scripts/server-migrate-user.sh release/
cp scripts/xdrive-server-host.sh release/xdrive-server
chmod +x release/server-backup.sh release/server-backup-scheduled.sh release/server-restore.sh release/server-verify.sh release/server-doctor.sh release/server-migrate-user.sh release/xdrive-server

echo "Collected GitLab source-agent and server deployment assets for $XDRIVE_RELEASE_TAG"
