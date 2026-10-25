#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATOR="$ROOT/scripts/server-migrate-user.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TEST_CURRENT_CASE=""
report_failure() {
  local status=$? line="$1"
  trap - ERR
  set +e
  echo "server migration fixture failed: case=${TEST_CURRENT_CASE:-none} line=$line status=$status" >&2
  if [[ -n "$TEST_CURRENT_CASE" ]]; then
    local dir="$TMP/$TEST_CURRENT_CASE"
    for file in migrate.out migrate.err; do
      if [[ -f "$dir/$file" ]]; then
        echo "--- $file ---" >&2
        tail -n 40 "$dir/$file" >&2
      fi
    done
  fi
  exit "$status"
}
trap 'report_failure "$LINENO"' ERR

mkdir -p "$TMP/bin"

cat > "$TMP/bin/getent" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "group" && "$2" == "docker" ]]; then
  [[ "${TEST_GROUP_PRESENT:-1}" == "1" ]] || exit 2
  echo 'docker:x:998:'
  exit 0
fi
[[ "$1" == "passwd" && "$2" == "alice" ]]
printf 'alice:x:1001:1001::%s:/bin/bash\n' "$TEST_TARGET_LOGIN_HOME"
SH
chmod +x "$TMP/bin/getent"

cat > "$TMP/bin/id" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "-u alice"|"-g alice") echo 1001 ;;
  "-nG alice")
    if [[ "${TEST_GROUP_ALREADY_MEMBER:-0}" == "1" || -f "${TEST_STATE:-/nonexistent}/docker-group-granted" ]]; then
      echo 'alice docker'
    else
      echo 'alice'
    fi
    ;;
  "-u") echo 0 ;;
  *) /usr/bin/id "$@" ;;
esac
SH
chmod +x "$TMP/bin/id"

cat > "$TMP/bin/runuser" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "-u" && "$2" == "alice" && "$3" == "--" ]]
printf '%s\n' "$*" >> "$TEST_STATE/runuser-calls"
shift 3
exec "$@"
SH
chmod +x "$TMP/bin/runuser"

cat > "$TMP/bin/chown" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/chown"

# Slow/failing copies are simulated without changing the real fixture files.
cat > "$TMP/bin/cp" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for argument in "$@"; do
  if [[ "${TEST_COPY_FAIL_ON_BACKUPS:-0}" == "1" &&
        "$argument" == "${XD_SOURCE_CONFIG_DIR:-}/backups/"* ]]; then
    echo "simulated backup archive copy error" >&2
    exit 74
  fi
  if [[ "$argument" == "${XD_SOURCE_CONFIG_DIR:-}/." ]]; then
    if [[ "${TEST_COPY_DELAY_SECS:-0}" != "0" ]]; then
      sleep "$TEST_COPY_DELAY_SECS"
    fi
    if [[ "${TEST_COPY_FAIL:-0}" == "1" ]]; then
      exit 74
    fi
    break
  fi
done
exec /bin/cp "$@"
SH
chmod +x "$TMP/bin/cp"

cat > "$TMP/bin/stat" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "-Lc %g /var/run/docker.sock" ]]; then
  echo "${TEST_DOCKER_SOCKET_GID:-998}"
else
  /usr/bin/stat "$@"
fi
SH
chmod +x "$TMP/bin/stat"

cat > "$TMP/bin/usermod" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/usermod-calls"
[[ "$#" -eq 3 && "$1" == "-aG" && "$2" == "docker" && "$3" == "alice" ]]
[[ "${TEST_USERMOD_FAIL:-0}" != "1" ]] || exit 1
touch "$TEST_STATE/docker-group-granted"
SH
chmod +x "$TMP/bin/usermod"

# Sbin-only administrative tools and alternatives are isolated to the fixture:
# tests must never execute the real host's usermod/gpasswd/adduser.
mkdir -p "$TMP/admin-sbin"
cp "$TMP/bin/usermod" "$TMP/admin-sbin/usermod"
cp "$TMP/bin/runuser" "$TMP/admin-sbin/runuser"

