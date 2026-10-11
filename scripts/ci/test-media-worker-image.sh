#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
source scripts/ci/build-metadata.sh
command -v docker >/dev/null
docker info >/dev/null

docker build \
  -f deploy/MediaWorker.Dockerfile \
  --build-arg "VERSION=$XDRIVE_BUILD_VERSION" \
  --build-arg "BUILD_CHANNEL=$XDRIVE_BUILD_CHANNEL" \
  --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT" \
  --build-arg "BUILD_COMMIT_MESSAGE_B64=$XDRIVE_BUILD_COMMIT_MESSAGE_B64" \
  --build-arg "BUILD_COMMIT_TIME=$XDRIVE_BUILD_COMMIT_TIME" \
  --build-arg "BUILD_TIME=$XDRIVE_BUILD_TIME" \
  --build-arg "GOPROXY=${GOPROXY:-https://proxy.golang.org|direct}" \
  --build-arg "GOSUMDB=${GOSUMDB:-sum.golang.org}" \
  --build-arg "GO_IMAGE=${XDRIVE_CI_GO_IMAGE:-golang:1.25-bookworm}" \
  --build-arg "RUNTIME_IMAGE=${XDRIVE_CI_ALPINE_IMAGE:-alpine:3.22}" \
  -t xdrive/media-worker:test .

version="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' xdrive/media-worker:test)"
test "$version" = "$XDRIVE_BUILD_VERSION"
metadata="$(docker run --rm --entrypoint /usr/local/bin/xdrive-server xdrive/media-worker:test version)"
grep -Fqx "server version: $XDRIVE_BUILD_VERSION" <<<"$metadata"
ffmpeg_version="$(docker run --rm --entrypoint /usr/bin/ffmpeg xdrive/media-worker:test -version)"
ffprobe_version="$(docker run --rm --entrypoint /usr/bin/ffprobe xdrive/media-worker:test -version)"
grep -q '^ffmpeg version ' <<<"$ffmpeg_version"
grep -q '^ffprobe version ' <<<"$ffprobe_version"

runtime_dir="$(mktemp -d)"
container="xdrive-media-worker-ci-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if command -v sudo >/dev/null 2>&1; then
    sudo rm -rf -- "$runtime_dir"
  else
    rm -rf -- "$runtime_dir"
  fi
}
trap cleanup EXIT
# The temporary directory still belongs to the runner here. Set permissions
# *before* chown to the nonroot container UID.
chmod 0700 "$runtime_dir"
if command -v sudo >/dev/null 2>&1; then
  sudo chown 65532:65532 "$runtime_dir"
else
  chown 65532:65532 "$runtime_dir"
fi
docker run -d --name "$container" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 65532:65532 \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  -v "$runtime_dir:/run/xdrive-media-worker" \
  xdrive/media-worker:test >/dev/null

healthy=0
for _ in $(seq 1 30); do
  if docker exec "$container" /usr/local/bin/xdrive-server media-worker check >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  docker logs "$container" >&2
  echo "isolated FFmpeg/FFprobe worker failed live Unix socket probe" >&2
  exit 1
fi
[[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" == "none" ]]
docker exec "$container" sh -ec 'test ! -d /data && test -S /run/xdrive-media-worker/media-worker.sock'
bash scripts/ci/export-docker-image.sh xdrive/media-worker:test "${1:-dist/media-worker-image}"
