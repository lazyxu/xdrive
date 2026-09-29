#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATOR="$ROOT/scripts/server-migrate-user.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"

cat > "$TMP/bin/getent" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "passwd" && "$2" == "alice" ]]
printf 'alice:x:1001:1001::%s:/bin/bash\n' "$TEST_TARGET_LOGIN_HOME"
SH
chmod +x "$TMP/bin/getent"

cat > "$TMP/bin/id" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "-u alice"|"-g alice") echo 1001 ;;
  "-u") echo 0 ;;
  *) /usr/bin/id "$@" ;;
esac
SH
chmod +x "$TMP/bin/id"

cat > "$TMP/bin/runuser" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "-u" && "$2" == "alice" && "$3" == "--" ]]
shift 3
exec "$@"
SH
chmod +x "$TMP/bin/runuser"

cat > "$TMP/bin/chown" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/chown"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/docker-calls"
printf 'user=%s host=%s context=%s config=%s tls=%s cert=%s api=%s args=%s\n' \
  "${USER:-}" "${DOCKER_HOST:-}" "${DOCKER_CONTEXT:-}" "${DOCKER_CONFIG:-}" \
  "${DOCKER_TLS_VERIFY:-}" "${DOCKER_CERT_PATH:-}" "${DOCKER_API_VERSION:-}" "$*" \
  >> "$TEST_STATE/docker-env-calls"

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
    "$base/source/state" "$base/alice-home"

  cat > "$base/source/config/.env" <<EOF
XD_FILES_DATA_DIR=$base/source/data/files
XD_POSTGRES_DATA_DIR=$base/source/data/postgres
XD_CADDY_DATA_DIR=$base/source/data/caddy/data
XD_CADDY_CONFIG_DIR=$base/source/data/caddy/config
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

run_case() {
  local name="$1" mode="$2"
  local base="$TMP/$name"
  prepare_case "$name"

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
  bash "$MIGRATOR" alice >"$base/migrate.out" 2>"$base/migrate.err"

  test -f "$base/source/data/files/file.bin"
  test -f "$base/target/data/files/file.bin"
  test -x "$base/target/bin/xdrive-server"
  test -f "$base/target/state/migrated-from-root"

  grep -q "^XD_FILES_DATA_DIR=$base/target/data/files$" "$base/target/config/.env"
  grep -q "^XD_POSTGRES_DATA_DIR=$base/target/data/postgres$" "$base/target/config/.env"
  grep -q "^XD_CADDY_DATA_DIR=$base/target/data/caddy/data$" "$base/target/config/.env"
  grep -q "^XD_CADDY_CONFIG_DIR=$base/target/data/caddy/config$" "$base/target/config/.env"
  grep -q "^XD_DOCKER_MODE=$mode$" "$base/target/config/.env"

  grep -q '# >>> xDrive server PATH >>>' "$base/alice.bashrc"
  grep -Fq "$base/target/bin" "$base/alice.bashrc"
  grep -q "source $base/alice.bashrc" "$base/migrate.out"

  grep -q -- "--env-file $base/source/config/.env -f $base/source/config/docker-compose.yml down --remove-orphans" "$base/state/docker-calls"
  grep -q -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml up -d --remove-orphans" "$base/state/docker-calls"
  grep -q -- "--env-file $base/target/config/.env -f $base/target/config/docker-compose.yml exec -T server xdrive-server healthcheck" "$base/state/docker-calls"

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

run_case rootful rootful
run_case rootless rootless

echo "server root-to-user migration tests passed"
