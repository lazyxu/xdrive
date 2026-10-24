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
# Master snapshot publication only requires the exact packaged Caddy image.
# The full runtime probes still run for MR/v* and again after master publish.
if [[ "${XDRIVE_GITLAB_PACKAGE_ONLY:-0}" == "1" ]]; then
  version="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' xdrive/caddy:test)"
  [[ "$version" == "$XDRIVE_RELEASE_VERSION" ]] || {
    echo "packaged Caddy image version mismatch: $version" >&2; exit 1;
  }
  bash scripts/ci/export-docker-image.sh xdrive/caddy:test dist/caddy-image
  echo "GitLab master Caddy package exported; runtime smoke is post-release"
  exit 0
fi
docker run --rm xdrive/caddy:test caddy list-modules | grep -q '^dns.providers.alidns$'
docker run --rm xdrive/caddy:test test -f /srv/index.html
docker run --rm xdrive/caddy:test caddy validate --config /etc/caddy/Caddyfile.http --adapter caddyfile
docker run --rm -e XD_DOMAIN=drive.example.test -e ALIYUN_ACCESS_KEY_ID=test -e ALIYUN_ACCESS_KEY_SECRET=test xdrive/caddy:test caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
bash scripts/ci/export-docker-image.sh xdrive/caddy:test dist/caddy-image