cat > "$TMP/admin-sbin/gpasswd" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/gpasswd-calls"
[[ "$#" -eq 3 && "$1" == "-a" && "$2" == "alice" && "$3" == "docker" ]]
touch "$TEST_STATE/docker-group-granted"
SH
chmod +x "$TMP/admin-sbin/gpasswd"

cat > "$TMP/admin-sbin/adduser" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/adduser-calls"
[[ "$#" -eq 2 && "$1" == "alice" && "$2" == "docker" ]]
touch "$TEST_STATE/docker-group-granted"
SH
chmod +x "$TMP/admin-sbin/adduser"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/docker-calls"
printf 'user=%s host=%s context=%s config=%s tls=%s cert=%s api=%s args=%s\n' \
  "${USER:-}" "${DOCKER_HOST:-}" "${DOCKER_CONTEXT:-}" "${DOCKER_CONFIG:-}" \
  "${DOCKER_TLS_VERIFY:-}" "${DOCKER_CERT_PATH:-}" "${DOCKER_API_VERSION:-}" "$*" \
  >> "$TEST_STATE/docker-env-calls"

if [[ "${USER:-}" != "alice" && "${1:-}" == "--host" ]]; then
  [[ "${2:-}" == "unix:///var/run/docker.sock" && "${3:-}" == "info" ]] || exit 93
  [[ "${TEST_SYSTEM_DOCKER_AVAILABLE:-1}" == "1" ]] || exit 1
  if [[ "$*" == *"--format"* ]]; then echo '[]'; fi
  exit 0
fi

if [[ "${USER:-}" == "alice" ]]; then
  if [[ -n "${DOCKER_CONTEXT:-}" || -n "${DOCKER_CONFIG:-}" || -n "${DOCKER_TLS_VERIFY:-}" || \
        -n "${DOCKER_CERT_PATH:-}" || -n "${DOCKER_API_VERSION:-}" || \
        "${DOCKER_HOST:-}" == "unix:///root/docker.sock" ]]; then
    echo "root Docker environment leaked into target-user probe" >&2
    exit 91
  fi

  case "${TEST_TARGET_DOCKER_MODE:-rootful}" in
    rootful)
      # The target user's clean default Docker context is usable.
      [[ -z "${DOCKER_HOST:-}" ]] || exit 1
      ;;
    rootless)
      # Simulate a user whose daemon is reachable only at the conventional
      # rootless socket, so migration must discover the fallback explicitly.
      [[ "${DOCKER_HOST:-}" == "unix:///run/user/1001/docker.sock" ]] || exit 1
      ;;
    needs-group)
      [[ -f "$TEST_STATE/docker-group-granted" ]] || exit 1
      [[ -z "${DOCKER_HOST:-}" || "${DOCKER_HOST:-}" == "unix:///var/run/docker.sock" ]] || exit 1
      [[ "${TEST_POST_GRANT_DOCKER_FAIL:-0}" == "0" ]] || exit 1
      ;;
    unavailable)
      exit 1
      ;;
    *)
      exit 92
      ;;
  esac
fi

if [[ "$1" == "info" ]]; then
  if [[ "$*" == *"--format"* && "${USER:-}" == "alice" && "${TEST_TARGET_DOCKER_MODE:-rootful}" == "rootless" ]]; then
    echo '["name=rootless"]'
  else
    echo '[]'
  fi
  exit 0
