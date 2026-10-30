#!/usr/bin/env bash
set -euo pipefail
# Keep the true failing assertion visible even when the Docker/restore drill
# intentionally suppresses command output. Never print credentials or commands.
backup_drill_stage="setup"
trap 'rc=$?; printf "server-backup-restore: stage=%s line=%s exit=%s\n" "$backup_drill_stage" "$LINENO" "$rc" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# This integration suite executes the packaged host verifier directly. Fail
# before Docker startup if Git loses its executable bit.
if [[ ! -x "$ROOT/scripts/server-verify.sh" ]]; then
  echo "scripts/server-verify.sh must be executable (Git mode 100755)" >&2
  exit 1
fi
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
XD_SERVER_UID=2234
XD_SERVER_GID=3345
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

assert_postgres_legacy_backup_restored() {
  local found
  found="$(compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -qAtc \
    "SELECT COUNT(*) FROM xd_nodes n JOIN xd_files f ON f.node_id=n.id WHERE n.id=$file_id AND n.parent_id=$root_id AND n.owner_id=$uid AND n.name='backup.txt' AND f.storage_key='$storage_key' AND f.size=$legacy_size" | tr -d '\r')"
  [[ "$found" == 1 ]] || { echo "PostgreSQL legacy node/file mapping not restored" >&2; return 1; }
}

assert_postgres_cas_backup_restored() {
  local found marker
  found="$(compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -qAtc \
    "SELECT COUNT(*) FROM xd_nodes n JOIN xd_files f ON f.node_id=n.id JOIN xd_content_blobs b ON b.storage_key=f.storage_key WHERE n.id=$cas_node_id AND n.parent_id=$root_id AND n.owner_id=$uid AND n.name='cas-backup.bin' AND f.storage_key='$cas_key' AND f.size=$cas_size AND b.sha256='$cas_sha' AND b.size=$cas_size AND b.ref_count=1 AND b.state='ready'" | tr -d '\r')"
  [[ "$found" == 1 ]] || { echo "PostgreSQL CAS reference/content mapping not restored" >&2; return 1; }
  marker="$(compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -qAtc \
    "SELECT to_regclass('public.backup_restore_probe') IS NULL" | tr -d '\r')"
  [[ "$marker" == t ]] || { echo "PostgreSQL post-snapshot probe survived restoration" >&2; return 1; }
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

# A v2 capture cannot publish a source-inconsistent snapshot: both v2 restore
# and safe CAS pruning must refuse it. Reject either flag order before any
# Docker operation, repository mkdir, lock inode or service maintenance.
backup_drill_stage="v2-inconsistent-option-preflight"
mkdir -p "$TMP/backup-flag-probe-bin"
cat > "$TMP/backup-flag-probe-bin/docker" <<'DOCKER_PROBE'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker invoked despite rejected v2 options\n' >> "$XD_BACKUP_FLAG_DOCKER_MARKER"
exit 91
DOCKER_PROBE
chmod 700 "$TMP/backup-flag-probe-bin/docker"
for order in first second; do
  case "$order" in
    first) rejected_flags=(--incremental --allow-inconsistent) ;;
    second) rejected_flags=(--allow-inconsistent --incremental
      --repository-dir "$TMP/v2-forbidden-target/incremental") ;;
  esac
  marker="$TMP/rejected-v2-docker-$order"
  if XD_BACKUP_FLAG_DOCKER_MARKER="$marker" \
      PATH="$TMP/backup-flag-probe-bin:$PATH" \
      bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" \
        "${rejected_flags[@]}" >"$TMP/rejected-v2-$order.out" 2>"$TMP/rejected-v2-$order.err"; then
    echo "v2 accepted --allow-inconsistent ($order)" >&2
    exit 1
  fi
  grep -Fq 'xDrive backup: --incremental cannot be combined with --allow-inconsistent.' \
    "$TMP/rejected-v2-$order.err"
  if [[ -e "$marker" || -e "$XDRIVE_HOME/backups/incremental" ||
        -e "$TMP/v2-forbidden-target" ]]; then
    echo "invalid v2 flags started Docker or created a repository ($order)" >&2
    exit 1
  fi
