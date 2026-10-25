#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "server transactional upgrade test failed (exit $status)" >&2
    for file in locked.out locked.err upgrade.out upgrade.err cas-lock.out cas-lock.err cas-real-error.out cas-real-error.err stall.out stall.err incremental-stall.out incremental-stall.err completion-tail.out completion-tail.err incremental-success.out incremental-success.err pull-fail.out pull-fail.err state/docker-calls state/server-ps-count state/backup-args state/backup-images; do
      if [[ -f "$TMP/$file" ]]; then
        echo "===== $file =====" >&2
        cat "$TMP/$file" >&2 || true
      fi
    done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/state" "$TMP/config/state" "$TMP/host-bin"

# Hold the installer lock and verify a second invocation refuses to run
# without truncating the current lock owner's PID.
exec 8>"$TMP/config/state/install.lock"
printf '424242\n' >&8
flock -n 8
set +e
PATH="/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
XD_NONINTERACTIVE=1 \
bash "$INSTALLER" --channel master >"$TMP/locked.out" 2>"$TMP/locked.err"
locked_status=$?
set -e
[[ "$locked_status" -eq 75 ]]
grep -q 'another install/update is already running' "$TMP/locked.err"
grep -q 'pid 424242' "$TMP/locked.err"
[[ "$(cat "$TMP/config/state/install.lock")" == "424242" ]]
flock -u 8
exec 8>&-

cat > "$TMP/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/sleep"

cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
out=""
write_out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) out="$2"; shift 2 ;;
    --retry|--retry-delay|--connect-timeout) shift 2 ;;
    -w|--write-out) write_out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done

emit() {
  if [[ -n "$out" ]]; then
    printf '%s' "$1" > "$out"
    [[ -n "$write_out" ]] && printf '128\t64\t2.0'
  else
    printf '%s' "$1"
  fi
}

case "$url" in
  */git/ref/tags/snapshot)
    emit '{
  "ref": "refs/tags/snapshot",
  "object": {
    "type": "commit",
    "sha": "0123456789abcdef0123456789abcdef01234567"
  }
}'
    ;;
  */releases/tags/snapshot)
    emit '{"tag_name":"snapshot"}'
    ;;
  */deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
'
    ;;
  */deploy/Caddyfile)
    emit 'new-caddy
'
    ;;
  */scripts/server-backup.sh)
    emit '#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "$*" >> "$TEST_STATE/backup-args"
printf "%s\n" "${XD_SERVER_IMAGE:-}" >> "$TEST_STATE/backup-images"
printf "%s|%s|%s|%s\n" \
  "${XD_BACKUP_PROGRESS_FILE:-}" \
  "${XD_BACKUP_PROGRESS_STAGE_CURRENT:-}" \
  "${XD_BACKUP_PROGRESS_STAGE_TOTAL:-}" \
  "${XD_BACKUP_PROGRESS_STAGE_NAME:-}" >> "$TEST_STATE/backup-progress-env"
config=""
output=""
leave=0
skip_file_data=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) config="$2"; shift 2 ;;
    --output-dir) output="$2"; shift 2 ;;
    --leave-server-stopped) leave=1; shift ;;
    --skip-file-data) skip_file_data=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$leave" == "1" ]]
