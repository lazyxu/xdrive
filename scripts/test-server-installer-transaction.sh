#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"

cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "server transactional upgrade test failed (exit $status)" >&2
    for file in locked.out locked.err upgrade.out upgrade.err stall.out stall.err pull-fail.out pull-fail.err state/docker-calls state/server-ps-count state/backup-args state/backup-images; do
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
  */scripts/server-backup-scheduled.sh|*/scripts/server-verify.sh|*/scripts/server-doctor.sh|*/scripts/server-migrate-user.sh|*/scripts/server-control.sh|*/scripts/xdrive-server-host.sh)
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
