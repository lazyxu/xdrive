#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
XDRIVE_HOME="$TMP/xdrive-home"
CONFIG_DIR="$XDRIVE_HOME/config"
DATA_DIR="$XDRIVE_HOME/data"
FILES_DIR="$DATA_DIR/files"
POSTGRES_DIR="$DATA_DIR/postgres"
OVERRIDE="$TMP/compose.override.yml"
HTTP_CLIENT_IMAGE="${XDRIVE_CI_GO_IMAGE:-golang:1.25-bookworm}"
mkdir -p "$CONFIG_DIR" "$FILES_DIR" "$POSTGRES_DIR"
cp "$ROOT/deploy/docker-compose.yml" "$CONFIG_DIR/docker-compose.yml"

cat > "$CONFIG_DIR/.env" <<EOF
POSTGRES_PASSWORD=xdrive-chunk-storage-test
XD_JWT_SECRET=xdrive-chunk-storage-test-secret-that-is-long-enough
XD_ACCESS_TOKEN_TTL=15m
XD_REFRESH_TOKEN_TTL=720h
XD_ALLOWED_ORIGIN=http://localhost:32081
XD_MAX_UPLOAD_BYTES=21474836480
XD_SERVER_IMAGE=xdrive/server:test
XD_WEB_IMAGE=xdrive/web:not-used
XD_DOCKER_MODE=rootful
XD_SERVER_UID=65532
XD_SERVER_GID=65532
XD_FILES_DATA_DIR=$FILES_DIR
XD_POSTGRES_DATA_DIR=$POSTGRES_DIR
EOF

cat > "$OVERRIDE" <<EOF
services:
  test-client:
    image: $HTTP_CLIENT_IMAGE
    command: ["sleep", "infinity"]
    volumes:
      - "$TMP:/test-output"
EOF

compose() {
  docker compose \
    --env-file "$CONFIG_DIR/.env" \
    -f "$CONFIG_DIR/docker-compose.yml" \
    -f "$OVERRIDE" \
    "$@"
}

http() {
  compose exec -T test-client curl "$@"
}

cleanup() {
  compose down --remove-orphans >/dev/null 2>&1 || true
  if [[ -d "$DATA_DIR" ]]; then
    docker run --rm \
      -v "$DATA_DIR:/xdrive-data" \
      --entrypoint sh \
      postgres:17-alpine \
      -c "chown -R $(id -u):$(id -g) /xdrive-data && chmod -R u+rwX /xdrive-data" \
      >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

# Create the named volume through Compose, then simulate the legacy failure
# mode: /data itself is writable by the distroless nonroot server, while the
# chunk staging directory is root-owned and inaccessible. The storage-init
# service must repair this before the API starts.
compose create postgres server >/dev/null
docker run --rm \
  -v "$FILES_DIR:/data" \
  --entrypoint sh \
  postgres:17-alpine \
  -c 'chown 65532:65532 /data && chmod 0750 /data && mkdir -p /data/.xdrive-uploads && chown 0:0 /data/.xdrive-uploads && chmod 0700 /data/.xdrive-uploads'
compose rm -sf server >/dev/null

compose up -d postgres server test-client >/dev/null

ready=0
for _ in $(seq 1 60); do
  if http -fsS --max-time 2 "http://server:8080/api/v1/readyz" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "server never became ready" >&2
  compose logs storage-init server >&2 || true
  exit 1
fi

staging_stat="$(
  docker run --rm \
    -v "$FILES_DIR:/data" \
    --entrypoint sh \
    postgres:17-alpine \
    -c 'stat -c "%u:%g:%a" /data/.xdrive-uploads'
)"
case "$staging_stat" in
  65532:65532:7??) ;;
  *)
    echo "storage-init did not repair staging ownership/mode: $staging_stat" >&2
    exit 1
    ;;
esac

printf 'chunk-admin-password-123\n' |
  compose exec -T server xdrive-server admin create \
    --username chunk-admin --password-stdin >/dev/null

