#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null

bash scripts/ci/import-docker-image.sh dist/server-image xdrive/server:test
bash scripts/test-server-backup-restore.sh