if [[ "${TEST_BACKUP_LEGACY_DERIVED_FAIL:-0}" == "1" && "${XD_SERVER_IMAGE:-}" != "ghcr.io/lazyxu/xdrive-server:sha-0123456789ab" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  echo '"'"'{"orphans":[{"storage_key":".xdrive-media/thumbnails/aa/test-512.jpg","size":123}],"hash_mismatches":null}'"'"' >&2
  exit 1
fi
if [[ "${TEST_BACKUP_LEGACY_READY_FAIL:-0}" == "1" && "${XD_SERVER_IMAGE:-}" != "ghcr.io/lazyxu/xdrive-server:sha-0123456789ab" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  echo '"'"'{"orphans":[{"storage_key":".xdrive-ready-2918308328","size":0}],"hash_mismatches":null}'"'"' >&2
  exit 1
fi
if [[ "${TEST_BACKUP_LEGACY_CAS_LOCK_FAIL:-0}" == "1" && "${XD_SERVER_IMAGE:-}" != "ghcr.io/lazyxu/xdrive-server:sha-0123456789ab" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  printf "%s\n" "{\"orphans\":[{\"storage_key\":\".xdrive-cas-lifecycle-locks/ff.lock\",\"size\":0}],\"ignored_temporary_files\":34,\"ignored_derived_files\":3792,\"hash_mismatches\":null}" >&2
  exit 1
fi
if [[ -n "${TEST_BACKUP_LEGACY_WALK_DENIED_PATH:-}" && "${XD_SERVER_IMAGE:-}" != "ghcr.io/lazyxu/xdrive-server:sha-0123456789ab" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  printf "%s\n" "{\"time\":\"2026-10-25T11:51:58Z\",\"level\":\"INFO\",\"msg\":\"walk storage: open ${TEST_BACKUP_LEGACY_WALK_DENIED_PATH}: permission denied\"}" >&2
  exit 1
fi
if [[ "${TEST_BACKUP_TARGET_REAL_ORPHAN_FAIL:-0}" == "1" && "${XD_SERVER_IMAGE:-}" == "ghcr.io/lazyxu/xdrive-server:sha-0123456789ab" ]]; then
  echo "xDrive consistency verification failed; backup aborted." >&2
  printf "%s\n" "{\"orphans\":[{\"storage_key\":\"unreferenced-user-data.bin\",\"size\":8192}],\"hash_mismatches\":null}" >&2
  exit 1
fi
dir="$output/xdrive-backup-test"
mkdir -p "$dir"
touch "$dir/database.dump" "$dir/blobs.tar" "$dir/verify.json" "$dir/manifest.json" "$dir/SHA256SUMS.txt"
printf "%s\n" "$dir"
'
    ;;
  */scripts/server-restore.sh)
    emit '#!/usr/bin/env bash
set -euo pipefail
printf "%s\n" "$*" >> "$TEST_STATE/restore-args"
touch "$TEST_STATE/data-restored"
exit 0
'
    ;;
  */scripts/server-backup-scheduled.sh|*/scripts/server-verify.sh|*/scripts/server-doctor.sh|*/scripts/server-migrate-user.sh|*/scripts/server-control.sh|*/scripts/caddy-admission.py|*/scripts/caddy-env-config.py|*/scripts/xdrive-server-host.sh)
    emit '#!/usr/bin/env bash
exit 0
'
    ;;
  *)
    echo "unexpected curl URL: $url" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >> "$TEST_STATE/docker-calls"

if [[ "$1" == "info" ]]; then
  if [[ "$args" == *"--format"* ]]; then echo '[]'; fi
  exit 0
fi

if [[ "$1" == "inspect" ]]; then
  exit 1
fi

if [[ "$1" == "stop" ]]; then
  exit 0
fi

if [[ "$1" == "ps" ]]; then
  exit 0
fi

if [[ "$1" != "compose" ]]; then
  echo "unexpected docker invocation: $*" >&2
  exit 9
fi

progress_mode=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    compose) shift ;;
    --profile|--env-file|-f) shift 2 ;;
    --progress) progress_mode="$2"; shift 2 ;;
    *) break ;;
  esac
done

case "$1" in
  version)
    exit 0
    ;;
  ps)
    if [[ "$args" == *"ps -aq server"* ]]; then
      echo "old-server"
    fi
    exit 0
    ;;
  pull)
    service="${2:-all}"
    count_file="$TEST_STATE/pull-count-$service"
    count="$(cat "$count_file" 2>/dev/null || echo 0)"
    count=$((count + 1))
    printf '%s\n' "$count" > "$count_file"
    mode="${TEST_PULL_MODE:-success}"
    if [[ "$mode" == "permanent" || ( "$mode" == "transient" && "$service" == "postgres" && "$count" -lt 3 ) ]]; then
      echo "failed to copy: read tcp: connection reset by peer" >&2
      exit 1
    fi
    if [[ "$mode" == "stall-once" && "$service" == "server" && "$count" -eq 1 && "$progress_mode" == "json" ]]; then
      printf '%s\n' '{"id":"layer-a","parent_id":"Image mock","status":"working","text":"Downloading","details":"1 KiB","current":1024,"total":4096,"percent":25}'
      /usr/bin/sleep 3
      printf '%s\n' '{"id":"layer-a","parent_id":"Image mock","status":"working","text":"Downloading","details":"1 KiB","current":1024,"total":4096,"percent":25}'
      exit 0
    fi
    # Bytes replayed in later Docker processes must not count twice.
    if [[ "$mode" == "incremental-stalled" && "$service" == "server" && "$progress_mode" == "json" ]]; then
      case "$count" in
        1|2) bytes=1024 ;;
        3) bytes=2048 ;;
        4|5) bytes=3072 ;;
        *) echo "unexpected retry after a zero-increment attempt" >&2; exit 12 ;;
      esac
      printf '{"id":"layer-a","parent_id":"Image mock","status":"working","text":"Downloading","current":%s,"total":4096}\n' "$bytes"
      if [[ "$count" -eq 5 ]]; then
        printf '%s\n' '{"id":"layer-cached","parent_id":"Image mock","status":"done","text":"Already exists"}'
      fi
      /usr/bin/sleep 3
      exit 1
    fi
    # Completion without current must count only when this attempt has
    # previously observed the corresponding layer's Downloading event.
    if [[ "$mode" == "completion-tail" && "$service" == "server" && "$progress_mode" == "json" ]]; then
      case "$count" in
        1|2|3) first=1024; second=512 ;;
        4) first=4096; second=2048 ;;
        *) echo "unexpected retry after cached layer replay" >&2; exit 12 ;;
      esac
      printf '{"id":"layer-a","text":"Downloading","current":%s,"total":4096}\n' "$first"
      printf '{"id":"layer-b","text":"Downloading","current":%s,"total":2048}\n' "$second"
      if [[ "$count" -eq 3 ]]; then
        printf '%s\n' \
          '{"id":"layer-a","text":"Download complete"}' \
          '{"id":"layer-b","text":"Pull complete"}'
      elif [[ "$count" -eq 4 ]]; then
        printf '%s\n' \
          '{"id":"layer-a","text":"Pull complete"}' \
          '{"id":"layer-b","text":"Already exists"}' \
          '{"id":"cached-layer","text":"Already exists"}'
      fi
      /usr/bin/sleep 3
      exit 1
    fi
    if [[ "$mode" == "incremental-success" && "$service" == "server" && "$progress_mode" == "json" && "$count" -le 3 ]]; then
      bytes=$(( count * 1024 ))
      printf '{"id":"layer-a","parent_id":"Image mock","status":"working","text":"Downloading","current":%s,"total":4096}\n' "$bytes"
      /usr/bin/sleep 3
      exit 1
    fi
    if [[ "$progress_mode" == "json" ]]; then
      printf '%s\n' \
        '{"id":"layer-a","parent_id":"Image mock","status":"working","text":"Downloading","details":"1 KiB","current":1024,"total":4096,"percent":25}' \
        '{"id":"layer-a","parent_id":"Image mock","status":"working","text":"Downloading","details":"4 KiB","current":4096,"total":4096,"percent":100}' \
        '{"id":"layer-a","parent_id":"Image mock","status":"done","text":"Download complete","percent":100}'
    else
      echo "ff96944839b7 Downloading 3.146MB"
    fi
    exit 0
    ;;
  up)
    exit 0
    ;;
  exec)
    if [[ "$args" == *"xdrive-server healthcheck"* ]]; then
      if [[ "${TEST_HEALTH_OK:-0}" == "1" || -f "$TEST_STATE/data-restored" ]]; then
        exit 0
      fi
      exit 1
    fi
    exit 0
    ;;
  logs)
    exit 0
    ;;
  *)
    echo "unexpected compose invocation: $*" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/config/.env" <<'EOF'