fi
if [[ "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  if [[ "${USER:-}" == "alice" && "$*" == *" run -T --rm --no-deps storage-init"* && "${TEST_STORAGE_INIT_FAIL:-0}" == "1" ]]; then
    echo "fixture: copied storage initialization failed" >&2
    exit 81
  fi
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/bin/crontab" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
key="${USER:-root}"
file="$TEST_STATE/crontab-$key"
if [[ "${1:-}" == "-l" ]]; then
  cat "$file" 2>/dev/null || true
  exit 0
fi
cp "$1" "$file"
SH
chmod +x "$TMP/bin/crontab"

prepare_case() {
  local name="$1"
  local base="$TMP/$name"
  mkdir -p "$base/state" "$base/source/config" "$base/source/bin" \
    "$base/source/data/files" "$base/source/data/postgres" "$base/source/data/caddy/data" \
    "$base/source/data/caddy/config" "$base/source/backups/snapshots" "$base/source/logs" \
    "$base/source/state" "$base/alice-home" \
    "$base/source/backups/snapshots/older" \
    "$base/source/backups/snapshots/older-second" \
    "$base/source/backups/pre-upgrade/pre-update"

  printf 'original-history\n' > "$base/source/backups/snapshots/older/blobs.tar"
  printf 'second-original-history\n' > "$base/source/backups/snapshots/older-second/blobs.tar"
  printf 'pre-upgrade-history\n' > "$base/source/backups/pre-upgrade/pre-update/database.dump"

  cat > "$base/source/config/.env" <<EOF
XD_FILES_DATA_DIR=$base/source/data/files
XD_POSTGRES_DATA_DIR=$base/source/data/postgres
XD_CADDY_DATA_DIR=$base/source/data/caddy/data
XD_CADDY_CONFIG_DIR=$base/source/data/caddy/config
XD_CADDY_ASSET_DIR=$base/source/data/caddy/assets
XD_GEONAMES_HOST_DIR=$base/source/data/geonames
XD_MEDIA_WORKER_RUNTIME_DIR=$base/source/state/media-worker
XD_PHOTO_FACE_RUNTIME_DIR=$base/source/state/photo-face
XD_DOCKER_MODE=rootful
XD_BACKUP_SCHEDULE=17 3 * * *
EOF
  printf 'name: xdrive\nservices: {}\n' > "$base/source/config/docker-compose.yml"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$base/source/bin/xdrive-server"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$base/source/bin/server-backup-scheduled.sh"
  chmod +x "$base/source/bin/xdrive-server" "$base/source/bin/server-backup-scheduled.sh"
  printf 'payload\n' > "$base/source/data/files/file.bin"

  cat > "$base/state/crontab-root" <<EOF
17 3 * * * XD_CONFIG_DIR=$base/source $base/source/bin/server-backup-scheduled.sh # xdrive-managed-backup
5 4 * * * echo keep-root-entry
EOF
}

invoke_case() {
  local name="$1" mode="$2"
  shift 2
  TEST_CURRENT_CASE="$name"
  echo "[migration fixture] $name: $mode $*"
  local base="$TMP/$name"

  TEST_STATE="$base/state" \
  TEST_TARGET_LOGIN_HOME="$base/alice-home" \
  TEST_TARGET_DOCKER_MODE="$mode" \
  USER=root \
  DOCKER_HOST=unix:///root/docker.sock \
  DOCKER_CONTEXT=root-only \
  DOCKER_CONFIG=/root/.docker \
  DOCKER_TLS_VERIFY=1 \
  DOCKER_CERT_PATH=/root/docker-certs \
  DOCKER_API_VERSION=1.24 \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_SOURCE_CONFIG_DIR="$base/source" \
  XD_TARGET_CONFIG_DIR="$base/target" \
  XD_TARGET_SHELL_RC="$base/alice.bashrc" \
  XD_MIGRATE_TEST_ALLOW_NONROOT=1 \
  XD_MIGRATE_TEST_ADMIN_DIR="${TEST_ADMIN_DIR:-}" \
  XD_MIGRATE_TEST_COPY_PROGRESS_INTERVAL="${TEST_COPY_PROGRESS_INTERVAL:-}" \
  TEST_COPY_DELAY_SECS="${TEST_COPY_DELAY_SECS:-0}" \
  TEST_COPY_FAIL="${TEST_COPY_FAIL:-0}" \
  TEST_COPY_FAIL_ON_BACKUPS="${TEST_COPY_FAIL_ON_BACKUPS:-0}" \
  TEST_STORAGE_INIT_FAIL="${TEST_STORAGE_INIT_FAIL:-0}" \
  bash "$MIGRATOR" alice "$@" >"$base/migrate.out" 2>"$base/migrate.err"
}

run_case() {
  local name="$1" mode="$2"
  shift 2
  local base="$TMP/$name"
  prepare_case "$name"
  invoke_case "$name" "$mode" "$@"

  test -f "$base/source/data/files/file.bin"
  test -f "$base/target/data/files/file.bin"
  test -x "$base/target/bin/xdrive-server"
  test -f "$base/target/state/migrated-from-root"
  grep -q 'copy complete: 100%' "$base/migrate.out"

  local deferred=0 option
  for option in "$@"; do
    [[ "$option" == "--defer-backups" ]] && deferred=1
  done
  if (( deferred )); then
    test -f "$base/target/state/migration-backups-pending"
    test -d "$base/target/backups"
    test ! -e "$base/target/backups/snapshots/older/blobs.tar"
    grep -Fq 'Historical backup archives were deferred' "$base/migrate.out"
    if grep -Fq 'rm -rf --' "$base/migrate.out"; then
      echo "$name: unsafe root-history deletion suggestion despite deferred backups" >&2
      exit 1
    fi
  else
    test ! -e "$base/target/state/migration-backups-pending"
    cmp "$base/source/backups/snapshots/older/blobs.tar" \
        "$base/target/backups/snapshots/older/blobs.tar"
    cmp "$base/source/backups/pre-upgrade/pre-update/database.dump" \
        "$base/target/backups/pre-upgrade/pre-update/database.dump"
  fi

  grep -q "^XD_FILES_DATA_DIR=$base/target/data/files$" "$base/target/config/.env"
  grep -q "^XD_POSTGRES_DATA_DIR=$base/target/data/postgres$" "$base/target/config/.env"
  grep -q "^XD_CADDY_DATA_DIR=$base/target/data/caddy/data$" "$base/target/config/.env"
  grep -q "^XD_CADDY_CONFIG_DIR=$base/target/data/caddy/config$" "$base/target/config/.env"
  grep -Fqx "XD_CADDY_ASSET_DIR=$base/target/data/caddy/assets" "$base/target/config/.env"
  grep -Fqx "XD_GEONAMES_HOST_DIR=$base/target/data/geonames" "$base/target/config/.env"
  grep -Fqx "XD_MEDIA_WORKER_RUNTIME_DIR=$base/target/state/media-worker" "$base/target/config/.env"
  grep -Fqx "XD_PHOTO_FACE_RUNTIME_DIR=$base/target/state/photo-face" "$base/target/config/.env"
  local expected_docker_mode="$mode"
  [[ "$expected_docker_mode" == "needs-group" ]] && expected_docker_mode="rootful"
  grep -q "^XD_DOCKER_MODE=$expected_docker_mode$" "$base/target/config/.env"

  grep -q '# >>> xDrive server PATH >>>' "$base/alice.bashrc"
  grep -Fq "$base/target/bin" "$base/alice.bashrc"
  grep -q "source $base/alice.bashrc" "$base/migrate.out"

  grep -q -- "--env-file $base/source/config/.env -f $base/source/config/docker-compose.yml down --remove-orphans" "$base/state/docker-calls"
  grep -q -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml up -d --remove-orphans" "$base/state/docker-calls"
  grep -q -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml run -T --rm --no-deps storage-init" "$base/state/docker-calls"
  grep -q -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml exec -T server xdrive-server healthcheck" "$base/state/docker-calls"
  # Storage initialization must use target-user Docker and the *copied*
  # config/mount, and must finish before a target Server can start.
  local init_at up_at
  init_at="$(grep -nF -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml run -T --rm --no-deps storage-init" "$base/state/docker-calls" | head -n1 | cut -d: -f1)"
  up_at="$(grep -nF -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml up -d --remove-orphans" "$base/state/docker-calls" | head -n1 | cut -d: -f1)"
  [[ -n "$init_at" && -n "$up_at" ]] && (( init_at < up_at ))
  grep -Fq "user=alice " "$base/state/docker-env-calls"

  if grep -q 'user=alice .*context=root-only' "$base/state/docker-env-calls" || \
     grep -q 'user=alice .*config=/root/.docker' "$base/state/docker-env-calls" || \
     grep -q 'user=alice .*host=unix:///root/docker.sock' "$base/state/docker-env-calls" || \
     grep -q 'user=alice .*tls=1' "$base/state/docker-env-calls" || \
     grep -q 'user=alice .*cert=/root/docker-certs' "$base/state/docker-env-calls" || \
     grep -q 'user=alice .*api=1.24' "$base/state/docker-env-calls"; then
    echo "$name: root Docker connection environment leaked into target-user Docker calls" >&2
    exit 1
  fi

  grep -q 'keep-root-entry' "$base/state/crontab-root"
  if grep -q 'xdrive-managed-backup' "$base/state/crontab-root"; then
    echo "$name: root managed backup schedule survived migration" >&2
    exit 1
  fi
  grep -q "XD_CONFIG_DIR=$base/target" "$base/state/crontab-alice"
  grep -q "$base/target/bin/server-backup-scheduled.sh" "$base/state/crontab-alice"

  if [[ "$mode" == "needs-group" ]]; then
    case "${TEST_EXPECT_GROUP_TOOL:-usermod}" in
      usermod)
        grep -Fxq -- '-aG docker alice' "$base/state/usermod-calls"
        test ! -e "$base/state/gpasswd-calls"
        test ! -e "$base/state/adduser-calls"
        ;;
      gpasswd)
        grep -Fxq -- '-a alice docker' "$base/state/gpasswd-calls"
        test ! -e "$base/state/usermod-calls"
        test ! -e "$base/state/adduser-calls"
        ;;
      adduser)
        grep -Fxq -- 'alice docker' "$base/state/adduser-calls"
        test ! -e "$base/state/usermod-calls"
        test ! -e "$base/state/gpasswd-calls"
        ;;
      *) echo "unexpected group tool" >&2; exit 1 ;;
    esac
    grep -q 'root-equivalent host access' "$base/migrate.err"
    grep -q 'docker group membership is permanent' "$base/migrate.err"
    grep -q 'user=alice host=unix:///var/run/docker.sock .*args=info$' "$base/state/docker-env-calls"
    grep -q 'DOCKER_HOST=unix:///var/run/docker.sock docker info$' "$base/state/runuser-calls"
    grep -q "Docker access verified for 'alice'" "$base/migrate.err"
  else
    test ! -e "$base/state/usermod-calls"
  fi

  if [[ "$mode" == "rootless" ]]; then
    grep -q 'target Docker endpoint: unix:///run/user/1001/docker.sock' "$base/migrate.out"
    grep -q 'user=alice host=unix:///run/user/1001/docker.sock .*args=info' "$base/state/docker-env-calls"
    grep -q 'XDG_RUNTIME_DIR=/run/user/1001' "$base/state/crontab-alice"
    grep -q 'DOCKER_HOST=unix:///run/user/1001/docker.sock' "$base/state/crontab-alice"
  else
    grep -q 'target Docker endpoint: target-user default/context' "$base/migrate.out"
    grep -q 'user=alice host= .*args=info' "$base/state/docker-env-calls"
    if grep -q 'DOCKER_HOST=' "$base/state/crontab-alice"; then
      echo "$name: rootful default Docker context should not force DOCKER_HOST into cron" >&2
      exit 1
    fi
  fi
}