login_file="$TMP/login.json"
http -fsS \
  -o /test-output/login.json \
  -H 'Content-Type: application/json' \
  -d '{"username":"chunk-admin","password":"chunk-admin-password-123"}' \
  "http://server:8080/api/v1/auth/login"
token="$(python3 - "$login_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["access_token"])
PY
)"
if [[ -z "$token" ]]; then
  echo "login returned an empty access token" >&2
  cat "$login_file" >&2
  exit 1
fi

root_file="$TMP/root.json"
http -fsS \
  -o /test-output/root.json \
  -H "Authorization: Bearer $token" \
  "http://server:8080/api/v1/nodes/root"
root_id="$(python3 - "$root_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["id"])
PY
)"

hash='9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
session_file="$TMP/session.json"
http -fsS \
  -o /test-output/session.json \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"parent_id\":$root_id,\"name\":\"probe.bin\",\"size\":4,\"chunk_size\":4194304,\"sha256\":\"$hash\",\"resume_key\":\"chunk-storage-probe\"}" \
  "http://server:8080/api/v1/uploads"
session_id="$(python3 - "$session_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["id"])
PY
)"

chunk_body="$TMP/chunk-response.json"
chunk_status="$(
  http -sS \
    -o /test-output/chunk-response.json \
    -w '%{http_code}' \
    -X PUT \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/octet-stream' \
    -H "X-Chunk-SHA256: $hash" \
    --data-binary 'test' \
    "http://server:8080/api/v1/uploads/$session_id/chunks/0"
)"

if [[ "$chunk_status" != "201" ]]; then
  echo "chunk upload failed after storage repair: HTTP $chunk_status $(cat "$chunk_body")" >&2
  compose logs server >&2 || true
  exit 1
fi
if ! grep -q '"size":4' "$chunk_body"; then
  echo "unexpected chunk response: $(cat "$chunk_body")" >&2
  exit 1
fi

final_file="$TMP/finalize.json"
http -fsS \
  -o /test-output/finalize.json \
  -X POST \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "http://server:8080/api/v1/uploads/$session_id/finalize"
node_id="$(python3 - "$final_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["result"]["id"])
PY
)"

storage_key="$(
  compose exec -T postgres psql -U xdrive -d xdrive -Atc     "SELECT storage_key FROM xd_files WHERE node_id=$node_id"
)"
expected_key=".xdrive-blobs/sha256/${hash:0:2}/$hash"
if [[ "$storage_key" != "$expected_key" ]]; then
  echo "finalized upload did not use CAS key: got=$storage_key want=$expected_key" >&2
  exit 1
fi

duplicate_file="$TMP/duplicate.bin"
printf 'test' > "$duplicate_file"
duplicate_json="$TMP/duplicate.json"
http -fsS   -o /test-output/duplicate.json   -H "Authorization: Bearer $token"   -F "file=@/test-output/duplicate.bin;filename=probe-copy.bin"   "http://server:8080/api/v1/nodes/$root_id/files"
duplicate_id="$(python3 - "$duplicate_json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["id"])
PY
)"
duplicate_key="$(
  compose exec -T postgres psql -U xdrive -d xdrive -Atc     "SELECT storage_key FROM xd_files WHERE node_id=$duplicate_id"
)"
ref_count="$(
  compose exec -T postgres psql -U xdrive -d xdrive -Atc     "SELECT ref_count FROM xd_content_blobs WHERE sha256='$hash'"
)"
if [[ "$duplicate_key" != "$storage_key" || "$ref_count" != "2" ]]; then
  echo "global dedup failed: first=$storage_key second=$duplicate_key ref_count=$ref_count" >&2
  exit 1
fi

download_file="$TMP/download.bin"
http -fsS \
  -o /test-output/download.bin \
  -H "Authorization: Bearer $token" \
  "http://server:8080/api/v1/files/$node_id/content"
printf 'test' > "$TMP/expected.bin"
cmp "$TMP/expected.bin" "$download_file"

echo "chunk storage deployment test passed"