POSTGRES_PASSWORD=old-password
XD_JWT_SECRET=old-jwt-secret-that-is-long-enough
XD_CONNECTOR_SECRET_ACTIVE_VERSION=2
XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold
XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-oldoldoldold
XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-oldoldoldold
XD_CADDY_BUILD_ID=test-caddy-build
XD_DOMAIN=drive.example.test
ALIYUN_ACCESS_KEY_ID=test-key
ALIYUN_ACCESS_KEY_SECRET=test-secret
XD_WEB_BIND=0.0.0.0
XD_WEB_PORT=3000
XD_HTTPS_BIND=0.0.0.0
XD_HTTPS_PORT=8443
EOF
printf 'old-compose\n' > "$TMP/config/docker-compose.yml"
printf 'old-caddy\n' > "$TMP/config/Caddyfile"
for script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/config/$script"
  chmod +x "$TMP/config/$script"
done

set +e
rm -f "$TMP/state"/pull-count-*
TEST_STATE="$TMP/state" \
TEST_PULL_MODE=transient \
TEST_HEALTH_OK=0 \
TEST_BACKUP_LEGACY_DERIVED_FAIL=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
XD_SHELL_RC_PATH="$TMP/config.bashrc" \
XD_PULL_ATTEMPTS=3 \
XD_PULL_RETRY_DELAY_SECONDS=0 \
XD_NONINTERACTIVE=1 \
XD_INSTALL_PROGRESS_FILE="$TMP/state/install-progress.env" \
bash "$INSTALLER" --channel master >"$TMP/upgrade.out" 2>"$TMP/upgrade.err"
status=$?
set -e

