#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null
docker info >/dev/null
test -f web/dist/index.html || {
  echo "CI-tested Web dist artifact is missing: web/dist/index.html" >&2
  exit 1
}
source scripts/ci/client-artifact-version.sh

GOPROXY="${GOPROXY:-https://proxy.golang.org|direct}"
GOSUMDB="${GOSUMDB:-sum.golang.org}"

docker build \
  --build-arg "VERSION=$XDRIVE_RELEASE_VERSION" \
  --build-arg "GOPROXY=$GOPROXY" \
  --build-arg "GOSUMDB=$GOSUMDB" \
  -f deploy/Caddy.Dockerfile \
  -t xdrive/caddy:test .
docker run --rm xdrive/caddy:test caddy list-modules | grep -q '^dns.providers.alidns$'
docker run --rm xdrive/caddy:test test -f /srv/index.html
docker run --rm xdrive/caddy:test caddy validate --config /etc/caddy/Caddyfile.http --adapter caddyfile
docker run --rm -e XD_DOMAIN=drive.example.test -e ALIYUN_ACCESS_KEY_ID=test -e ALIYUN_ACCESS_KEY_SECRET=test xdrive/caddy:test caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
bash scripts/ci/export-docker-image.sh xdrive/caddy:test dist/caddy-image
