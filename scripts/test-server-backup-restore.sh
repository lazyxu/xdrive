#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
XDRIVE_HOME="$TMP/xdrive-home"
CONFIG_DIR="$XDRIVE_HOME/config"
DATA_DIR="$XDRIVE_HOME/data"
FILES_DIR="$DATA_DIR/files"
POSTGRES_DIR="$DATA_DIR/postgres"
BACKUP_ROOT="$XDRIVE_HOME/backups/snapshots"
CONTROL_DIR="$XDRIVE_HOME/state/control"
mkdir -p "$CONFIG_DIR" "$FILES_DIR" "$POSTGRES_DIR" "$BACKUP_ROOT" "$CONTROL_DIR"
chmod 2770 "$CONTROL_DIR"
cp "$ROOT/deploy/docker-compose.yml" "$CONFIG_DIR/docker-compose.yml"
cat > "$CONFIG_DIR/.env" <<'EOF'
POSTGRES_PASSWORD=xdrive-backup-test
XD_JWT_SECRET=xdrive-backup-test-secret-that-is-long-enough
XD_CONNECTOR_SECRET_ACTIVE_VERSION=1
XD_CONNECTOR_SECRET_KEYS=1:1111111111111111111111111111111111111111111111111111111111111111
XD_SOURCE_PULL_INTERVAL=6h
XD_ACCESS_TOKEN_TTL=15m
XD_REFRESH_TOKEN_TTL=720h
XD_WEB_BIND=127.0.0.1
XD_WEB_PORT=31999
XD_ALLOWED_ORIGIN=http://localhost:31999
XD_MAX_UPLOAD_BYTES=21474836480
XD_SERVER_IMAGE=xdrive/server:test
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=0123456789abcdef0123456789abcdef01234567
XD_UPDATE_SOURCE=github
XD_DOCKER_MODE=rootful
XD_SERVER_UID=65532
XD_SERVER_GID=65532
XD_FILES_DATA_DIR=$FILES_DIR
XD_POSTGRES_DATA_DIR=$POSTGRES_DIR
EOF

compose() {
  docker compose --env-file "$CONFIG_DIR/.env" -f "$CONFIG_DIR/docker-compose.yml" "$@"
}

wait_postgres() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T postgres pg_isready -h 127.0.0.1 -U xdrive -d xdrive >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready" >&2
  return 1
}

wait_server() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "xDrive server did not become ready" >&2
  return 1
}