[[ "$status" -ne 0 ]]
test -f "$TMP/state/data-restored"
grep -q -- '--database-only' "$TMP/state/restore-args"
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/upgrade.err"
grep -q '^old-compose$' "$TMP/config/docker-compose.yml"
grep -q '^old-caddy$' "$TMP/config/Caddyfile"
grep -q '^old-compose$' "$TMP/config/config/docker-compose.yml"
grep -q '^old-caddy$' "$TMP/config/config/Caddyfile"
grep -q '^XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold$' "$TMP/config/config/.env"
grep -q '^XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold$' "$TMP/config/.env"
grep -q '^XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-oldoldoldold$' "$TMP/config/.env"
grep -q '^XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-oldoldoldold$' "$TMP/config/.env"
grep -q '^XD_CONNECTOR_SECRET_ACTIVE_VERSION=2$' "$TMP/config/.env"
grep -q '^XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb$' "$TMP/config/.env"
test ! -d "$TMP/config/state/upgrade-transaction"
[[ "$(cat "$TMP/state/pull-count-postgres")" == "3" ]]
[[ "$(cat "$TMP/state/pull-count-server")" == "1" ]]
test ! -f "$TMP/state/pull-count-web"
test ! -f "$TMP/state/pull-count-photo-face"
[[ "$(cat "$TMP/state/pull-count-caddy")" == "1" ]]
grep -q 'pull postgres attempt 3/3' "$TMP/upgrade.out"
grep -q 'pull postgres failed; retrying' "$TMP/upgrade.err"
grep -q 'pull postgres.*1.0 KiB / 4.0 KiB (25%)' "$TMP/upgrade.out"
grep -q 'pull postgres.*4.0 KiB / 4.0 KiB (100%)' "$TMP/upgrade.out"
test -x "$TMP/config/bin/xdrive-server"
test -x "$TMP/config/bin/server-doctor.sh"
grep -q '# >>> xDrive server PATH >>>' "$TMP/config.bashrc"
test ! -e "$TMP/host-bin/xdrive-server"
grep -q 'rollback: retaining host manager and doctor for retry/recovery' "$TMP/upgrade.err"
if grep -q -- '--compat-verify-image' "$TMP/state/backup-args"; then
  echo "installer must keep the pre-upgrade backup CLI compatible with older server-backup.sh versions" >&2
  exit 1
fi
[[ "$(wc -l < "$TMP/state/backup-images")" -ge 2 ]]
grep -q '^ghcr.io/lazyxu/xdrive-server:sha-0123456789ab$' "$TMP/state/backup-images"
grep -Fq "$TMP/state/install-progress.env|5|9|创建升级前备份" "$TMP/state/backup-progress-env"
grep -q 'current deployment verifier rejected derived media cache; retrying the pre-upgrade backup with target verifier' "$TMP/upgrade.err"
grep -q 'target verifier accepted the snapshot; continuing pre-upgrade backup' "$TMP/upgrade.err"
if grep -q 'storage consistency verification failed' "$TMP/upgrade.err"; then
  echo "test fixture unexpectedly contains the obsolete installer match phrase" >&2
  exit 1
