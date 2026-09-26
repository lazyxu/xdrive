#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
CONFIG_DIR="$TMP/config"
BACKUP_ROOT="$TMP/backups"
mkdir -p "$CONFIG_DIR" "$BACKUP_ROOT"
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
XD_WEB_IMAGE=xdrive/web:not-used
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
  compose down -v --remove-orphans >/dev/null 2>&1 || true
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

docker run --rm -v xdrive_file-data:/data --entrypoint sh postgres:17-alpine -c   "mkdir -p /data/$uid/e2e && printf '%s' '$content' > /data/$storage_key"

compose up -d server worker >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$CONFIG_DIR" >/dev/null
backup_dir="$("$ROOT/scripts/server-backup.sh" --config-dir "$CONFIG_DIR" --output-dir "$BACKUP_ROOT")"
assert_runtime_services
[[ -f "$backup_dir/database.dump" ]]
[[ -f "$backup_dir/blobs.tar" ]]
[[ -f "$backup_dir/manifest.json" ]]
[[ -f "$backup_dir/SHA256SUMS.txt" ]]
(
  cd "$backup_dir"
  sha256sum -c SHA256SUMS.txt >/dev/null
)

# Deliberately corrupt both directions: a referenced blob disappears and an
# unreferenced blob appears. Verification must reject the state.
docker run --rm -v xdrive_file-data:/data --entrypoint sh postgres:17-alpine -c   "rm -f /data/$storage_key && printf orphan > /data/orphan.bin"

if "$ROOT/scripts/server-verify.sh" --config-dir "$CONFIG_DIR" >/dev/null 2>&1; then
  echo "verify unexpectedly accepted missing/orphan blobs" >&2
  exit 1
fi

"$ROOT/scripts/server-restore.sh" "$backup_dir"   --config-dir "$CONFIG_DIR"   --yes   --no-safety-backup >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$CONFIG_DIR" >/dev/null
restored="$(docker run --rm -v xdrive_file-data:/data:ro --entrypoint cat postgres:17-alpine "/data/$storage_key")"
[[ "$restored" == "$content" ]] || {
  echo "restored blob mismatch: $restored" >&2
  exit 1
}

if docker run --rm -v xdrive_file-data:/data:ro --entrypoint sh postgres:17-alpine -c 'test -e /data/orphan.bin'; then
  echo "orphan survived restore" >&2
  exit 1
fi

echo "backup/restore integration test passed"