run_failing_case() {
  local name="$1" mode="$2" expected="$3"
  shift 3
  local base="$TMP/$name"
  prepare_case "$name"
  if invoke_case "$name" "$mode" "$@"; then
    echo "$name: migration unexpectedly succeeded" >&2
    exit 1
  fi
  grep -Fq "$expected" "$base/migrate.err"
  test ! -e "$base/state/docker-group-granted"
  test ! -e "$base/state/usermod-calls"
  test ! -e "$base/state/gpasswd-calls"
  test ! -e "$base/state/adduser-calls"
  test ! -e "$base/target"
  test -f "$base/source/data/files/file.bin"
  if grep -q 'down --remove-orphans' "$base/state/docker-calls"; then
    echo "$name: migration stopped the source before Docker preflight completed" >&2
    exit 1
  fi
}

run_case rootful rootful
run_case rootless rootless
run_case rootful-opt-in rootful --grant-docker-group
run_case rootless-opt-in rootless --grant-docker-group

# User-selected paths outside SOURCE_HOME are deliberate external mounts.
# Migration must not rebase them or guess that every /root-like path is owned.
prepare_case external-caddy-assets
external="$TMP/external-caddy-assets"
mkdir -p "$external"
sed -i "s#^XD_CADDY_ASSET_DIR=.*#XD_CADDY_ASSET_DIR=$external#" \
  "$TMP/external-caddy-assets/source/config/.env"