fi

# A stale root-level .xdrive-ready-* probe comes from Local.Ready() and can be
# left behind by a hard process/container stop. An old verifier reports it as
# an orphan, so the installer must bootstrap through the target verifier
# without asking the operator to delete storage files manually.
cp -a "$TMP/config" "$TMP/ready-config"
mkdir -p "$TMP/ready-state"
set +e
TEST_STATE="$TMP/ready-state" \
TEST_BACKUP_LEGACY_READY_FAIL=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/ready-config" \
XD_SHELL_RC_PATH="$TMP/ready-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" --channel master >"$TMP/ready.out" 2>"$TMP/ready.err"
ready_status=$?
set -e
[[ "$ready_status" -eq 0 ]]
grep -q 'current deployment verifier rejected storage readiness probe; retrying the pre-upgrade backup with target verifier' "$TMP/ready.err"
grep -q 'target verifier accepted the snapshot; continuing pre-upgrade backup' "$TMP/ready.err"
grep -q '^ghcr.io/lazyxu/xdrive-server:sha-0123456789ab$' "$TMP/ready-state/backup-images"

# Legacy verifier incorrectly reports permanent 00..ff.lock shard files
# as orphans. The target must independently verify the same snapshot.
cp -a "$TMP/config" "$TMP/cas-lock-config"
mkdir -p "$TMP/cas-lock-state"
set +e
TEST_STATE="$TMP/cas-lock-state" \
TEST_BACKUP_LEGACY_CAS_LOCK_FAIL=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/cas-lock-config" \
XD_SHELL_RC_PATH="$TMP/cas-lock-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" --channel master >"$TMP/cas-lock.out" 2>"$TMP/cas-lock.err"
cas_lock_status=$?
set -e
[[ "$cas_lock_status" -eq 0 ]]
grep -q 'current deployment verifier rejected CAS lifecycle shard locks; retrying the pre-upgrade backup with target verifier' "$TMP/cas-lock.err"
grep -q 'target verifier accepted the snapshot; continuing pre-upgrade backup' "$TMP/cas-lock.err"
grep -q '^ghcr.io/lazyxu/xdrive-server:sha-0123456789ab$' "$TMP/cas-lock-state/backup-images"
if grep -q -- '--allow-inconsistent' "$TMP/cas-lock-state/backup-args"; then
  echo "CAS lock compatibility retry must not bypass storage verification" >&2
  exit 1
fi

# A real orphan found by the target must still abort and roll back even
# when the legacy report contained a recognizable CAS shard lock.
cp -a "$TMP/config" "$TMP/cas-real-error-config"
mkdir -p "$TMP/cas-real-error-state"
set +e
TEST_STATE="$TMP/cas-real-error-state" \
TEST_BACKUP_LEGACY_CAS_LOCK_FAIL=1 \
TEST_BACKUP_TARGET_REAL_ORPHAN_FAIL=1 \
TEST_HEALTH_OK=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/cas-real-error-config" \
XD_SHELL_RC_PATH="$TMP/cas-real-error-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" --channel master >"$TMP/cas-real-error.out" 2>"$TMP/cas-real-error.err"
cas_real_error_status=$?
set -e
[[ "$cas_real_error_status" -ne 0 ]]
grep -q 'current deployment verifier rejected CAS lifecycle shard locks' "$TMP/cas-real-error.err"
grep -q 'xDrive pre-upgrade backup failed; automatic rollback will reopen the previous deployment' "$TMP/cas-real-error.err"
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/cas-real-error.err"
if grep -q 'target verifier accepted the snapshot' "$TMP/cas-real-error.err"; then
  echo "genuine storage orphan bypassed by CAS compatibility check" >&2
  exit 1
fi

