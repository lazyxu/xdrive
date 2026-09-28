#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATOR="$ROOT/scripts/server-migrate-user.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/state" "$TMP/source/config" "$TMP/source/bin" \
  "$TMP/source/data/files" "$TMP/source/data/postgres" "$TMP/source/data/caddy/data" \
  "$TMP/source/data/caddy/config" "$TMP/source/backups/snapshots" "$TMP/source/logs" \
  "$TMP/source/state" "$TMP/alice-home"

cat > "$TMP/source/config/.env" <<EOF
XD_FILES_DATA_DIR=$TMP/source/data/files
XD_POSTGRES_DATA_DIR=$TMP/source/data/postgres
XD_CADDY_DATA_DIR=$TMP/source/data/caddy/data
XD_CADDY_CONFIG_DIR=$TMP/source/data/caddy/config
XD_DOCKER_MODE=rootful
XD_BACKUP_SCHEDULE=17 3 * * *
EOF
printf 'name: xdrive\nservices: {}\n' > "$TMP/source/config/docker-compose.yml"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/source/bin/xdrive-server"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/source/bin/server-backup-scheduled.sh"
chmod +x "$TMP/source/bin/xdrive-server" "$TMP/source/bin/server-backup-scheduled.sh"
printf 'payload\n' > "$TMP/source/data/files/file.bin"

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
if [[ "$1" == "info" ]]; then
  echo '[]'
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

cat > "$TMP/state/crontab-root" <<EOF
17 3 * * * XD_CONFIG_DIR=$TMP/source $TMP/source/bin/server-backup-scheduled.sh # xdrive-managed-backup
5 4 * * * echo keep-root-entry
EOF

TEST_STATE="$TMP/state" \
TEST_TARGET_LOGIN_HOME="$TMP/alice-home" \
USER=root \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_SOURCE_CONFIG_DIR="$TMP/source" \
XD_TARGET_CONFIG_DIR="$TMP/target" \
XD_TARGET_SHELL_RC="$TMP/alice.bashrc" \
XD_MIGRATE_TEST_ALLOW_NONROOT=1 \
bash "$MIGRATOR" alice >"$TMP/migrate.out" 2>"$TMP/migrate.err"

test -f "$TMP/source/data/files/file.bin"
test -f "$TMP/target/data/files/file.bin"
test -x "$TMP/target/bin/xdrive-server"
test -f "$TMP/target/state/migrated-from-root"

grep -q "^XD_FILES_DATA_DIR=$TMP/target/data/files$" "$TMP/target/config/.env"
grep -q "^XD_POSTGRES_DATA_DIR=$TMP/target/data/postgres$" "$TMP/target/config/.env"
grep -q "^XD_CADDY_DATA_DIR=$TMP/target/data/caddy/data$" "$TMP/target/config/.env"
grep -q "^XD_CADDY_CONFIG_DIR=$TMP/target/data/caddy/config$" "$TMP/target/config/.env"
grep -q '^XD_DOCKER_MODE=rootful$' "$TMP/target/config/.env"

grep -q '# >>> xDrive server PATH >>>' "$TMP/alice.bashrc"
grep -Fq "$TMP/target/bin" "$TMP/alice.bashrc"
grep -q "source $TMP/alice.bashrc" "$TMP/migrate.out"

grep -q -- "--env-file $TMP/source/config/.env -f $TMP/source/config/docker-compose.yml down --remove-orphans" "$TMP/state/docker-calls"
grep -q -- "--env-file $TMP/target/config/.env -f $TMP/target/config/docker-compose.yml up -d --remove-orphans" "$TMP/state/docker-calls"
grep -q -- "--env-file $TMP/target/config/.env -f $TMP/target/config/docker-compose.yml exec -T server xdrive-server healthcheck" "$TMP/state/docker-calls"

grep -q 'keep-root-entry' "$TMP/state/crontab-root"
if grep -q 'xdrive-managed-backup' "$TMP/state/crontab-root"; then
  echo "root managed backup schedule survived migration" >&2
  exit 1
fi
grep -q "XD_CONFIG_DIR=$TMP/target" "$TMP/state/crontab-alice"
grep -q "$TMP/target/bin/server-backup-scheduled.sh" "$TMP/state/crontab-alice"

echo "server root-to-user migration tests passed"