invoke_case external-caddy-assets rootful
grep -Fxq "XD_CADDY_ASSET_DIR=$external" \
  "$TMP/external-caddy-assets/target/config/.env"

run_case default-auto-grant needs-group
run_case legacy-explicit-grant needs-group --grant-docker-group

# Failure of the real target storage initialization is a hard migration error:
# do not start an unwritable Server or delete the original root deployment.
prepare_case failed-target-storage-init
if TEST_STORAGE_INIT_FAIL=1 invoke_case failed-target-storage-init rootful; then
  echo "failed storage-init unexpectedly allowed a committed migration" >&2
  exit 1
fi
test -f "$TMP/failed-target-storage-init/source/data/files/file.bin"
test ! -e "$TMP/failed-target-storage-init/target"
grep -Fq 'target file storage initialization failed' "$TMP/failed-target-storage-init/migrate.err"
grep -Fq 'migration rollback: restarting original root deployment' "$TMP/failed-target-storage-init/migrate.err"
grep -Fq -- "--env-file $TMP/failed-target-storage-init/source/config/.env -f $TMP/failed-target-storage-init/source/config/docker-compose.yml up -d --remove-orphans" "$TMP/failed-target-storage-init/state/docker-calls"
if grep -Fq -- "--env-file $TMP/failed-target-storage-init/target/config/.env -f $TMP/failed-target-storage-init/target/config/docker-compose.yml up -d --remove-orphans" "$TMP/failed-target-storage-init/state/docker-calls"; then
  echo "target Server was started before storage-init passed" >&2
  exit 1
