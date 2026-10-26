#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
XDRIVE_HOME="$TMP/xdrive-home"
CONFIG_DIR="$XDRIVE_HOME/config"
DATA_DIR="$XDRIVE_HOME/data"
FILES_DIR="$DATA_DIR/files"
POSTGRES_DIR="$DATA_DIR/postgres"
CONTROL_DIR="$XDRIVE_HOME/state/control"
OVERRIDE="$TMP/compose.override.yml"
HTTP_CLIENT_IMAGE="${XDRIVE_CI_GO_IMAGE:-golang:1.25-bookworm}"
mkdir -p "$CONFIG_DIR" "$FILES_DIR" "$POSTGRES_DIR" "$CONTROL_DIR"
chmod 0777 "$CONTROL_DIR"
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
XD_HOST_CONTROL_HOST_DIR=$CONTROL_DIR
EOF

cat > "$OVERRIDE" <<EOF
services:
  test-client:
    image: $HTTP_CLIENT_IMAGE
    command: ["sleep", "infinity"]
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
  -ec '
    chown 65532:65532 /data
    chmod 0750 /data
    mkdir -p /data/.xdrive-uploads /data/.xdrive-media/thumbnails/ab /data/.xdrive-localpush-stage-locks
    printf "65532:65532\n" > /data/.xdrive-uploads/.ownership-v1
    printf "legacy-cache-bytes" > /data/.xdrive-media/thumbnails/ab/legacy
    touch /data/.xdrive-temp-lifecycle.lock /data/.xdrive-localpush-stage-locks/ab.lock
    chown -R 1000:1000 /data/.xdrive-media /data/.xdrive-localpush-stage-locks
    chown 1000:1000 /data/.xdrive-temp-lifecycle.lock
    chmod 0600 /data/.xdrive-temp-lifecycle.lock /data/.xdrive-localpush-stage-locks/ab.lock /data/.xdrive-media/thumbnails/ab/legacy
    chown 0:0 /data/.xdrive-uploads
    chmod 0700 /data/.xdrive-uploads
    stat -c "%i:%s" /data/.xdrive-temp-lifecycle.lock /data/.xdrive-localpush-stage-locks/ab.lock
  ' > "$TMP/legacy-lock-inodes.before"
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

docker run --rm --network none --read-only --cap-drop ALL --user 65532:65532 \
  -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -ec '
    test "$(cat /data/.xdrive-uploads/.ownership-v2)" = "65532:65532"
    test "$(cat /data/.xdrive-media/thumbnails/ab/legacy)" = "legacy-cache-bytes"
    for lock in /data/.xdrive-temp-lifecycle.lock /data/.xdrive-localpush-stage-locks/ab.lock; do
      test -r "$lock" && test -w "$lock"
      test "$(stat -c "%u:%g:%a" "$lock")" = "65532:65532:600"
      exec 8<>"$lock"
      exec 8>&-
    done
    stat -c "%i:%s" /data/.xdrive-temp-lifecycle.lock /data/.xdrive-localpush-stage-locks/ab.lock
  ' > "$TMP/legacy-lock-inodes.after"
cmp "$TMP/legacy-lock-inodes.before" "$TMP/legacy-lock-inodes.after"

printf 'chunk-admin-password-123\n' |
  compose exec -T server xdrive-server admin create \
    --username chunk-admin --password-stdin >/dev/null

login_file="$TMP/login.json"
http -fsS \
  -H 'Content-Type: application/json' \
  -d '{"username":"chunk-admin","password":"chunk-admin-password-123"}' \
  "http://server:8080/api/v1/auth/login" > "$login_file"
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
  -H "Authorization: Bearer $token" \
  "http://server:8080/api/v1/nodes/root" > "$root_file"
root_id="$(python3 - "$root_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["id"])
PY
)"

hash='9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
session_file="$TMP/session.json"
http -fsS \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"parent_id\":$root_id,\"name\":\"probe.bin\",\"size\":4,\"chunk_size\":4194304,\"sha256\":\"$hash\",\"resume_key\":\"chunk-storage-probe\"}" \
  "http://server:8080/api/v1/uploads" > "$session_file"
session_id="$(python3 - "$session_file" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["id"])
PY
)"

chunk_body="$TMP/chunk-response.json"
chunk_result="$(
  http -sS \
    -w $'\n%{http_code}' \
    -X PUT \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/octet-stream' \
    -H "X-Chunk-SHA256: $hash" \
    --data-binary 'test' \
    "http://server:8080/api/v1/uploads/$session_id/chunks/0"
)"
chunk_status="${chunk_result##*$'\n'}"
printf '%s' "${chunk_result%$'\n'*}" > "$chunk_body"

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
  -X POST \
  -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "http://server:8080/api/v1/uploads/$session_id/finalize" > "$final_file"
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
http -fsS \
  -H "Authorization: Bearer $token" \
  -F 'file=@-;filename=probe-copy.bin' \
  "http://server:8080/api/v1/nodes/$root_id/files" \
  < "$duplicate_file" > "$duplicate_json"
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
  -H "Authorization: Bearer $token" \
  "http://server:8080/api/v1/files/$node_id/content" > "$download_file"