# A legacy backup may fail before emitting a JSON report, while walking an
# inaccessible .xdrive-media subtree. Retry only that exact cache tree with
# the published target verifier; never generalize to other directories.
for scenario in cache-root cache-nested cache-lookalike canonical-cas cache-target-orphan; do
  case "$scenario" in
    cache-root) denied="/data/.xdrive-media"; retry=1; pass=1; target_orphan=0 ;;
    cache-nested) denied="/data/.xdrive-media/thumbnails/aa"; retry=1; pass=1; target_orphan=0 ;;
    cache-lookalike) denied="/data/.xdrive-media-copy"; retry=0; pass=0; target_orphan=0 ;;
    canonical-cas) denied="/data/.xdrive-blobs/sha256"; retry=0; pass=0; target_orphan=0 ;;
    cache-target-orphan) denied="/data/.xdrive-media"; retry=1; pass=0; target_orphan=1 ;;
  esac
  case_config="$TMP/$scenario-config"
  case_state="$TMP/$scenario-state"
  cp -a "$TMP/config" "$case_config"
  mkdir -p "$case_state"
  set +e
  TEST_STATE="$case_state" \
  TEST_BACKUP_LEGACY_WALK_DENIED_PATH="$denied" \
  TEST_BACKUP_TARGET_REAL_ORPHAN_FAIL="$target_orphan" \
  TEST_HEALTH_OK=1 \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_CONFIG_DIR="$case_config" \
  XD_SHELL_RC_PATH="$TMP/$scenario.bashrc" \
  XD_NONINTERACTIVE=1 \
  XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" --channel master >"$TMP/$scenario.out" 2>"$TMP/$scenario.err"
  walk_status=$?
  set -e

  if [[ "$retry" == 1 ]]; then
    [[ "$(wc -l < "$case_state/backup-images")" -eq 2 ]]
    grep -q '^ghcr.io/lazyxu/xdrive-server:sha-0123456789ab$' "$case_state/backup-images"
    grep -q 'current deployment verifier rejected unreadable derived media cache directory' "$TMP/$scenario.err"
  else
    [[ "$(wc -l < "$case_state/backup-images")" -eq 1 ]]
    if grep -q '^ghcr.io/lazyxu/xdrive-server:sha-0123456789ab$' "$case_state/backup-images"; then
      echo "non-cache $denied incorrectly authorized target-verifier retry" >&2
      exit 1
    fi
  fi
  if [[ "$pass" == 1 ]]; then
    [[ "$walk_status" -eq 0 ]]
    grep -q 'target verifier accepted the snapshot; continuing pre-upgrade backup' "$TMP/$scenario.err"
  else
    [[ "$walk_status" -ne 0 ]]
    grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/$scenario.err"
    if grep -q 'target verifier accepted the snapshot' "$TMP/$scenario.err"; then
      echo "target verifier bypassed real failure for $denied" >&2
      exit 1
    fi
  fi
  if grep -q -- '--allow-inconsistent' "$case_state/backup-args"; then
    echo "cache traversal retry must never use --allow-inconsistent" >&2
    exit 1
  fi
done

grep -q 'detailed Docker output is captured' "$TMP/upgrade.out"
if grep -q '"current":1024' "$TMP/upgrade.out" || grep -q '"current":1024' "$TMP/upgrade.err"; then
  echo "raw Docker JSON progress leaked into user output" >&2
  exit 1
fi

# A pull that stops advancing must be aborted and retried instead of printing
# 0 B/s forever. Completed Docker layers are reused by the next attempt.
# Run this on an isolated deployment copy so a successful watchdog recovery
# cannot mutate the rollback fixture used by the following failure scenario.
cp -a "$TMP/config" "$TMP/stall-config"
mkdir -p "$TMP/stall-state" "$TMP/stall-host-bin"
sed -i 's/^XD_DOMAIN=.*/XD_DOMAIN=/' "$TMP/stall-config/.env" "$TMP/stall-config/config/.env"
set +e
TEST_STATE="$TMP/stall-state" \
TEST_PULL_MODE=stall-once \
TEST_HEALTH_OK=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/stall-config" \
XD_SHELL_RC_PATH="$TMP/stall-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_PULL_ATTEMPTS=3 \
XD_PULL_RETRY_DELAY_SECONDS=0 \
XD_PULL_STALL_TIMEOUT_SECONDS=2 \
XD_PULL_STALL_LOG_INTERVAL_SECONDS=1 \
bash "$INSTALLER" --channel master >"$TMP/stall.out" 2>"$TMP/stall.err"
stall_status=$?
set -e
[[ "$stall_status" -eq 0 ]]
[[ "$(cat "$TMP/stall-state/pull-count-server")" == "2" ]]
grep -q 'pull server stalled' "$TMP/stall.err"
grep -q 'attempt 1 stalled; retry will reuse completed Docker layers' "$TMP/stall.err"
grep -q 'pull server attempt 2/3' "$TMP/stall.out"
grep -q 'pull server complete.' "$TMP/stall.out"

