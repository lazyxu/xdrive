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

# Regenerable thumbnails must be omitted from both snapshot formats.
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -ec \
  'mkdir -p /data/.xdrive-media/thumbnails/2026 && printf cached > /data/.xdrive-media/thumbnails/2026/unreferenced.jpg && chown -R 65532:65532 /data/.xdrive-media'


compose up -d server worker >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
BACKUP_PROGRESS_FILE="$TMP/backup-progress.env"
BACKUP_LOG="$TMP/backup.log"
backup_dir="$(
  XD_BACKUP_PROGRESS_FILE="$BACKUP_PROGRESS_FILE" \
  XD_BACKUP_PROGRESS_STAGE_CURRENT=5 \
  XD_BACKUP_PROGRESS_STAGE_TOTAL=9 \
  XD_BACKUP_PROGRESS_STAGE_NAME="创建升级前备份" \
  XD_BACKUP_PROGRESS_LOG_INTERVAL_SECONDS=1 \
  bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" --output-dir "$BACKUP_ROOT" 2>"$BACKUP_LOG"
)"
grep -Eq 'backup space preflight: source≈[0-9]+(\.[0-9]+)? (B|KiB|MiB|GiB|TiB|PiB|EiB), required≈[0-9]+(\.[0-9]+)? (B|KiB|MiB|GiB|TiB|PiB|EiB), available=[0-9]+(\.[0-9]+)? (B|KiB|MiB|GiB|TiB|PiB|EiB)' "$BACKUP_LOG"
if grep -Eq 'source≈[0-9]+ bytes|required≈[0-9]+ bytes|available=[0-9]+ bytes' "$BACKUP_LOG"; then
  echo "backup preflight leaked raw byte counts" >&2
  exit 1
fi
assert_runtime_services
[[ -f "$backup_dir/database.dump" ]]
[[ -f "$backup_dir/blobs.tar" ]]
v1_entries="$(tar -tf "$backup_dir/blobs.tar")"
if grep -Eq '^([.]/)?[.]xdrive-media(/|$)' <<<"$v1_entries"; then
  echo "v1 full backup archived regenerable media cache" >&2
  exit 1
fi
grep -Fq "./$storage_key" <<<"$v1_entries" || {
  echo "v1 full backup omitted canonical file" >&2
  exit 1
}
[[ -f "$backup_dir/manifest.json" ]]
grep -q '"verification_mode": "fast"' "$backup_dir/manifest.json"
grep -q '"verification_mode": "fast"' "$backup_dir/verify.json"
grep -q '"hashed_bytes": 0' "$backup_dir/verify.json"
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

# A failed backup must not dump an entire shared-reference JSON report into
# the installer log, and must retain a private full report for diagnostics.
set +e
bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" \
  --output-dir "$TMP/failing-backups" --skip-file-data \
  >"$TMP/failed-backup.out" 2>"$TMP/failed-backup.err"
failed_backup_status=$?
set -e
[[ "$failed_backup_status" -ne 0 ]]
grep -q 'xDrive consistency verification failed; backup aborted.' "$TMP/failed-backup.err"
grep -q 'actionable issue counts:' "$TMP/failed-backup.err"
grep -q 'missing=' "$TMP/failed-backup.err"
grep -q 'orphans=' "$TMP/failed-backup.err"
[[ "$(wc -l < "$TMP/failed-backup.err")" -lt 120 ]]
test -s "$XDRIVE_HOME/logs/storage-verify-last-failed.json"
grep -q '"missing"' "$XDRIVE_HOME/logs/storage-verify-last-failed.json"
grep -q '"orphans"' "$XDRIVE_HOME/logs/storage-verify-last-failed.json"
test "$(stat -c '%a' "$XDRIVE_HOME/logs/storage-verify-last-failed.json")" = 600
assert_runtime_services

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