done
backup_drill_stage="setup"

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
legacy_size="$(printf '%s' "$content" | wc -c | tr -d '[:space:]')"
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c   "INSERT INTO xd_files(node_id,size,storage_key,created_at,updated_at) VALUES ($file_id,${#content},'$storage_key',now(),now())" >/dev/null

docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c   "mkdir -p /data/$uid/e2e && printf '%s' '$content' > /data/$storage_key"

# Regenerable thumbnails must be omitted from both snapshot formats.
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -ec \
  'mkdir -p /data/.xdrive-media/thumbnails/2026 && printf cached > /data/.xdrive-media/thumbnails/2026/unreferenced.jpg && chown -R 2234:3345 /data/.xdrive-media'


compose up -d server worker >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
BACKUP_PROGRESS_FILE="$TMP/backup-progress.env"
BACKUP_LOG="$TMP/backup.log"
backup_drill_stage="full-v1-backup"
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

backup_drill_stage="metadata-only-backup"
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

backup_drill_stage="corruption-and-rejection"
# Deliberately corrupt both directions: a referenced blob disappears and an
# unreferenced blob appears. Verification must reject the state.
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c   "rm -f /data/$storage_key && printf orphan > /data/orphan.bin"

# A rejected corruption probe must be a real structured missing/orphan report,
# never a spurious process failure or an empty stdout stream.
if "$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" \
    >"$TMP/corrupt-verify.json" 2>"$TMP/corrupt-verify.err"; then
  echo "verify unexpectedly accepted missing/orphan blobs" >&2
  exit 1
fi
python3 - "$TMP/corrupt-verify.json" <<'PY'
import json
import sys
try:
    with open(sys.argv[1], encoding="utf-8") as stream:
        report = json.load(stream)
except (OSError, ValueError):
    print("corrupt storage verify returned no valid JSON", file=sys.stderr)
    raise SystemExit(1)
for key in ("missing", "orphans"):
    issues = report.get(key)
    if not isinstance(issues, list) or not issues:
        print(f"corrupt storage verify lacks expected {key} issues", file=sys.stderr)
        raise SystemExit(1)
PY

# A failed backup must not dump an entire shared-reference JSON report into
# the installer log, and must retain a private full report for diagnostics.
# An expected failure must not trigger the global stage ERR trap.
if bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" \
    --output-dir "$TMP/failing-backups" --skip-file-data \
    >"$TMP/failed-backup.out" 2>"$TMP/failed-backup.err"; then
  echo "backup unexpectedly accepted missing/orphan blobs" >&2
  exit 1
fi
grep -q 'xDrive consistency verification failed; backup aborted.' "$TMP/failed-backup.err"
if ! grep -q 'actionable issue counts:' "$TMP/failed-backup.err"; then
  echo "server-backup-restore: corrupt snapshot failed without bounded issue counts" >&2
  if grep -Fq 'verifier returned no JSON report' "$TMP/failed-backup.err"; then
    echo "server-backup-restore: verifier emitted no structured report" >&2
  elif grep -Fq 'verification report could not be summarized' "$TMP/failed-backup.err"; then
    echo "server-backup-restore: verifier emitted invalid structured JSON" >&2
  elif grep -Fq 'python3 unavailable' "$TMP/failed-backup.err"; then
    echo "server-backup-restore: Python summary unavailable" >&2
  else
    echo "server-backup-restore: issue-summary failure category is unknown" >&2
  fi
  if [[ -s "$XDRIVE_HOME/logs/storage-verify-last-failed.json" ]]; then
    python3 - "$XDRIVE_HOME/logs/storage-verify-last-failed.json" <<'PY' >&2 || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        r = json.load(f)
    keys = ("missing", "size_mismatches", "orphans", "hash_mismatches")
    print("[xDrive] private verification JSON parsed; issue counts:",
          ", ".join(f"{key}={len(r.get(key) or [])}" for key in keys))
