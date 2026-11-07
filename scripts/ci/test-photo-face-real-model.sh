#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Orchestrate three narrowly scoped containers. The Go test NEVER receives a
# host Docker socket/CLI, credentials, production data, or a host network.
task="$(mktemp -d "${TMPDIR:-/tmp}/xdrive-face-e2e.XXXXXX")"
chmod 755 "$task"
suffix="$(basename "$task" | tr '[:upper:].' '[:lower:]-')"
network="$suffix"; volume="$suffix"
database="$suffix-db"; model="$suffix-model"; runner="$suffix-go"
cleanup() {
  docker logs "$model" >"$task/model.log" 2>&1 || true
  docker rm -f "$runner" "$model" "$database" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$task"
}
trap cleanup EXIT
curl --fail --location --retry 3 --max-time 120 \
  https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png \
  -o "$task/astronaut.png"
echo "88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5  $task/astronaut.png" | sha256sum --check
CGO_ENABLED=0 go test -c -o "$task/face-api.test" ./internal/api
chmod 755 "$task/face-api.test"
chmod 644 "$task/astronaut.png"
docker pull postgres:16-alpine >/dev/null
docker pull golang:1.25-bookworm >/dev/null
docker network create --internal "$network" >/dev/null
docker volume create "$volume" >/dev/null
token="faced00dfaced00dfaced00dfaced00dfaced00dfaced00dfaced00dfaced00d"
origin="http://$runner:18089"
docker run -d --rm --name "$database" --network "$network" \
  -e POSTGRES_PASSWORD=face-local-test postgres:16-alpine >/dev/null
# Mount at the production image's existing 65532-owned directory. Docker copies
# that ownership into this task-only fresh volume; both peers keep the same UID.
program='import os
from analyzer import FaceRuntime,AnalyzerState,ThreadingUnixHTTPServer,AnalyzerHandler
state=AnalyzerState(FaceRuntime(),None,None,None,os.environ["FACE_TEST_ORIGIN"],os.environ["FACE_TEST_TOKEN"],private_ingress_policy="require-bearer-v1")
with ThreadingUnixHTTPServer("/run/xdrive-photo-face/face.sock",AnalyzerHandler,state) as server:
 server.serve_forever()'
docker run -d --rm --name "$model" --network "$network" \
  --user 65532:65532 --security-opt no-new-privileges --cap-drop=ALL \
  --mount "type=volume,src=$volume,dst=/run/xdrive-photo-face" \
  -e "FACE_TEST_ORIGIN=$origin" -e "FACE_TEST_TOKEN=$token" \
  --entrypoint python xdrive/photo-face:test -c "$program" >/dev/null
ready=false
for _ in $(seq 1 40); do
  # initdb temporarily starts a Unix-socket-only server. The test peer needs
  # the final TCP listener, so a local socket success is not readiness.
  if docker exec "$database" pg_isready -h 127.0.0.1 -U postgres >/dev/null; then ready=true; break; fi
  sleep 0.25
done
[[ "$ready" == true ]]
docker run --rm --name "$runner" --network "$network" \
  --user 65532:65532 --security-opt no-new-privileges --cap-drop=ALL \
  --mount "type=volume,src=$volume,dst=/task" \
  --mount "type=bind,src=$task/face-api.test,dst=/face-api.test,readonly" \
  --mount "type=bind,src=$task/astronaut.png,dst=/astronaut.png,readonly" \
  -e TEMP=/task -e TMP=/task -e TMPDIR=/task \
  -e "XD_TEST_DATABASE_URL=postgres://postgres:face-local-test@$database:5432/postgres?sslmode=disable" \
  -e XD_FACE_REAL_MODEL_E2E=1 -e XD_FACE_REAL_SOCKET=/task/face.sock \
  -e "XD_FACE_REAL_TOKEN=$token" -e "XD_FACE_REAL_PREVIEW_ORIGIN=$origin" \
  -e XD_FACE_REAL_PREVIEW_LISTEN=0.0.0.0:18089 -e XD_FACE_REAL_FIXTURE=/astronaut.png \
  golang:1.25-bookworm /face-api.test -test.run='^TestFaceRealModelGalleryE2E$' -test.v -test.timeout=5m