# Seed a real referenced canonical immutable CAS alongside the pre-existing
# legacy data file, so the Docker E2E covers both paths.
cas_content='canonical-content-v1'
cas_sha="$(printf '%s' "$cas_content" | sha256sum | awk '{print $1}')"
cas_key=".xdrive-blobs/sha256/${cas_sha:0:2}/$cas_sha"
cas_node_id="$(compose exec -T postgres psql -U xdrive -d xdrive -qAtc \
  "INSERT INTO xd_nodes(parent_id,name,type,owner_id,revision,created_at,updated_at) VALUES ($root_id,'cas-backup.bin','file',$uid,1,now(),now()) RETURNING id" | tr -d '\r')"
[[ "$cas_node_id" =~ ^[0-9]+$ ]] || { echo "invalid CAS test node" >&2; exit 1; }
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c \
  "INSERT INTO xd_files(node_id,size,storage_key,created_at,updated_at) VALUES ($cas_node_id,${#cas_content},'$cas_key',now(),now())" >/dev/null
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c \
  "INSERT INTO xd_content_blobs(sha256,size,storage_key,ref_count,state,created_at,updated_at) VALUES ('$cas_sha',${#cas_content},'$cas_key',1,'ready',now(),now())" >/dev/null
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c \
  "mkdir -p /data/.xdrive-blobs/sha256/${cas_sha:0:2} && printf '%s' '$cas_content' > /data/$cas_key"
"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null

# Incremental CAS+Manifest snapshot round trip, including legacy storage.
# This is intentionally opt-in: scheduled backups and the original v1 test
# retain their existing contracts.
incremental_backup_dir="$(
  bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" --incremental
)"
assert_runtime_services
[[ -f "$incremental_backup_dir/objects.index" ]]
[[ -f "$incremental_backup_dir/legacy.tar" ]]
v2_entries="$(tar -tf "$incremental_backup_dir/legacy.tar")"
if grep -Eq '^([.]/)?[.]xdrive-media(/|$)' <<<"$v2_entries"; then
  echo "incremental legacy.tar archived regenerable media cache" >&2
  exit 1
fi
grep -Fq "$storage_key" <<<"$v2_entries" || {
  echo "incremental legacy.tar omitted canonical file" >&2
  exit 1
}
[[ ! -e "$incremental_backup_dir/blobs.tar" ]]
grep -q '"format_version": 2' "$incremental_backup_dir/manifest.json"
grep -q '"verification_mode": "fast"' "$incremental_backup_dir/manifest.json"
(
  cd "$incremental_backup_dir"
  sha256sum -c SHA256SUMS.txt >/dev/null
)
# A second generation with unchanged storage must not duplicate repo objects.
sleep 1 # distinct seconds-based snapshot name
second_incremental_backup_dir="$(
  bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" --incremental
)"
[[ -f "$second_incremental_backup_dir/objects.index" ]]
repo_root="$XDRIVE_HOME/backups/incremental"
test -d "$repo_root/objects/sha256"
[[ -f "$repo_root/objects/sha256/${cas_sha:0:2}/$cas_sha" ]]
grep -Fq "$cas_sha" "$incremental_backup_dir/objects.index"
grep -Fq "$cas_sha" "$second_incremental_backup_dir/objects.index"
# v2's checksum list is itself untrusted: sha256sum -c would accept a
# truncated list with objects.index omitted. Reject this without stopping
# the healthy deployment or creating a default pre-restore safety backup.
checksum_original="$TMP/v2-checksums-original"
cp "$incremental_backup_dir/SHA256SUMS.txt" "$checksum_original"
grep -v '  objects.index$' "$checksum_original" > "$incremental_backup_dir/SHA256SUMS.txt"
if bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes >"$TMP/omitted-checksum-restore.log" 2>&1; then
  echo "restore accepted a v2 checksum manifest missing objects.index" >&2
  exit 1
fi
grep -Fq 'v2 checksum manifest mismatch' "$TMP/omitted-checksum-restore.log"
cp "$checksum_original" "$incremental_backup_dir/SHA256SUMS.txt"
[[ ! -e "$XDRIVE_HOME/backups/pre-restore" ]] || {
  echo "invalid checksum list triggered a safety backup" >&2
  exit 1
}
assert_runtime_services