except (OSError, ValueError, AttributeError):
    print("[xDrive] private verification JSON cannot be parsed")
PY
  else
    echo "server-backup-restore: private verification JSON was not retained" >&2
  fi
  exit 1
fi
grep -q 'missing=' "$TMP/failed-backup.err"
grep -q 'orphans=' "$TMP/failed-backup.err"
[[ "$(wc -l < "$TMP/failed-backup.err")" -lt 120 ]]
test -s "$XDRIVE_HOME/logs/storage-verify-last-failed.json"
grep -q '"missing"' "$XDRIVE_HOME/logs/storage-verify-last-failed.json"
grep -q '"orphans"' "$XDRIVE_HOME/logs/storage-verify-last-failed.json"
test "$(stat -c '%a' "$XDRIVE_HOME/logs/storage-verify-last-failed.json")" = 600
assert_runtime_services

backup_drill_stage="v1-restore"
bash "$ROOT/scripts/server-restore.sh" "$backup_dir"   --config-dir "$XDRIVE_HOME"   --yes   --no-safety-backup >/dev/null
wait_server
assert_runtime_services

"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
assert_postgres_legacy_backup_restored
restored="$(docker run --rm -v "$FILES_DIR:/data":ro --entrypoint cat postgres:17-alpine "/data/$storage_key")"
[[ "$restored" == "$content" ]] || {
  echo "restored blob mismatch: $restored" >&2
  exit 1
}

if docker run --rm -v "$FILES_DIR:/data":ro --entrypoint sh postgres:17-alpine -c 'test -e /data/orphan.bin'; then
  echo "orphan survived restore" >&2
  exit 1
fi

# Exercise the actual legacy database-only restore path that is now
# reachable from the fixed Admin Host action. Preserve original file bytes and
# prove a post-snapshot SQL change is removed, without treating this as a full
# files+database recovery drill.
backup_drill_stage="v1-database-only-restore"
compose exec -T postgres psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE public.xdrive_db_only_restore_probe (marker TEXT NOT NULL); INSERT INTO public.xdrive_db_only_restore_probe VALUES ('after-snapshot');" >/dev/null
marker_path=".xdrive-media/xdrive-db-only-preserve-marker"
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c \
  "mkdir -p /data/.xdrive-media && printf preserved-by-db-only > /data/$marker_path"
before_db_only_file="$(docker run --rm -v "$FILES_DIR:/data:ro" --entrypoint cat postgres:17-alpine "/data/$storage_key")"
[[ "$before_db_only_file" == "$content" ]] || {
  echo "v1 database-only restore fixture lost source file" >&2; exit 1
}
# Keep the private restore transcript out of public CI output. A prior
# database-only Docker drill failed with only a generic message, making it
# impossible to distinguish preflight, safety backup and destructive stages.
if bash "$ROOT/scripts/server-restore.sh" "$metadata_backup_dir" \
    --config-dir "$XDRIVE_HOME" --yes --database-only \
    > "$TMP/db-only-restore.log" 2>&1; then
  :
else
  restore_rc=$?
  restore_category=unknown
  if grep -Fq 'backup directory not found:' "$TMP/db-only-restore.log"; then
    restore_category=snapshot_unavailable
  elif grep -Fq 'checksum manifest mismatch' "$TMP/db-only-restore.log"; then
    restore_category=snapshot_checksum
  elif grep -Eq 'unsupported backup format|unsafe v1 tar|snapshot contains symlink' "$TMP/db-only-restore.log"; then
    restore_category=snapshot_format
  elif grep -Fq 'PostgreSQL custom dump preflight failed' "$TMP/db-only-restore.log"; then
    restore_category=pg_toc_preflight
  elif grep -Fq 'Creating pre-restore safety backup...' "$TMP/db-only-restore.log" &&
       ! grep -Fq 'Repairing restored storage ownership...' "$TMP/db-only-restore.log"; then
    restore_category=pre_restore_safety_or_database
  elif grep -Fq 'Repairing restored storage ownership...' "$TMP/db-only-restore.log" &&
       ! grep -Fq 'Verifying restored metadata and blobs...' "$TMP/db-only-restore.log"; then
    restore_category=storage_prepare
  elif grep -Fq 'Verifying restored metadata and blobs...' "$TMP/db-only-restore.log"; then
    restore_category=post_restore_storage_verify
  elif grep -Eq 'PostgreSQL did not become ready|xDrive API did not become ready' "$TMP/db-only-restore.log"; then
    restore_category=service_readiness
  fi
  printf 'v1 database-only restore failed: category=%s rc=%d (private log withheld)\n' \
    "$restore_category" "$restore_rc" >&2
  exit 1