fi

run_failing_case opt-out needs-group 'cannot access a Docker daemon' --no-grant-docker-group
TEST_GROUP_PRESENT=0 run_failing_case missing-group needs-group 'system docker group does not exist'
TEST_DOCKER_SOCKET_GID=99 run_failing_case wrong-socket-group needs-group 'not owned by docker group'
TEST_SYSTEM_DOCKER_AVAILABLE=0 run_failing_case no-system-daemon needs-group 'rootful system Docker daemon is not available'
TEST_GROUP_ALREADY_MEMBER=1 run_failing_case already-member needs-group 'already in docker group but Docker is inaccessible'

run_failed_group_attempt() {
  local name="$1" expected="$2" membership="$3"
  local base="$TMP/$name"
  prepare_case "$name"
  if invoke_case "$name" needs-group; then
    echo "$name: migration unexpectedly succeeded" >&2
    exit 1
  fi
  grep -Fq "$expected" "$base/migrate.err"
  grep -Fxq -- '-aG docker alice' "$base/state/usermod-calls"
  if [[ "$membership" == "yes" ]]; then
    test -e "$base/state/docker-group-granted"
    grep -q 'group grant persists' "$base/migrate.err"
  else
    test ! -e "$base/state/docker-group-granted"
  fi
  test ! -e "$base/target"
  test -f "$base/source/data/files/file.bin"
  if grep -q 'down --remove-orphans' "$base/state/docker-calls"; then
    echo "$name: original deployment stopped despite failed Docker verification" >&2
    exit 1
  fi
}

TEST_USERMOD_FAIL=1 run_failed_group_attempt usermod-failure 'failed to update docker group membership' no
TEST_POST_GRANT_DOCKER_FAIL=1 run_failed_group_attempt post-grant-unusable 'still cannot access Docker' yes

# A restricted root PATH must not require /usr/sbin in PATH for runuser or
# usermod. The injected admin directory prevents touching real host accounts.
mv "$TMP/bin/runuser" "$TMP/runuser-path-hidden"
TEST_ADMIN_DIR="$TMP/admin-sbin" run_case sbin-only-runuser rootful
mv "$TMP/runuser-path-hidden" "$TMP/bin/runuser"

