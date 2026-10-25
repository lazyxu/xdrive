#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export XD_CONFIG_DIR="$TMP/home"
export XD_SCHEDULE_TEST_LOG="$TMP/argv.log"
mkdir -p "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/bin" "$XD_CONFIG_DIR/backups/snapshots"
env_file="$XD_CONFIG_DIR/config/.env"
script="$ROOT/scripts/server-backup-scheduled.sh"
[[ -f "$script" ]]
cat > "$XD_CONFIG_DIR/bin/xdrive-server" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$XD_SCHEDULE_TEST_LOG"
MOCK
chmod 700 "$XD_CONFIG_DIR/bin/xdrive-server"

invoke() {
  : > "$XD_SCHEDULE_TEST_LOG"
  bash "$script"
}
expect_args() {
  local first="$1" second="$2"
  [[ "$(sed -n '1p' "$XD_SCHEDULE_TEST_LOG")" == "$first" ]]
  [[ "$(sed -n '2p' "$XD_SCHEDULE_TEST_LOG")" == "$second" ]]
}
old_v1="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-legacy-old"
mkdir "$old_v1"
touch -d '20 days ago' "$old_v1"

# Existing installed configuration still creates v1 tar backups and prunes only
# the old v1 snapshots according to the existing retention setting.
printf 'XD_BACKUP_RETENTION_DAYS=7\n' > "$env_file"
invoke
expect_args backup --output-dir
[[ ! -d "$old_v1" ]]
[[ "$(sed -n '3p' "$XD_SCHEDULE_TEST_LOG")" == "$XD_CONFIG_DIR/backups/snapshots" ]]

# Opt-in v2 uses the existing host command, not a second runner/queue; it must
# NOT delete even old v1 snapshots or v2 repo snapshots and shared objects.
mkdir "$old_v1"
touch -d '20 days ago' "$old_v1"
v2_snapshot="$XD_CONFIG_DIR/backups/incremental/snapshots/xdrive-backup-old-v2"
v2_object="$XD_CONFIG_DIR/backups/incremental/objects/sha256/ab/abc"
mkdir -p "$(dirname "$v2_snapshot")" "$(dirname "$v2_object")" "$v2_snapshot"
printf 'CAS original\n' > "$v2_object"
touch -d '20 days ago' "$v2_snapshot"
printf 'XD_BACKUP_RETENTION_DAYS=0oops\nXD_BACKUP_SCHEDULE_FORMAT=v2\n' > "$env_file"
invoke
expect_args backup --incremental
[[ "$(wc -l < "$XD_SCHEDULE_TEST_LOG")" -eq 2 ]]
[[ -d "$old_v1" && -d "$v2_snapshot" ]]
[[ "$(cat "$v2_object")" == 'CAS original' ]]

# A custom absolute repository is passed as one quoted argument even if it
# contains spaces. Verify the fallback script uses the same v2 implementation.
custom_repo="$TMP/other disk/incremental"
printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' "$custom_repo" > "$env_file"
invoke
expect_args backup --incremental
[[ "$(sed -n '3p' "$XD_SCHEDULE_TEST_LOG")" == --repository-dir ]]
[[ "$(sed -n '4p' "$XD_SCHEDULE_TEST_LOG")" == "$custom_repo" ]]
[[ "$(wc -l < "$XD_SCHEDULE_TEST_LOG")" -eq 4 ]]
mv "$XD_CONFIG_DIR/bin/xdrive-server" "$XD_CONFIG_DIR/bin/server-backup.sh"
invoke
[[ "$(sed -n '1p' "$XD_SCHEDULE_TEST_LOG")" == --config-dir ]]
[[ "$(sed -n '2p' "$XD_SCHEDULE_TEST_LOG")" == "$XD_CONFIG_DIR" ]]
[[ "$(sed -n '3p' "$XD_SCHEDULE_TEST_LOG")" == --incremental ]]
[[ "$(sed -n '4p' "$XD_SCHEDULE_TEST_LOG")" == --repository-dir ]]
[[ "$(sed -n '5p' "$XD_SCHEDULE_TEST_LOG")" == "$custom_repo" ]]

# Fail closed: invalid mode, v1 repository option and relative/symlink path
# must never invoke the existing backup runner.
cat > "$env_file" <<'EOF'
XD_BACKUP_SCHEDULE_FORMAT=v3
EOF
if invoke >"$TMP/invalid-format.log" 2>&1; then
  echo 'invalid backup mode was accepted' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
grep -Fq 'XD_BACKUP_SCHEDULE_FORMAT must be v1 or v2' "$TMP/invalid-format.log"

cat > "$env_file" <<'EOF'
XD_BACKUP_SCHEDULE_REPOSITORY_DIR=/tmp/ignore
EOF
if invoke >"$TMP/repo-v1.log" 2>&1; then
  echo 'v2 repository option was accepted for v1' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
grep -Fq 'requires v2' "$TMP/repo-v1.log"

cat > "$env_file" <<'EOF'
XD_BACKUP_SCHEDULE_FORMAT=v2
XD_BACKUP_SCHEDULE_REPOSITORY_DIR=relative/path
EOF
if invoke >"$TMP/relative.log" 2>&1; then
  echo 'relative repository path was accepted' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]
grep -Fq 'absolute non-symlink path' "$TMP/relative.log"

ln -s "$XD_CONFIG_DIR/backups" "$TMP/repo-link"
printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' "$TMP/repo-link" > "$env_file"
if invoke >"$TMP/symlink.log" 2>&1; then
  echo 'symlink repository path was accepted' >&2; exit 1
fi
[[ ! -s "$XD_SCHEDULE_TEST_LOG" ]]

echo 'scheduled backup v1/v2 opt-in and no-v2-prune tests passed'
