#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh
bash scripts/ci/check-go-min-version.sh 1.25

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required; found $(node --version)." >&2
  exit 1
fi

rm -rf release
mkdir -p release

pushd desktop >/dev/null
npm install --no-audit --no-fund
node scripts/set-version.mjs "$XDRIVE_DESKTOP_VERSION"
npm run dist:linux
popd >/dev/null

test -f desktop/release/xdrive-desktop-linux-amd64.deb
cp desktop/release/xdrive-desktop-linux-amd64.deb release/
bash scripts/build-linux-deb.sh "$XDRIVE_RELEASE_VERSION" release desktop/release/xdrive-desktop-linux-amd64.deb
test -f release/xdrive-client-linux-amd64.deb

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

echo "Built GitLab Linux release assets for $XDRIVE_RELEASE_TAG"