fi
wait_server
assert_runtime_services
db_only_probe_gone="$(compose exec -T postgres psql -U xdrive -d xdrive -qAtc \
  "SELECT to_regclass('public.xdrive_db_only_restore_probe') IS NULL" | tr -d '\r')"
[[ "$db_only_probe_gone" == t ]] || {
  echo "v1 database-only restore failed to roll back post-snapshot DB changes" >&2
  exit 1
}
after_db_only_file="$(docker run --rm -v "$FILES_DIR:/data:ro" --entrypoint cat postgres:17-alpine "/data/$storage_key")"
[[ "$after_db_only_file" == "$before_db_only_file" ]] || {
  echo "v1 database-only restore unexpectedly replaced original file bytes" >&2
  exit 1
}
preserved_marker="$(docker run --rm -v "$FILES_DIR:/data:ro" --entrypoint cat postgres:17-alpine "/data/$marker_path")"
[[ "$preserved_marker" == "preserved-by-db-only" ]] || {
  echo "v1 database-only restore unexpectedly removed excluded file marker" >&2
  exit 1
}
"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
docker run --rm -v "$FILES_DIR:/data" --entrypoint rm postgres:17-alpine \
  "/data/$marker_path" >/dev/null

# Seed a real referenced canonical immutable CAS alongside the pre-existing
# legacy data file, so the Docker E2E covers both paths.
cas_content='canonical-content-v1'
cas_size="$(printf '%s' "$cas_content" | wc -c | tr -d '[:space:]')"
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

backup_drill_stage="v2-incremental-roundtrip"
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

# Actual offline v2 restore into two independent tmpfs-only Docker processes.
# Confirm the live PostgreSQL/Worker remain running without contacting them
# during the drill; real restore later still uses its existing integration test.
backup_drill_stage="manual-host-offline-v2-tmpfs-recovery"
XD_CONFIG_DIR="$XDRIVE_HOME" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup drill "$second_incremental_backup_dir" --max-mib 256 \
  > "$TMP/isolated-host-drill.json"
python3 - "$TMP/isolated-host-drill.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
assert d["protocol"]=="xdrive-host-isolated-drill-v1",d
assert d["state"]=="success" and d["environment"]=="host_ephemeral_offline_tmpfs",d
assert d["files_restored"] is True and d["postgresql_restored"] is True,d
assert d["production_verified"] is False and d["max_mib"]==256,d
PY
assert_runtime_services
backup_drill_stage="v2-incremental-roundtrip"

repo_root="$XDRIVE_HOME/backups/incremental"
test -d "$repo_root/objects/sha256"
[[ -f "$repo_root/objects/sha256/${cas_sha:0:2}/$cas_sha" ]]
grep -Fq "$cas_sha" "$incremental_backup_dir/objects.index"
grep -Fq "$cas_sha" "$second_incremental_backup_dir/objects.index"

# A future reference-aware prune will take the EXCLUSIVE repository lease.
# Verify and destructive restore must both reject a concurrent writer BEFORE
# touching live PostgreSQL, triggering safety backup, or stopping services.
[[ -f "$repo_root/.backup.lock" && ! -L "$repo_root/.backup.lock" ]]
exec 9<"$repo_root/.backup.lock"
flock -x -n 9
if bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes --no-safety-backup \
  >"$TMP/locked-restore.log" 2>&1; then
  echo "v2 restore ignored exclusive repository lock" >&2
  exit 1