# A file alias with the same byte-perfect digest is still not an acceptable
# committed snapshot entry: reject symlinks before opening database.dump.
mv "$incremental_backup_dir/database.dump" "$TMP/v2-database-held.dump"
ln -s "$TMP/v2-database-held.dump" "$incremental_backup_dir/database.dump"
if bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes >"$TMP/symlink-database-restore.log" 2>&1; then
  echo "restore accepted symlinked v2 database.dump" >&2
  exit 1
fi
grep -Fq 'v2 snapshot contains symlink database.dump' "$TMP/symlink-database-restore.log"
rm "$incremental_backup_dir/database.dump"
mv "$TMP/v2-database-held.dump" "$incremental_backup_dir/database.dump"
[[ ! -e "$XDRIVE_HOME/backups/pre-restore" ]] || {
  echo "symlinked snapshot entry triggered a safety backup" >&2
  exit 1
}
assert_runtime_services

# A missing or silently corrupted shared object must fail before a destructive
# restore, without stopping services or touching the live PostgreSQL database.
# The object itself is intentionally not listed in SHA256SUMS.txt: v2's
# objects.index is the only link to shared CAS bytes.
cas_repo_object="$repo_root/objects/sha256/${cas_sha:0:2}/$cas_sha"
cas_repo_held="$cas_repo_object.e2e-held"
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE backup_restore_probe(marker text NOT NULL); INSERT INTO backup_restore_probe VALUES ('live-must-survive');" >/dev/null
mv "$cas_repo_object" "$cas_repo_held"
# Use the DEFAULT safety-backup policy to prove fail-closed preflight does
# not create an unnecessary backup (or stop services) for an invalid repo.
if bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes >"$TMP/missing-cas-restore.log" 2>&1; then
  echo "restore unexpectedly accepted a missing shared CAS object" >&2
  exit 1
fi
grep -Fq "$cas_sha" "$TMP/missing-cas-restore.log"
if [[ -e "$XDRIVE_HOME/backups/pre-restore" ]]; then
  echo "invalid CAS unnecessarily triggered a safety backup before restore preflight" >&2
  exit 1
fi
mv "$cas_repo_held" "$cas_repo_object"
assert_runtime_services

mv "$cas_repo_object" "$cas_repo_held"
printf '%s' 'canonical-content-v2' >"$cas_repo_object" # same size, wrong SHA
if bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes --no-safety-backup >"$TMP/corrupt-cas-restore.log" 2>&1; then
  echo "restore unexpectedly accepted corrupt shared CAS bytes" >&2
  exit 1
fi
grep -Fq "CAS hash mismatch $cas_sha" "$TMP/corrupt-cas-restore.log"
rm -f "$cas_repo_object"
mv "$cas_repo_held" "$cas_repo_object"
assert_runtime_services
probe="$(compose exec -T postgres psql -U xdrive -d xdrive -Atc 'SELECT marker FROM backup_restore_probe' | tr -d '\r')"
[[ "$probe" == 'live-must-survive' ]] || { echo "rejected restore changed live DB" >&2; exit 1; }
live_cas="$(docker run --rm -v "$FILES_DIR:/data:ro" --entrypoint cat postgres:17-alpine "/data/$cas_key")"
[[ "$live_cas" == "$cas_content" ]] || { echo "rejected restore changed live CAS" >&2; exit 1; }

# Restore the first incremental generation after deliberately altering the data.
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c \
  "printf broken > /data/$storage_key"
bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes --no-safety-backup >/dev/null
assert_runtime_services
"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
restored_incremental="$(docker run --rm -v "$FILES_DIR:/data:ro" \
  --entrypoint cat postgres:17-alpine "/data/$storage_key")"
restored_cas="$(docker run --rm -v "$FILES_DIR:/data:ro" \
  --entrypoint cat postgres:17-alpine "/data/$cas_key")"
[[ "$restored_cas" == "$cas_content" ]] || {
  echo "incremental restore lost immutable canonical CAS file" >&2
  exit 1
}
[[ "$restored_incremental" == "$content" ]] || {
  echo "incremental restore lost legacy file content" >&2
  exit 1
}

echo "backup/restore integration test passed"
