#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null
source scripts/ci/client-artifact-version.sh

docker build --build-arg "VERSION=$XDRIVE_RELEASE_VERSION" -f deploy/Caddy.Dockerfile -t xdrive/caddy:test .
docker run --rm xdrive/caddy:test caddy list-modules | grep -q '^dns.providers.alidns$'
bash scripts/ci/export-docker-image.sh xdrive/caddy:test dist/caddy-image
