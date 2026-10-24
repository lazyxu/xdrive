#!/usr/bin/env bash
set -euo pipefail

# Diagnostic-only master smoke AFTER GitLab Snapshot was published. This is
# never a prerequisite for the release and may fail on restricted runners.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/gitlab-release-version.sh
: "${CI_REGISTRY:?GitLab Container Registry must be enabled}"
: "${CI_REGISTRY_IMAGE:?CI_REGISTRY_IMAGE is required}"
: "${CI_REGISTRY_USER:?CI_REGISTRY_USER is required}"
: "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD is required}"

printf '%s' "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" \
  --username "$CI_REGISTRY_USER" --password-stdin >/dev/null

image() { printf '%s/%s:%s\n' "$CI_REGISTRY_IMAGE" "$1" "$XDRIVE_IMAGE_TAG"; }

for name in xdrive-server xdrive-caddy xdrive-media-worker xdrive-photo-face; do
  remote="$(image "$name")"
  docker pull "$remote"
  actual="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$remote")"
  [[ "$actual" == "$XDRIVE_RELEASE_VERSION" ]] || {
    echo "post-release $name image version mismatch: $actual" >&2
    exit 1
  }
done

server="$(image xdrive-server)"
caddy="$(image xdrive-caddy)"
media="$(image xdrive-media-worker)"
face="$(image xdrive-photo-face)"

docker run --rm "$server" version | grep -Fqx "server version: $XDRIVE_RELEASE_VERSION"
docker run --rm "$caddy" caddy list-modules | grep -q '^dns.providers.alidns$'
docker run --rm "$caddy" caddy validate --config /etc/caddy/Caddyfile.http --adapter caddyfile
docker run --rm --entrypoint /usr/bin/ffmpeg "$media" -version | grep -q '^ffmpeg version '
docker run --rm --entrypoint /usr/bin/ffprobe "$media" -version | grep -q '^ffprobe version '
docker run --rm "$face" --self-test

echo "GitLab master images passed post-release smoke (diagnostic only)"