printf 'test' > "$TMP/expected.bin"
cmp "$TMP/expected.bin" "$download_file"

# Production regression: after root-to-user migration the staging ownership
# marker can be correct while the CAS parents were copied as root 0700. HTTP
# readyz still passes because it probes only /data and staging, but an offline
# backup consistency verifier cannot traverse .xdrive-blobs. The one-shot
# storage-init must restore ONLY the bounded CAS parent directories without
# re-owning immutable blob files.
pg_image="$(docker inspect xdrive-postgres --format '{{.Image}}')"
[[ "$pg_image" =~ ^sha256:[a-f0-9]{64}$ ]]
docker run --rm --pull never --network none --user 0:0 \
  --mount "type=bind,src=$FILES_DIR,dst=/data" --entrypoint sh "$pg_image" -ec '
    test "$(cat /data/.xdrive-uploads/.ownership-v2)" = "65532:65532"
    for dir in /data/.xdrive-blobs /data/.xdrive-blobs/sha256 /data/.xdrive-blobs/sha256/"$1"; do
      chown 0:0 "$dir"
      chmod 0700 "$dir"
    done
    lockdir=/data/.xdrive-cas-lifecycle-locks
    lockfile="$lockdir/$1.lock"
    test -d "$lockdir"
    test -f "$lockfile"
    test ! -s "$lockfile"
    chown 0:0 "$lockdir" "$lockfile"
    chmod 0700 "$lockdir"
    chmod 0600 "$lockfile"
  ' xdrive-cas-regression "${hash:0:2}"
if docker run --rm --pull never --network none --user 65532:65532 \
  --mount "type=bind,src=$FILES_DIR,dst=/data,readonly" --entrypoint sh "$pg_image" \
  -ec 'ls /data/.xdrive-blobs >/dev/null' >/dev/null 2>&1; then
  echo "fixture error: CAS parent remained accessible despite simulated migration drift" >&2
  exit 1
fi
if docker run --rm --pull never --network none --user 65532:65532 \
  --mount "type=bind,src=$FILES_DIR,dst=/data,readonly" --entrypoint sh "$pg_image" \
  -ec 'ls /data/.xdrive-cas-lifecycle-locks >/dev/null' >/dev/null 2>&1; then
  echo "fixture error: CAS lifecycle locks remained accessible despite root drift" >&2
  exit 1
fi

# Verify the fixed OS lock inode is retained across the one-shot repair.
lock_inode_before="$(docker run --rm --pull never --network none --user 0:0 \
  --mount "type=bind,src=$FILES_DIR,dst=/data,readonly" --entrypoint sh "$pg_image" \
  -ec 'stat -c "%i:%s" "/data/.xdrive-cas-lifecycle-locks/$1.lock"' \
  xdrive-cas-regression "${hash:0:2}")"
compose run -T --rm --no-deps storage-init >/dev/null
lock_inode_after="$(docker run --rm --pull never --network none --user 0:0 \
  --mount "type=bind,src=$FILES_DIR,dst=/data,readonly" --entrypoint sh "$pg_image" \
  -ec 'stat -c "%i:%s" "/data/.xdrive-cas-lifecycle-locks/$1.lock"' \
  xdrive-cas-regression "${hash:0:2}")"
[[ "$lock_inode_before" == "$lock_inode_after" ]] || {
  echo "storage init replaced/truncated an active CAS lifecycle OS lock inode" >&2
  exit 1
}

docker run --rm --pull never --network none --user 65532:65532 \
  --mount "type=bind,src=$FILES_DIR,dst=/data,readonly" --entrypoint sh "$pg_image" \
  -ec '
    ls /data/.xdrive-blobs >/dev/null
    ls /data/.xdrive-blobs/sha256 >/dev/null
    ls "/data/.xdrive-blobs/sha256/$1" >/dev/null
    ls /data/.xdrive-cas-lifecycle-locks >/dev/null
    test -r "/data/.xdrive-cas-lifecycle-locks/$1.lock"
    test -w "/data/.xdrive-cas-lifecycle-locks/$1.lock"
    test -r "/data/$2"
  ' xdrive-cas-regression "${hash:0:2}" "$storage_key"

# Ensure repairs never modify actual CAS bytes or the deduplication identity.
http -fsS -H "Authorization: Bearer $token" \
  "http://server:8080/api/v1/files/$node_id/content" > "$TMP/after-cas-parent-repair.bin"
cmp "$TMP/expected.bin" "$TMP/after-cas-parent-repair.bin"
[[ "$(compose exec -T postgres psql -U xdrive -d xdrive -Atc "SELECT ref_count FROM xd_content_blobs WHERE sha256='$hash'")" == "2" ]]

echo "chunk storage deployment test passed"
