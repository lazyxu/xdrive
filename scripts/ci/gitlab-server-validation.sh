#!/usr/bin/env bash
set -euo pipefail

bash scripts/ci/check-go-min-version.sh 1.25
command -v docker >/dev/null
docker compose version >/dev/null
docker info >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null

export POSTGRES_PASSWORD=ci-postgres-password
export XD_JWT_SECRET=ci-jwt-secret-that-is-long-enough
export XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:edge
export XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:edge
export XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:edge

bash -n deploy/install-server.sh
bash -n scripts/server-backup.sh
bash -n scripts/server-backup-scheduled.sh
bash -n scripts/server-restore.sh
bash -n scripts/server-verify.sh
bash -n scripts/test-server-verify.sh
bash scripts/test-server-verify.sh
bash -n scripts/server-doctor.sh
bash -n scripts/test-server-doctor.sh
bash scripts/test-server-doctor.sh
bash -n scripts/test-server-backup-restore.sh
bash -n scripts/test-server-chunk-storage.sh
bash -n scripts/test-server-installer-bootstrap.sh
bash scripts/test-server-installer-bootstrap.sh
bash -n scripts/test-server-installer-transaction.sh
bash scripts/test-server-installer-transaction.sh
bash -n scripts/test-server-installer-pipe.sh
bash scripts/test-server-installer-pipe.sh
bash -n scripts/xdrive-server-host.sh
bash -n scripts/test-xdrive-server-host.sh
bash scripts/test-xdrive-server-host.sh
bash -n scripts/cleanup-merged-branches.sh
bash -n scripts/test-cleanup-merged-branches.sh
bash scripts/test-cleanup-merged-branches.sh
bash -n scripts/test-update-channels.sh
bash scripts/test-update-channels.sh
bash -n scripts/ci/download-with-fallback.sh
bash -n scripts/ci/install-node22.sh
bash -n scripts/ci/install-docker-cli.sh
bash -n scripts/ci/test-download-with-fallback.sh
bash scripts/ci/test-download-with-fallback.sh
bash -n scripts/ci/check-go-min-version.sh
bash -n scripts/ci/client-artifact-version.sh
bash -n scripts/ci/test-client-artifact-version.sh
bash scripts/ci/test-client-artifact-version.sh
bash -n scripts/ci/gitlab-release-version.sh
bash -n scripts/ci/gitlab-package-linux.sh
bash -n scripts/ci/gitlab-package-windows.sh
bash -n scripts/ci/gitlab-server-images.sh
bash -n scripts/ci/gitlab-promote-images.sh
sh -n scripts/ci/gitlab-publish-release.sh
bash -n scripts/ci/test-gitlab-release-version.sh
bash scripts/ci/test-gitlab-release-version.sh
bash -n scripts/build-source-agent.sh
bash -n scripts/build-client-core.sh
bash -n scripts/ci/gitlab-desktop-windows.sh
bash -n scripts/ci/gitlab-go-linux.sh
bash -n scripts/ci/gitlab-package-linux-client.sh
bash -n scripts/ci/gitlab-source-agent.sh
bash -n scripts/ci/gitlab-server-validation.sh
bash -n scripts/ci/gitlab-go-windows.sh
bash -n scripts/ci/gitlab-package-windows-client.sh
bash -n scripts/ci/gitlab-test-linux-artifact.sh
bash -n scripts/ci/gitlab-test-source-agent-artifact.sh
bash -n scripts/ci/gitlab-test-windows-artifact.sh
bash -n scripts/ci/test-linux-client-package.sh
bash -n scripts/ci/test-source-agent-package.sh
bash -n scripts/ci/prepare-go-mod-cache.sh
bash -n scripts/ci/test-prepare-go-mod-cache.sh
bash scripts/ci/test-prepare-go-mod-cache.sh

docker compose -f deploy/docker-compose.yml config >/dev/null
XD_DOMAIN=drive.example.test \
XD_HTTPS_PORT=8443 \
ALIYUN_ACCESS_KEY_ID=ci-key \
ALIYUN_ACCESS_KEY_SECRET=ci-secret \
  docker compose --profile https -f deploy/docker-compose.yml config >/dev/null

generated="$(mktemp)"
sed \
  -e 's|@SOURCE_REF@|0123456789abcdef0123456789abcdef01234567|g' \
  -e 's|@IMAGE_TAG@|sha-0123456789ab|g' \
  -e 's|@IMAGE_REGISTRY@|ghcr.io/lazyxu|g' \
  -e 's|@RELEASE_CHANNEL@|master|g' \
  -e 's|@RELEASE_COMMIT@|0123456789abcdef0123456789abcdef01234567|g' \
  deploy/install-server.sh > "$generated"
bash -n "$generated"
grep -q 'sha-0123456789ab' "$generated"
grep -q 'BUILT_CHANNEL="${XD_BUILT_CHANNEL:-master}"' "$generated"
rm -f "$generated"

grep -q 'tags="$image:sha-${GITHUB_SHA::12}"' .github/workflows/release.yml
grep -q 'tag="snapshot-${GITHUB_SHA::12}"' .github/workflows/release.yml
grep -q 'target_tag="edge"' .github/workflows/release.yml
grep -q 'xdrive-caddy' .github/workflows/release.yml
grep -q '8443}:443/tcp' deploy/docker-compose.yml
grep -q 'dns alidns' deploy/Caddyfile
if grep -q 'tags=.*:edge' .github/workflows/release.yml; then
  echo "server image jobs must not publish edge before the full bundle succeeds" >&2
  exit 1
fi

backup_line="$(grep -n '^stage 5 "create pre-upgrade backup"' deploy/install-server.sh | head -n1 | cut -d: -f1)"
image_line="$(grep -n '^set_env XD_SERVER_IMAGE ' deploy/install-server.sh | head -n1 | cut -d: -f1)"
test -n "$backup_line" -a -n "$image_line"
test "$backup_line" -lt "$image_line"
grep -q 'STAGING_DIR/server-backup.sh' deploy/install-server.sh
grep -q 'server-doctor.sh' deploy/install-server.sh
grep -q 'server-doctor.sh' .github/workflows/release.yml
grep -q '/api/v1/readyz' deploy/install-server.sh
grep -q '/api/v1/readyz' scripts/server-doctor.sh
if grep -q '/api/v1/healthz' deploy/install-server.sh; then
  echo "install readiness gates must use /readyz, not /healthz" >&2
  exit 1
fi
grep -q 'xdrive-server-host.sh' deploy/install-server.sh
grep -q 'release/xdrive-server' .github/workflows/release.yml
if grep -q 'compose create server' scripts/server-backup.sh; then
  echo "server backup must not create/recreate the formal server service" >&2
  exit 1
fi
grep -q 'UPGRADE INCOMPLETE' deploy/install-server.sh
grep -q -- '--leave-server-stopped </dev/null' deploy/install-server.sh
grep -q 'flock -n 9' deploy/install-server.sh
grep -q -- '--leave-server-stopped' deploy/install-server.sh
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' deploy/install-server.sh
grep -q 'detailed Docker output is captured in' deploy/install-server.sh

docker build -t xdrive/server:test .
bash scripts/test-server-chunk-storage.sh

docker build -f deploy/Caddy.Dockerfile -t xdrive/caddy:test .
docker run --rm xdrive/caddy:test caddy list-modules | grep -q '^dns.providers.alidns$'

bash scripts/test-server-backup-restore.sh