mv "$TMP/bin/usermod" "$TMP/usermod-path-hidden"
TEST_ADMIN_DIR="$TMP/admin-sbin" run_case sbin-only-usermod needs-group
rm "$TMP/admin-sbin/usermod"
TEST_ADMIN_DIR="$TMP/admin-sbin" TEST_EXPECT_GROUP_TOOL=gpasswd run_case gpasswd-fallback needs-group
rm "$TMP/admin-sbin/gpasswd"
TEST_ADMIN_DIR="$TMP/admin-sbin" TEST_EXPECT_GROUP_TOOL=adduser run_case adduser-fallback needs-group
rm "$TMP/admin-sbin/adduser"
TEST_ADMIN_DIR="$TMP/admin-sbin" run_failing_case no-group-tool needs-group 'no supported group management command'
mv "$TMP/usermod-path-hidden" "$TMP/bin/usermod"

TEST_COPY_DELAY_SECS=2 TEST_COPY_PROGRESS_INTERVAL=1 run_case visible-copy-progress rootful
grep -Eq 'copy progress \(I/O estimate\): [0-9.]+ [A-Za-z]+ / [0-9.]+ [A-Za-z]+ \(~[0-9]+%\), elapsed [0-9]+s' \
  "$TMP/visible-copy-progress/migrate.out"

TEST_CURRENT_CASE="copy-error-rollback"
prepare_case "$TEST_CURRENT_CASE"
if TEST_COPY_FAIL=1 invoke_case "$TEST_CURRENT_CASE" rootful; then
  echo "copy failure fixture unexpectedly succeeded" >&2
  exit 1
fi
grep -q 'copy failed after' "$TMP/copy-error-rollback/migrate.err"
grep -q 'migration rollback: restarting original root deployment' "$TMP/copy-error-rollback/migrate.err"
test ! -e "$TMP/copy-error-rollback/target"
test -f "$TMP/copy-error-rollback/source/data/files/file.bin"

if grep -Fq 'du -sb "$TARGET_HOME"' "$MIGRATOR"; then
  echo "migration progress must not recursively scan target backups on every tick" >&2
  exit 1
fi

# Historical backups may be explicitly deferred without suppressing the
# normal service migration, and copied afterwards without stopping the server.
run_case deferred-backups rootful --defer-backups
base="$TMP/deferred-backups"
mkdir -p "$base/target/backups/snapshots/target-new"
printf 'new-backup\n' > "$base/target/backups/snapshots/target-new/database.dump"
docker_count_before="$(wc -l < "$base/state/docker-calls")"
invoke_case deferred-backups rootful --backups-only
test ! -e "$base/target/state/migration-backups-pending"
grep -Fxq 'new-backup' "$base/target/backups/snapshots/target-new/database.dump"
cmp "$base/source/backups/snapshots/older/blobs.tar" \
    "$base/target/backups/snapshots/older/blobs.tar"
cmp "$base/source/backups/snapshots/older-second/blobs.tar" \
    "$base/target/backups/snapshots/older-second/blobs.tar"
cmp "$base/source/backups/pre-upgrade/pre-update/database.dump" \
    "$base/target/backups/pre-upgrade/pre-update/database.dump"
test "$(wc -l < "$base/state/docker-calls")" -eq "$docker_count_before"
test -d "$base/target/state/migration-backups-imported"
test "$(find "$base/target/state/migration-backups-imported" -type f | wc -l)" -ge 3
# Running the import again must remain idempotent without hashing huge archives.
invoke_case deferred-backups rootful --backups-only
grep -q 'previously imported backup retained' "$base/migrate.out"
test ! -e "$base/target/state/migration-backups-pending"

# Collisions with backups produced by the live target must never overwrite
# either original or silently clear the pending-history marker.
run_case conflicting-backups rootful --defer-backups
base="$TMP/conflicting-backups"
mkdir -p "$base/target/backups/snapshots/older"
printf 'target-content\n' > "$base/target/backups/snapshots/older/blobs.tar"
docker_count_before="$(wc -l < "$base/state/docker-calls")"
if invoke_case conflicting-backups rootful --backups-only; then
  echo "backup history name collision unexpectedly succeeded" >&2
  exit 1