# Continue after the minimum while the same Docker layer advances. Attempt 2
# and attempt 5 replay cached bytes; after attempt 5 it must stop/roll back.
cp -a "$TMP/config" "$TMP/incremental-stall-config"
mkdir -p "$TMP/incremental-stall-state" "$TMP/incremental-stall-host-bin"
sed -i 's/^XD_DOMAIN=.*/XD_DOMAIN=/' "$TMP/incremental-stall-config/.env" "$TMP/incremental-stall-config/config/.env"
set +e
TEST_STATE="$TMP/incremental-stall-state" \
TEST_PULL_MODE=incremental-stalled \
TEST_HEALTH_OK=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/incremental-stall-config" \
XD_HOST_BIN_DIR="$TMP/incremental-stall-host-bin" \
XD_SHELL_RC_PATH="$TMP/incremental-stall-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_PULL_ATTEMPTS=3 \
XD_PULL_RETRY_DELAY_SECONDS=0 \
XD_PULL_STALL_TIMEOUT_SECONDS=2 \
XD_PULL_STALL_LOG_INTERVAL_SECONDS=1 \
bash "$INSTALLER" --channel master >"$TMP/incremental-stall.out" 2>"$TMP/incremental-stall.err"
incremental_stall_status=$?
set -e
[[ "$incremental_stall_status" -ne 0 ]]
[[ "$(cat "$TMP/incremental-stall-state/pull-count-server")" == "5" ]]
grep -q 'pull server attempt 4 (extended beyond 3 minimum attempts)' "$TMP/incremental-stall.out"
grep -q 'pull server attempt 5 (extended beyond 3 minimum attempts)' "$TMP/incremental-stall.out"
grep -q 'attempt 5 made no new download bytes' "$TMP/incremental-stall.err"
grep -q 'pull server failed after 5 attempts' "$TMP/incremental-stall.err"
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/incremental-stall.err"

# The third attempt has only replayed numeric snapshots, but completes two
# previously downloading layers without emitting current=total. It must
# unlock attempt 4; attempt 4 only replays cache and must stop/roll back.
cp -a "$TMP/config" "$TMP/completion-tail-config"
mkdir -p "$TMP/completion-tail-state" "$TMP/completion-tail-host-bin"
sed -i 's/^XD_DOMAIN=.*/XD_DOMAIN=/' "$TMP/completion-tail-config/.env" "$TMP/completion-tail-config/config/.env"
set +e
TEST_STATE="$TMP/completion-tail-state" \
TEST_PULL_MODE=completion-tail \
TEST_HEALTH_OK=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/completion-tail-config" \
XD_HOST_BIN_DIR="$TMP/completion-tail-host-bin" \
XD_SHELL_RC_PATH="$TMP/completion-tail-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_PULL_ATTEMPTS=3 \
XD_PULL_RETRY_DELAY_SECONDS=0 \
XD_PULL_STALL_TIMEOUT_SECONDS=2 \
XD_PULL_STALL_LOG_INTERVAL_SECONDS=1 \
bash "$INSTALLER" --channel master >"$TMP/completion-tail.out" 2>"$TMP/completion-tail.err"
completion_tail_status=$?
set -e
[[ "$completion_tail_status" -ne 0 ]]
[[ "$(cat "$TMP/completion-tail-state/pull-count-server")" == "4" ]]
grep -q 'attempt 3 advanced new download bytes' "$TMP/completion-tail.err"
grep -q 'attempt 4 made no new download bytes' "$TMP/completion-tail.err"
grep -q 'pull server failed after 4 attempts' "$TMP/completion-tail.err"
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/completion-tail.err"

