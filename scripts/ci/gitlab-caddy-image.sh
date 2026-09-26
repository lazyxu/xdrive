#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null

docker build -f deploy/Caddy.Dockerfile -t xdrive/caddy:test .
docker run --rm xdrive/caddy:test caddy list-modules | grep -q '^dns.providers.alidns$'
