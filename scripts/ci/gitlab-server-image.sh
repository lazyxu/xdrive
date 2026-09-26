#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null

docker build -t xdrive/server:test .
bash scripts/test-server-chunk-storage.sh