assert_runtime_services() {
  local running
  running="$(compose ps --status running --services)"
  grep -qx server <<<"$running"
  grep -qx worker <<<"$running"
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

compose up -d postgres >/dev/null
wait_postgres
printf 'admin-password-123\n' | compose run --rm --no-deps server admin create --username backup-admin --password-stdin >/dev/null

uid="$(compose exec -T postgres psql -U xdrive -d xdrive -Atc "SELECT id FROM xd_users WHERE username='backup-admin'")"
root_id="$(compose exec -T postgres psql -U xdrive -d xdrive -Atc "SELECT id FROM xd_nodes WHERE owner_id=$uid AND parent_id IS NULL")"
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c \
  "INSERT INTO xd_nodes(parent_id,name,type,owner_id,revision,created_at,updated_at) VALUES ($root_id,'backup.txt','file',$uid,1,now(),now())" >/dev/null
file_id="$(compose exec -T postgres psql -U xdrive -d xdrive -Atc "SELECT id FROM xd_nodes WHERE owner_id=$uid AND parent_id=$root_id AND name='backup.txt'")"
[[ "$file_id" =~ ^[0-9]+$ ]] || { echo "invalid test file id: $file_id" >&2; exit 1; }
storage_key="$uid/e2e/blob-backup"
content='backup-content-v1'
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c   "INSERT INTO xd_files(node_id,size,storage_key,created_at,updated_at) VALUES ($file_id,${#content},'$storage_key',now(),now())" >/dev/null

docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c   "mkdir -p /data/$uid/e2e && printf '%s' '$content' > /data/$storage_key"

compose up -d server worker >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
BACKUP_PROGRESS_FILE="$TMP/backup-progress.env"
backup_dir="$(
  XD_BACKUP_PROGRESS_FILE="$BACKUP_PROGRESS_FILE" \
  XD_BACKUP_PROGRESS_STAGE_CURRENT=5 \
  XD_BACKUP_PROGRESS_STAGE_TOTAL=9 \
  XD_BACKUP_PROGRESS_STAGE_NAME="创建升级前备份" \
  XD_BACKUP_PROGRESS_LOG_INTERVAL_SECONDS=1 \
  bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" --output-dir "$BACKUP_ROOT"
)"
assert_runtime_services
[[ -f "$backup_dir/database.dump" ]]
[[ -f "$backup_dir/blobs.tar" ]]
[[ -f "$backup_dir/manifest.json" ]]
[[ -f "$backup_dir/SHA256SUMS.txt" ]]
grep -q '"release_channel": "master"' "$backup_dir/manifest.json"
grep -q '"release_commit": "0123456789abcdef0123456789abcdef01234567"' "$backup_dir/manifest.json"
grep -q '"update_source": "github"' "$backup_dir/manifest.json"
grep -Eq '"estimated_blob_bytes": [0-9]+' "$backup_dir/manifest.json"
grep -Eq '"estimated_database_bytes": [0-9]+' "$backup_dir/manifest.json"
grep -Eq '"preflight_required_bytes": [0-9]+' "$backup_dir/manifest.json"
grep -Eq '"preflight_available_bytes": [0-9]+' "$backup_dir/manifest.json"
grep -q '^stage_current=5$' "$BACKUP_PROGRESS_FILE"
grep -q '^stage_total=9$' "$BACKUP_PROGRESS_FILE"
grep -q '^stage=创建升级前备份$' "$BACKUP_PROGRESS_FILE"
grep -q '^service=完成升级前备份$' "$BACKUP_PROGRESS_FILE"
grep -Eq '^bytes_done=[1-9][0-9]*$' "$BACKUP_PROGRESS_FILE"
grep -Eq '^bytes_total=[1-9][0-9]*$' "$BACKUP_PROGRESS_FILE"
(
  cd "$backup_dir"
  sha256sum -c SHA256SUMS.txt >/dev/null
)

metadata_backup_dir="$(
  bash "$ROOT/scripts/server-backup.sh" \
    --config-dir "$XDRIVE_HOME" \
    --output-dir "$XDRIVE_HOME/backups/metadata-test" \
    --skip-file-data
)"
assert_runtime_services
[[ -f "$metadata_backup_dir/database.dump" ]]
[[ ! -e "$metadata_backup_dir/blobs.tar" ]]
grep -q '"file_data_included": false' "$metadata_backup_dir/manifest.json"
if grep -q 'blobs.tar' "$metadata_backup_dir/SHA256SUMS.txt"; then
  echo "metadata-only backup unexpectedly checksums blobs.tar" >&2
  exit 1
fi
(
  cd "$metadata_backup_dir"
  sha256sum -c SHA256SUMS.txt >/dev/null
)

# Deliberately corrupt both directions: a referenced blob disappears and an
# unreferenced blob appears. Verification must reject the state.
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c   "rm -f /data/$storage_key && printf orphan > /data/orphan.bin"

if "$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null 2>&1; then
  echo "verify unexpectedly accepted missing/orphan blobs" >&2
  exit 1
fi

bash "$ROOT/scripts/server-restore.sh" "$backup_dir"   --config-dir "$XDRIVE_HOME"   --yes   --no-safety-backup >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
restored="$(docker run --rm -v "$FILES_DIR:/data":ro --entrypoint cat postgres:17-alpine "/data/$storage_key")"
[[ "$restored" == "$content" ]] || {
  echo "restored blob mismatch: $restored" >&2
  exit 1
}

if docker run --rm -v "$FILES_DIR:/data":ro --entrypoint sh postgres:17-alpine -c 'test -e /data/orphan.bin'; then
  echo "orphan survived restore" >&2
  exit 1
fi

echo "backup/restore integration test passed"