fi
grep -Fq 'v2 repository is busy with another operation' "$TMP/locked-restore.log"
if XD_CONFIG_DIR="$XDRIVE_HOME" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup verify "$incremental_backup_dir" >"$TMP/locked-verify.log" 2>&1; then
  echo "v2 verify ignored exclusive repository lock" >&2
  exit 1
fi
grep -Fq 'v2 repository is busy with another operation' "$TMP/locked-verify.log"
if XD_CONFIG_DIR="$XDRIVE_HOME" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup sources "$incremental_backup_dir" >"$TMP/locked-sources.log" 2>&1; then
  echo "v2 backup sources ignored exclusive repository lock" >&2
  exit 1
fi
grep -Fq 'v2 repository is busy with another operation' "$TMP/locked-sources.log"
assert_runtime_services
flock -u 9
exec 9<&-

# A repository lock symlink must never be followed or truncated by a new
# v2 backup, even if its target is a legitimate regular file.
mv "$repo_root/.backup.lock" "$TMP/backup-lock-held"
printf 'must not change\n' >"$TMP/lock-sentinel"
ln -s "$TMP/lock-sentinel" "$repo_root/.backup.lock"
if bash "$ROOT/scripts/server-backup.sh" --config-dir "$XDRIVE_HOME" \
  --incremental >"$TMP/symlink-lock-backup.log" 2>&1; then
  echo "v2 backup accepted symlinked repository lock" >&2
  exit 1
fi
grep -Fq 'repository lock must not be a symlink' "$TMP/symlink-lock-backup.log"
if bash "$ROOT/scripts/server-restore.sh" "$incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes --no-safety-backup \
  >"$TMP/symlink-lock-restore.log" 2>&1; then
  echo "v2 restore followed a symlinked repository lock" >&2
  exit 1
fi
grep -Fq 'missing or unsafe v2 repository lock' "$TMP/symlink-lock-restore.log"
if XD_CONFIG_DIR="$XDRIVE_HOME" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup verify "$incremental_backup_dir" >"$TMP/symlink-lock-verify.log" 2>&1; then
  echo "v2 verify followed a symlinked repository lock" >&2
  exit 1
fi
grep -Fq 'missing or unsafe v2 repository lock' "$TMP/symlink-lock-verify.log"
[[ "$(cat "$TMP/lock-sentinel")" == 'must not change' ]]
assert_runtime_services
rm "$repo_root/.backup.lock"
# FIFO opens can block indefinitely before flock. The writer must reject a
# nonregular inode without opening it, touching files, or stopping services.
mkfifo "$repo_root/.backup.lock"
if timeout 8s bash "$ROOT/scripts/server-backup.sh" \
  --config-dir "$XDRIVE_HOME" --incremental >"$TMP/fifo-lock-backup.log" 2>&1; then
  echo "v2 backup accepted FIFO repository lock" >&2
  exit 1
fi
grep -Fq 'repository lock must be a regular file' "$TMP/fifo-lock-backup.log"
assert_runtime_services
rm "$repo_root/.backup.lock"
mv "$TMP/backup-lock-held" "$repo_root/.backup.lock"
assert_runtime_services

# A valid earlier v1 database-only restore already creates a safety backup.
# Rejected v2 inputs must not create *another* backup or alter existing ones.
# Compare one bounded directory inventory before and after each refusal.
safety_before_restore=''
if [[ -d "$XDRIVE_HOME/backups/pre-restore" ]]; then
  safety_before_restore="$(find "$XDRIVE_HOME/backups/pre-restore" -mindepth 1 -maxdepth 2 \
    -printf '%P %y %s\n' | LC_ALL=C sort)"