# A genuinely productive third attempt permits a successful fourth attempt.
cp -a "$TMP/config" "$TMP/incremental-success-config"
mkdir -p "$TMP/incremental-success-state" "$TMP/incremental-success-host-bin"
sed -i 's/^XD_DOMAIN=.*/XD_DOMAIN=/' "$TMP/incremental-success-config/.env" "$TMP/incremental-success-config/config/.env"
set +e
TEST_STATE="$TMP/incremental-success-state" \
TEST_PULL_MODE=incremental-success \
TEST_HEALTH_OK=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/incremental-success-config" \
XD_HOST_BIN_DIR="$TMP/incremental-success-host-bin" \
XD_SHELL_RC_PATH="$TMP/incremental-success-config.bashrc" \
XD_NONINTERACTIVE=1 \
XD_PULL_ATTEMPTS=3 \
XD_PULL_RETRY_DELAY_SECONDS=0 \
XD_PULL_STALL_TIMEOUT_SECONDS=2 \
XD_PULL_STALL_LOG_INTERVAL_SECONDS=1 \
bash "$INSTALLER" --channel master >"$TMP/incremental-success.out" 2>"$TMP/incremental-success.err"
incremental_success_status=$?
set -e
[[ "$incremental_success_status" -eq 0 ]]
[[ "$(cat "$TMP/incremental-success-state/pull-count-server")" == "4" ]]
grep -q 'pull server attempt 4 (extended beyond 3 minimum attempts)' "$TMP/incremental-success.out"
grep -q 'pull server complete.' "$TMP/incremental-success.out"

# Reproduce the production failure point: all image-pull attempts fail before
# any new application container or migration is started. Rollback must restore
# the old deployment without a database restore and must keep the host manager
# available for another xdrive-server update.
rm -f "$TMP/state"/pull-count-* "$TMP/state/data-restored"
set +e
TEST_STATE="$TMP/state" \
TEST_PULL_MODE=permanent \
TEST_HEALTH_OK=1 \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
XD_SHELL_RC_PATH="$TMP/config.bashrc" \
XD_PULL_ATTEMPTS=3 \
XD_PULL_RETRY_DELAY_SECONDS=0 \
XD_NONINTERACTIVE=1 \
bash "$INSTALLER" --channel master >"$TMP/pull-fail.out" 2>"$TMP/pull-fail.err"
pull_fail_status=$?
set -e

[[ "$pull_fail_status" -ne 0 ]]
[[ "$(cat "$TMP/state/pull-count-postgres")" == "3" ]]
test ! -f "$TMP/state/pull-count-server"
test ! -f "$TMP/state/pull-count-web"
test ! -f "$TMP/state/pull-count-photo-face"
grep -q 'pull postgres failed after 3 attempts' "$TMP/pull-fail.err"
grep -q 'database restore not required for this failure point' "$TMP/pull-fail.err"
grep -q 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/pull-fail.err"
test ! -f "$TMP/state/data-restored"
grep -q '^old-compose$' "$TMP/config/docker-compose.yml"
grep -q '^XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold$' "$TMP/config/.env"
grep -q '^old-compose$' "$TMP/config/config/docker-compose.yml"
grep -q '^XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-oldoldoldold$' "$TMP/config/config/.env"
grep -q '^XD_CONNECTOR_SECRET_ACTIVE_VERSION=2$' "$TMP/config/.env"
grep -q '^XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb$' "$TMP/config/.env"
test -x "$TMP/config/bin/xdrive-server"
test -x "$TMP/config/bin/server-doctor.sh"
grep -q '# >>> xDrive server PATH >>>' "$TMP/config.bashrc"
test ! -e "$TMP/host-bin/xdrive-server"
grep -q 'rollback: retaining host manager and doctor for retry/recovery' "$TMP/pull-fail.err"

echo "server transactional upgrade tests passed"