fi
grep -q 'backup name collision' "$base/migrate.err"
grep -Fxq 'target-content' "$base/target/backups/snapshots/older/blobs.tar"
grep -Fxq 'original-history' "$base/source/backups/snapshots/older/blobs.tar"
test -f "$base/target/state/migration-backups-pending"
test "$(wc -l < "$base/state/docker-calls")" -eq "$docker_count_before"

# Refuse symlinked writable import destinations before root writes anything.
run_case symlinked-import-journal rootful --defer-backups
base="$TMP/symlinked-import-journal"
mkdir -p "$base/outside"
ln -s "$base/outside" "$base/target/state/migration-backups-imported"
if invoke_case symlinked-import-journal rootful --backups-only; then
  echo "backup-only unexpectedly accepted a symlinked import journal" >&2
  exit 1
fi
grep -q 'symlinked backup import journal' "$base/migrate.err"
test ! -e "$base/outside/pre-update"
test -f "$base/target/state/migration-backups-pending"

# A backup-only request is forbidden without a verified migration marker.
prepare_case no-migration-marker
if invoke_case no-migration-marker rootful --backups-only; then
  echo "backup-only unexpectedly accepted an un-migrated target" >&2
  exit 1
fi
grep -q -- '--backups-only requires a completed migration' "$TMP/no-migration-marker/migrate.err"
test ! -e "$TMP/no-migration-marker/target"
if grep -q 'down --remove-orphans' "$TMP/no-migration-marker/state/docker-calls" 2>/dev/null; then
  echo "backup-only must not touch Docker" >&2
  exit 1
fi

# Deferral must never silently omit active data configured under backups.
prepare_case active-files-under-backups
base="$TMP/active-files-under-backups"
printf 'XD_FILES_DATA_DIR=%s\n' "$base/source/backups/snapshots" >> "$base/source/config/.env"
if invoke_case active-files-under-backups rootful --defer-backups; then
  echo "defer-backups unexpectedly permitted an active data path under backups" >&2
  exit 1
fi
grep -q -- '--defer-backups would omit active XD_FILES_DATA_DIR' "$base/migrate.err"
test ! -e "$base/target"
test -f "$base/source/data/files/file.bin"
if grep -q 'down --remove-orphans' "$base/state/docker-calls" 2>/dev/null; then
  echo "deferred data-path rejection stopped the original deployment" >&2
  exit 1
fi

prepare_case active-symlink-under-backups
base="$TMP/active-symlink-under-backups"
ln -s "$base/source/backups/snapshots" "$base/source/data/files/backup-link"
printf 'XD_FILES_DATA_DIR=%s\n' "$base/source/data/files/backup-link" >> "$base/source/config/.env"
if invoke_case active-symlink-under-backups rootful --defer-backups; then
  echo "defer-backups unexpectedly permitted a symlink into backups" >&2
  exit 1
fi
grep -q -- '--defer-backups would omit active XD_FILES_DATA_DIR through a symlink' "$base/migrate.err"
test ! -e "$base/target"

# On interruption/import error, the source archive and target service are
# unchanged; no partially copied snapshot may become visible to readers.
run_case failed-backup-import rootful --defer-backups
base="$TMP/failed-backup-import"
docker_count_before="$(wc -l < "$base/state/docker-calls")"
if TEST_COPY_FAIL_ON_BACKUPS=1 invoke_case failed-backup-import rootful --backups-only; then
  echo "simulated backup archive failure unexpectedly succeeded" >&2
  exit 1
fi
grep -q 'backup import copy failed' "$base/migrate.err"
test -f "$base/target/state/migration-backups-pending"
test ! -e "$base/target/backups/pre-upgrade/pre-update"
test -f "$base/source/backups/pre-upgrade/pre-update/database.dump"
test "$(wc -l < "$base/state/docker-calls")" -eq "$docker_count_before"
if find "$base/target/backups" -type d -name '.xdrive-import.*' | grep -q .; then
  echo "failed import left an incomplete staging archive" >&2
  exit 1
fi
invoke_case failed-backup-import rootful --backups-only
cmp "$base/source/backups/pre-upgrade/pre-update/database.dump" \
    "$base/target/backups/pre-upgrade/pre-update/database.dump"
test ! -e "$base/target/state/migration-backups-pending"

echo "server root-to-user migration tests passed"