fi
assert_no_new_safety_backup() {
  local current=''
  if [[ -d "$XDRIVE_HOME/backups/pre-restore" ]]; then
    current="$(find "$XDRIVE_HOME/backups/pre-restore" -mindepth 1 -maxdepth 2 \
      -printf '%P %y %s\n' | LC_ALL=C sort)"
  fi
  [[ "$current" == "$safety_before_restore" ]] || {
    echo "rejected restore changed pre-restore safety backup inventory" >&2
    return 1
  }
}

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
assert_no_new_safety_backup
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
assert_no_new_safety_backup
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
assert_no_new_safety_backup
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
assert_postgres_legacy_backup_restored
assert_postgres_cas_backup_restored
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

# Exercise the new MANUAL v2 prune against the real Server image and a real
# PostgreSQL backup after the first generation has already been restored.
# Merely building the Go helper does not prove the host Docker/mount/lock
# contract or that a surviving snapshot still restores its database and CAS.
backup_drill_stage="v2-manual-prune-and-retained-restore"

# An active verifier or restore reader must block exclusive pruning without
# touching live services or retiring any committed snapshot.
exec 9<"$repo_root/.backup.lock"
flock -s -n 9
if XD_CONFIG_DIR="$XDRIVE_HOME" XD_FILES_DATA_DIR="$FILES_DIR" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup prune --keep-last 1 --yes >"$TMP/locked-prune.out" 2>"$TMP/locked-prune.err"; then
  echo "manual prune ignored a shared repository reader lock" >&2
  exit 1
fi
grep -Fq 'v2 repository is busy' "$TMP/locked-prune.err"
flock -u 9
exec 9<&-
[[ -d "$incremental_backup_dir" && -d "$second_incremental_backup_dir" ]]
assert_runtime_services

# A physically present CAS object with the correct length but wrong bytes
# must also abort BEFORE deleting the older restore point.
cp "$cas_repo_object" "$TMP/prune-cas-original"
printf '%s' 'canonical-content-v2' > "$cas_repo_object"
if XD_CONFIG_DIR="$XDRIVE_HOME" XD_FILES_DATA_DIR="$FILES_DIR" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup prune --keep-last 1 --yes >"$TMP/corrupt-prune.out" 2>"$TMP/corrupt-prune.err"; then
  echo "manual prune accepted same-size corrupt repository CAS" >&2
  exit 1
fi
grep -Fq 'CAS content SHA-256 mismatch' "$TMP/corrupt-prune.err"
[[ -d "$incremental_backup_dir" && -d "$second_incremental_backup_dir" ]]
cp "$TMP/prune-cas-original" "$cas_repo_object"
assert_runtime_services

# Probe real, digest-valid, unreferenced backup CAS reclamation as well as
# preservation of the CAS object shared by the two committed generations.
prune_orphan_content='unreferenced-cas-for-manual-prune'
prune_orphan_sha="$(printf '%s' "$prune_orphan_content" | sha256sum | awk '{print $1}')"
prune_orphan_object="$repo_root/objects/sha256/${prune_orphan_sha:0:2}/$prune_orphan_sha"
mkdir -p "$(dirname "$prune_orphan_object")"
printf '%s' "$prune_orphan_content" > "$prune_orphan_object"
[[ -f "$prune_orphan_object" ]] || {
  echo "manual prune CAS orphan fixture was not created" >&2
  exit 1
}
if grep -Fq "$prune_orphan_sha" "$incremental_backup_dir/objects.index" ||
   grep -Fq "$prune_orphan_sha" "$second_incremental_backup_dir/objects.index"; then
  echo "manual prune CAS orphan fixture is unexpectedly referenced" >&2
  exit 1
fi

XD_CONFIG_DIR="$XDRIVE_HOME" XD_FILES_DATA_DIR="$FILES_DIR" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup prune --keep-last 1 --yes >"$TMP/manual-prune-report.json"
python3 - "$TMP/manual-prune-report.json" "$(basename "$incremental_backup_dir")" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)
assert result["mode"] == "manual_confirmed"
assert result["automatic"] is False
assert result["keep_last"] == 1
assert result["retired_snapshots"] == [sys.argv[2]]
assert result["deleted_cas_objects"] == 1, result
assert result["deleted_snapshot_files"] == 6, result
PY
[[ ! -e "$incremental_backup_dir" && -d "$second_incremental_backup_dir" ]]
[[ -f "$cas_repo_object" && ! -e "$prune_orphan_object" ]]
assert_runtime_services

# A second explicit prune must be safe to repeat without deleting anything.
XD_CONFIG_DIR="$XDRIVE_HOME" XD_FILES_DATA_DIR="$FILES_DIR" bash "$ROOT/scripts/xdrive-server-host.sh" \
  backup prune --keep-last 1 --yes >"$TMP/repeat-prune-report.json"
python3 - "$TMP/repeat-prune-report.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    result = json.load(source)
assert result["retired_snapshots"] == [], result
assert result["deleted_cas_objects"] == 0, result
assert result["deleted_snapshot_files"] == 0, result
PY

# Prove the only remaining generation actually restores file bytes and the
# PostgreSQL database, rather than only passing a read-only SHA preflight.
docker run --rm -v "$FILES_DIR:/data" --entrypoint sh postgres:17-alpine -c \
  "printf broken > /data/$storage_key"
bash "$ROOT/scripts/server-restore.sh" "$second_incremental_backup_dir" \
  --config-dir "$XDRIVE_HOME" --yes --no-safety-backup >/dev/null
assert_runtime_services
"$ROOT/scripts/server-verify.sh" --config-dir "$XDRIVE_HOME" >/dev/null
assert_postgres_legacy_backup_restored
assert_postgres_cas_backup_restored
prune_restored_legacy="$(docker run --rm -v "$FILES_DIR:/data:ro" \
  --entrypoint cat postgres:17-alpine "/data/$storage_key")"
prune_restored_cas="$(docker run --rm -v "$FILES_DIR:/data:ro" \
  --entrypoint cat postgres:17-alpine "/data/$cas_key")"
[[ "$prune_restored_legacy" == "$content" && "$prune_restored_cas" == "$cas_content" ]] || {
  echo "retained v2 generation failed real restore after manual prune" >&2
  exit 1
}

# Emit isolated, non-production CI restore evidence only after ALL SQL and
# physical-file assertions above have passed. No storage paths or credentials.
if [[ -n "${XD_BACKUP_DRILL_REPORT_PATH:-}" ]]; then
  python3 - "$XD_BACKUP_DRILL_REPORT_PATH" <<'PY'
import datetime, json, os, stat, sys, tempfile
path=os.path.abspath(sys.argv[1])
parent=os.path.dirname(path)
os.makedirs(parent,exist_ok=True)
if os.path.lexists(path):
    raise SystemExit("refuse existing or symlinked restore evidence")
data={
    "protocol":"xdrive-isolated-backup-restore-drill-v1",
    "environment":"ci_ephemeral_docker",
    "production_verified":False,
    "result":"passed",
    "database_rows_recovered":True,
    "postgresql_post_snapshot_probe_absent":True,
    "legacy_file_bytes_restored":True,
    "cas_sha256_file_bytes_restored":True,
    "v1_restore_tested":True,
    "v2_first_generation_restore_tested":True,
    "v2_retained_after_manual_prune_restore_tested":True,
    "ci_checkout_sha":os.environ.get("GITHUB_SHA",""),
    "ci_source_head_sha":os.environ.get("XD_CI_SOURCE_HEAD_SHA",""),
    "observed_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
fd,temporary=tempfile.mkstemp(prefix=".restore-drill-",dir=parent)
try:
    with os.fdopen(fd,"w",encoding="utf-8") as stream:
        os.fchmod(stream.fileno(),0o600)
        json.dump(data,stream,sort_keys=True,separators=(",",":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary,path)
finally:
    if os.path.exists(temporary):os.unlink(temporary)
PY
fi
echo "backup/restore integration test passed"
