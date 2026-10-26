#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Migrate an xDrive server deployment from root to a normal Linux user.

Usage:
  server-migrate-user.sh USER [--grant-docker-group|--no-grant-docker-group] [--defer-backups]
  server-migrate-user.sh USER --backups-only

Typical:
  /root/.xd/bin/xdrive-server migrate-user alice
  /root/.xd/bin/xdrive-server migrate-user alice --defer-backups
  /root/.xd/bin/xdrive-server migrate-user alice --backups-only

Defaults:
  source: /root/.xd (or the current xDrive home when invoked via xdrive-server)
  target: /home/USER/.xd

If the target cannot access Docker, migration grants root-equivalent docker
membership automatically only after verifying the local rootful daemon/socket.
Use --no-grant-docker-group to disable automatic authorization; the older
--grant-docker-group option remains supported. A group grant is permanent even
if migration fails.

Backups are included by default. --defer-backups copies only the active xDrive
deployment; existing backup archives remain under the root source, and MUST NOT
be deleted. Once migration succeeds, --backups-only atomically imports older
backup archives into the active target without stopping it or overwriting new
target backups. A failed backup import can be retried.

The source deployment is retained after success as a rollback copy. It is not
deleted automatically.
EOF
}

GRANT_DOCKER_GROUP=1
DEFER_BACKUPS=0
BACKUPS_ONLY=0
(( $# >= 1 )) || { usage >&2; exit 2; }
[[ "$1" != -* ]] || { usage >&2; exit 2; }
TARGET_USER="$1"
shift
for option in "$@"; do
  case "$option" in
    --grant-docker-group) GRANT_DOCKER_GROUP=1 ;;
    --no-grant-docker-group) GRANT_DOCKER_GROUP=0 ;;
    --defer-backups) DEFER_BACKUPS=1 ;;
    --backups-only) BACKUPS_ONLY=1 ;;
    *) usage >&2; exit 2 ;;
  esac
done
if [[ "$DEFER_BACKUPS" == "1" && "$BACKUPS_ONLY" == "1" ]]; then
  echo "xDrive migration: --defer-backups and --backups-only cannot be combined." >&2
  exit 2
fi

if [[ "${EUID:-$(id -u)}" -ne 0 && "${XD_MIGRATE_TEST_ALLOW_NONROOT:-0}" != "1" ]]; then
  echo "xDrive migration must be started by root because it reads the root deployment and changes file ownership." >&2
  exit 1
fi

command -v getent >/dev/null 2>&1 || { echo "xDrive migration: getent is required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "xDrive migration: docker is required." >&2; exit 1; }

format_bytes() {
  awk -v bytes="${1:-0}" 'BEGIN {
    split("B KiB MiB GiB TiB PiB EiB", unit, " ");
    n = bytes + 0; i = 1;
    while (n >= 1024 && i < 7) { n /= 1024; i++ }
    if (i == 1) printf "%.0f %s", n, unit[i]; else printf "%.1f %s", n, unit[i]
  }'
}

passwd_line="$(getent passwd "$TARGET_USER" || true)"
[[ -n "$passwd_line" ]] || { echo "xDrive migration: user '$TARGET_USER' does not exist." >&2; exit 1; }
TARGET_UID="$(id -u "$TARGET_USER")"
TARGET_GID="$(id -g "$TARGET_USER")"
[[ "$TARGET_UID" -ne 0 ]] || { echo "xDrive migration: target must be a non-root user." >&2; exit 1; }
TARGET_LOGIN_HOME="$(printf '%s\n' "$passwd_line" | cut -d: -f6)"
TARGET_SHELL="$(printf '%s\n' "$passwd_line" | cut -d: -f7)"
[[ -n "$TARGET_LOGIN_HOME" && "$TARGET_LOGIN_HOME" == /* ]] || {
  echo "xDrive migration: target user has no usable home directory." >&2
  exit 1
}

SOURCE_HOME="${XD_SOURCE_CONFIG_DIR:-${XD_CONFIG_DIR:-/root/.xd}}"
TARGET_HOME="${XD_TARGET_CONFIG_DIR:-$TARGET_LOGIN_HOME/.xd}"
SOURCE_CONFIG="$SOURCE_HOME/config"
SOURCE_ENV="$SOURCE_CONFIG/.env"
SOURCE_COMPOSE="$SOURCE_CONFIG/docker-compose.yml"
TARGET_CONFIG="$TARGET_HOME/config"
TARGET_ENV="$TARGET_CONFIG/.env"
TARGET_COMPOSE="$TARGET_CONFIG/docker-compose.yml"
TARGET_BIN="$TARGET_HOME/bin"
TARGET_MANAGER="$TARGET_BIN/xdrive-server"
TARGET_STATE="$TARGET_HOME/state"
TARGET_LOG="$TARGET_HOME/logs"
TARGET_RUNTIME_DIR="/run/user/$TARGET_UID"
TARGET_DOCKER_HOST=""
TARGET_DOCKER_ENDPOINT=""
TARGET_DOCKER_SECURITY=""
TARGET_CREATED=0
SOURCE_STOPPED=0
TARGET_STARTED=0
MIGRATION_COMMITTED=0
CRON_CHANGED=0
ROOT_CRON_SNAPSHOT=""
TARGET_CRON_SNAPSHOT=""

[[ "$SOURCE_HOME" == /* && "$TARGET_HOME" == /* ]] || {
  echo "xDrive migration: source and target xDrive homes must be absolute paths." >&2
  exit 1
}
[[ "$SOURCE_HOME" != "$TARGET_HOME" ]] || {
  echo "xDrive migration: source and target xDrive homes are identical." >&2
  exit 1
}
[[ -f "$SOURCE_ENV" && -f "$SOURCE_COMPOSE" ]] || {
  echo "xDrive migration: no active xDrive deployment found at $SOURCE_HOME." >&2
  exit 1
}

command -v flock >/dev/null 2>&1 || {
  echo "xDrive migration: flock is required for migration/update locking." >&2
  exit 1
}
mkdir -p "$SOURCE_HOME/state"
exec 9>"$SOURCE_HOME/state/install.lock"
if ! flock -n 9; then
  echo "xDrive migration: another install/update/migration is already running for $SOURCE_HOME." >&2
  exit 75
fi
printf '%s\n' "${BASHPID:-unknown}" 1>&9


# Import only after a completed migration. This operation intentionally never
# touches Docker or reconfigures services, so a failed import cannot roll back
# a live target whose database may already contain newer user writes.
import_backup_item() {
  local source_item="$1" destination_dir="$2" destination_item stage
  local entry_key journal_dir journal_entry
  destination_item="$destination_dir/${source_item##*/}"
  journal_dir="$TARGET_STATE/migration-backups-imported"
  if [[ -L "$journal_dir" ]]; then
    echo "xDrive migration: refusing to use a symlinked backup import journal." >&2
    return 1
  fi
  mkdir -p "$journal_dir"
  chmod 700 "$journal_dir"
  entry_key="$(printf '%s' "$source_item" | sha256sum | awk '{print $1}')"
  journal_entry="$journal_dir/$entry_key"
  if [[ -e "$destination_item" || -L "$destination_item" ]]; then
    if [[ -f "$journal_entry" ]] && grep -Fxq "$source_item" "$journal_entry"; then
      echo "[xDrive] previously imported backup retained: $destination_item"
      return 0
    fi
    echo "xDrive migration: backup name collision; keeping both originals untouched: $destination_item" >&2
    echo "xDrive migration: deferred backup marker remains until the conflict is resolved." >&2
    return 1
  fi
  stage="$(mktemp -d "$destination_dir/.xdrive-import.XXXXXXXX")" || return 1
  IMPORT_STAGE="$stage"
  echo "[xDrive] importing historical backup: $source_item"
  if cp --help 2>/dev/null | grep -q -- '--reflink'; then
    if ! cp -a --reflink=auto -- "$source_item" "$stage/"; then
      rm -rf -- "$stage"
      echo "xDrive migration: backup import copy failed; source remains unchanged." >&2
      return 1
    fi
  elif ! cp -a -- "$source_item" "$stage/"; then
    rm -rf -- "$stage"
    echo "xDrive migration: backup import copy failed; source remains unchanged." >&2
    return 1
  fi
  if ! chown -R "$TARGET_UID:$TARGET_GID" "$stage"; then
    rm -rf -- "$stage"
    echo "xDrive migration: failed to set ownership of imported backup." >&2
    return 1
  fi
  # -n forbids overwriting a backup created by the target while we copied.
  if ! mv -n -T -- "$stage/${source_item##*/}" "$destination_item"; then
    rm -rf -- "$stage"
    echo "xDrive migration: failed to publish imported backup." >&2
    return 1
  fi
  if [[ -e "$stage/${source_item##*/}" || -L "$stage/${source_item##*/}" ]]; then
    echo "xDrive migration: backup name collision during import; preserving the live target: $destination_item" >&2
    rm -rf -- "$stage"
    return 1
  fi
  rmdir "$stage"
  IMPORT_STAGE=""
  # An idempotency journal distinguishes archives imported by this command
  # from an unrelated newer backup with the same name, without rereading huge
  # blobs.tar files. A crash between publish and journal remains detectable as
  # a conservative conflict and never silently marks backups complete.
  printf '%s\n' "$source_item" > "$journal_entry"
  chown "$TARGET_UID:$TARGET_GID" "$journal_entry"
  chmod 600 "$journal_entry"
}

import_backup_history() {
  local source_backups="$SOURCE_HOME/backups" target_backups="$TARGET_HOME/backups"
  local marker="$TARGET_STATE/migrated-from-root" group target_group item
  if [[ -L "$TARGET_HOME" || -L "$TARGET_STATE" ]]; then
    echo "xDrive migration: refusing to import backups through a symlinked target home/state." >&2
    return 1
  fi
  if [[ ! -f "$marker" || -L "$marker" ]] ||
      ! grep -Fxq "source_home=$SOURCE_HOME" "$marker" ||
      ! grep -Fxq "target_home=$TARGET_HOME" "$marker" ||
      ! grep -Fxq "target_user=$TARGET_USER" "$marker"; then
    echo "xDrive migration: --backups-only requires a completed migration from this source to this target." >&2
    return 1
  fi
  if [[ ! -d "$source_backups" ]]; then
    echo "[xDrive] no source backup history exists to import."
    rm -f -- "$TARGET_STATE/migration-backups-pending"
    return 0
  fi
  if [[ -L "$target_backups" ]]; then
    echo "xDrive migration: refusing to import backups through a target symlink." >&2
    return 1
  fi
  mkdir -p "$target_backups"
  chown "$TARGET_UID:$TARGET_GID" "$target_backups"

  # Include snapshots, pre-upgrade, pre-restore and any other preserved
  # top-level archive categories, including hidden entries. Copy each snapshot
  # through a private staging directory and atomically publish only when done.
  shopt -s nullglob dotglob
  for group in "$source_backups"/*; do
    if [[ -d "$group" && ! -L "$group" ]]; then
      target_group="$target_backups/${group##*/}"
      if [[ -L "$target_group" || ( -e "$target_group" && ! -d "$target_group" ) ]]; then
        echo "xDrive migration: target backup category is not a normal directory: $target_group" >&2
        return 1
      fi
      mkdir -p "$target_group"
      chown "$TARGET_UID:$TARGET_GID" "$target_group"
      for item in "$group"/*; do
        import_backup_item "$item" "$target_group" || return 1
      done
    else
      import_backup_item "$group" "$target_backups" || return 1
    fi
  done
  rm -f -- "$TARGET_STATE/migration-backups-pending"
  echo "[xDrive] backup history import complete. Original history retained at $source_backups."
}

if [[ "$BACKUPS_ONLY" == "1" ]]; then
  # Unlike the normal migration transaction, importing backups must never
  # stop or roll back the already-running target server.
  IMPORT_STAGE=""
  trap 'if [[ -n "$IMPORT_STAGE" ]]; then rm -rf -- "$IMPORT_STAGE"; fi' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  import_backup_history
  exit $?
fi

if [[ -e "$TARGET_HOME" ]]; then
  if find "$TARGET_HOME" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
    echo "xDrive migration: target $TARGET_HOME already contains files; refusing to overwrite it." >&2
    exit 1
  fi
else
  TARGET_CREATED=1
fi

# Root shells and minimal installer environments often omit /usr/sbin from PATH.
# Resolve administrative tools without changing the PATH inherited by Docker.
resolve_host_admin_command() {
  local name="$1" dir
  if [[ "${XD_MIGRATE_TEST_ALLOW_NONROOT:-0}" == "1" && -n "${XD_MIGRATE_TEST_ADMIN_DIR:-}" ]]; then
    # Isolated fixture lookup: never invoke the test host's real group tools.
    [[ -x "$XD_MIGRATE_TEST_ADMIN_DIR/$name" ]] || return 1
    printf '%s\n' "$XD_MIGRATE_TEST_ADMIN_DIR/$name"
    return 0
  fi
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  for dir in /usr/sbin /sbin /usr/local/sbin /usr/bin /bin; do
    if [[ -x "$dir/$name" && ! -d "$dir/$name" ]]; then
      printf '%s\n' "$dir/$name"
      return 0
    fi
  done
  return 1
}

run_as_target() {
  local runuser_cmd
  local -a clean_env=(
    env
    -u DOCKER_HOST
    -u DOCKER_CONTEXT
    -u DOCKER_CONFIG
    -u DOCKER_TLS_VERIFY
    -u DOCKER_CERT_PATH
    -u DOCKER_API_VERSION
    HOME="$TARGET_LOGIN_HOME"
    USER="$TARGET_USER"
    LOGNAME="$TARGET_USER"
    XDG_RUNTIME_DIR="$TARGET_RUNTIME_DIR"
  )

  if [[ "$(id -u)" -eq "$TARGET_UID" ]]; then
    "${clean_env[@]}" "$@"
  else
    if ! runuser_cmd="$(resolve_host_admin_command runuser)"; then
      echo "xDrive migration: runuser is required to execute Docker as $TARGET_USER." >&2
      return 1
    fi
    "$runuser_cmd" -u "$TARGET_USER" -- "${clean_env[@]}" "$@"
  fi
}

target_docker_with_host() {
  local docker_host="$1"
  shift
  if [[ -n "$docker_host" ]]; then
    run_as_target env DOCKER_HOST="$docker_host" docker "$@"
  else
    run_as_target docker "$@"
  fi
}

target_docker() {
  target_docker_with_host "$TARGET_DOCKER_HOST" "$@"
}

select_target_docker() {
  local rootless_host="unix://$TARGET_RUNTIME_DIR/docker.sock"
  local rootful_host="unix:///var/run/docker.sock"

  # First use the target user's own Docker config/context, but never inherit
  # root's Docker connection overrides.
  if target_docker_with_host "" info </dev/null >/dev/null 2>&1; then
    TARGET_DOCKER_HOST=""
    TARGET_DOCKER_ENDPOINT="target-user default/context"
  elif target_docker_with_host "$rootless_host" info </dev/null >/dev/null 2>&1; then
    TARGET_DOCKER_HOST="$rootless_host"
    TARGET_DOCKER_ENDPOINT="$rootless_host"
  elif target_docker_with_host "$rootful_host" info </dev/null >/dev/null 2>&1; then
    TARGET_DOCKER_HOST="$rootful_host"
    TARGET_DOCKER_ENDPOINT="$rootful_host"
  else
    return 1
  fi

  TARGET_DOCKER_SECURITY="$(target_docker info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
  [[ -n "$TARGET_DOCKER_SECURITY" ]] || TARGET_DOCKER_SECURITY='[]'
}

grant_target_docker_group() {
  local group_line group_gid socket_gid security_options runuser_cmd grant_cmd
  local -a grant_args=()
  local -a clean_docker_env=(
    env
    -u DOCKER_HOST
    -u DOCKER_CONTEXT
    -u DOCKER_CONFIG
    -u DOCKER_TLS_VERIFY
    -u DOCKER_CERT_PATH
    -u DOCKER_API_VERSION
  )

  group_line="$(getent group docker 2>/dev/null || true)"
  group_gid="$(printf '%s\n' "$group_line" | cut -d: -f3)"
  if [[ ! "$group_gid" =~ ^[0-9]+$ ]]; then
    echo "xDrive migration: system docker group does not exist; no privileges changed." >&2
    return 1
  fi
  if ! runuser_cmd="$(resolve_host_admin_command runuser)"; then
    echo "xDrive migration: runuser is required to verify Docker group membership." >&2
    return 1
  fi
  if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -Fxq docker; then
    echo "xDrive migration: user '$TARGET_USER' is already in docker group but Docker is inaccessible." >&2
    return 1
  fi

  # Verify the real local rootful socket before granting a host-root-equivalent
  # group; do not confuse a working remote/rootless context with system Docker.
  socket_gid="$(stat -Lc '%g' /var/run/docker.sock 2>/dev/null || true)"
  if [[ "$socket_gid" != "$group_gid" ]]; then
    echo "xDrive migration: /var/run/docker.sock is not owned by docker group; no privileges changed." >&2
    return 1
  fi
  if ! security_options="$("${clean_docker_env[@]}" docker --host unix:///var/run/docker.sock \
        info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null)" ||
      [[ -z "$security_options" || "$security_options" == *rootless* ]]; then
    echo "xDrive migration: a rootful system Docker daemon is not available; no privileges changed." >&2
    return 1
  fi

  # Prefer usermod, but support hosts where only gpasswd or Debian adduser
  # exists. Do not retry another tool after an attempted grant fails.
  if grant_cmd="$(resolve_host_admin_command usermod)"; then
    grant_args=(-aG docker "$TARGET_USER")
  elif grant_cmd="$(resolve_host_admin_command gpasswd)"; then
    grant_args=(-a "$TARGET_USER" docker)
  elif grant_cmd="$(resolve_host_admin_command adduser)"; then
    grant_args=("$TARGET_USER" docker)
  else
    echo "xDrive migration: no supported group management command found (usermod, gpasswd, adduser)." >&2
    echo "Install the system's passwd/adduser utilities; no privileges changed." >&2
    return 1
  fi

  echo "[xDrive] granting '$TARGET_USER' docker group membership (root-equivalent host access)..." >&2
  if ! "$grant_cmd" "${grant_args[@]}"; then
    echo "xDrive migration: failed to update docker group membership." >&2
    return 1
  fi
  echo "[xDrive] docker group membership is permanent even if the following migration fails." >&2

  # The requested runuser -u USER -- docker info check is performed with a
  # clean target-user environment and the verified rootful system socket.
  # runuser starts a fresh process, so new supplementary groups take effect.
  if ! "$runuser_cmd" -u "$TARGET_USER" -- env \
      -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_CONFIG \
      -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH -u DOCKER_API_VERSION \
      HOME="$TARGET_LOGIN_HOME" USER="$TARGET_USER" LOGNAME="$TARGET_USER" \
      XDG_RUNTIME_DIR="$TARGET_RUNTIME_DIR" \
      DOCKER_HOST=unix:///var/run/docker.sock \
      docker info </dev/null >/dev/null 2>&1; then
    echo "xDrive migration: docker group was updated, but '$TARGET_USER' still cannot access Docker." >&2
    echo "xDrive migration: the group grant persists; the original deployment was not stopped." >&2
    return 1
  fi
  echo "[xDrive] Docker access verified for '$TARGET_USER' after group update." >&2
}

source_compose() {
  docker compose --env-file "$SOURCE_ENV" -f "$SOURCE_COMPOSE" "$@" </dev/null
}

target_compose() {
  target_docker compose --env-file "$TARGET_ENV" -f "$TARGET_COMPOSE" "$@" </dev/null
}

if ! select_target_docker; then
  # Root-only migration attempts normal and Rootless Docker first. A failed
  # preflight can authorize a verified rootful docker group automatically,
  # unless the operator explicitly opts out.
  if [[ "$GRANT_DOCKER_GROUP" != "1" ]] ||
      ! grant_target_docker_group || ! select_target_docker; then
    echo "xDrive migration: user '$TARGET_USER' cannot access a Docker daemon." >&2
    echo "Checked the target user's clean Docker context, $TARGET_RUNTIME_DIR/docker.sock, and /var/run/docker.sock." >&2
    if [[ "$GRANT_DOCKER_GROUP" == "1" ]]; then
      echo "Docker group authorization failed or did not provide access; check the daemon and socket configuration." >&2
    else
      echo "Automatic docker-group authorization is disabled; retry without --no-grant-docker-group or configure Docker access manually." >&2
    fi
    exit 1
  fi
fi
if ! target_docker compose version </dev/null >/dev/null 2>&1; then
  echo "xDrive migration: Docker Compose v2 is unavailable to user '$TARGET_USER'." >&2
  exit 1
fi
if printf '%s' "$TARGET_DOCKER_SECURITY" | grep -qi rootless; then
  TARGET_DOCKER_MODE="rootless"
else
  TARGET_DOCKER_MODE="rootful"
fi

if [[ "$DEFER_BACKUPS" == "1" ]]; then
  # Exclude the exact history tree so preflight also avoids scanning it.
  source_bytes="$(du -sb --exclude="$SOURCE_HOME/backups" "$SOURCE_HOME" 2>/dev/null | awk '{print $1}' || true)"
else
  source_bytes="$(du -sb "$SOURCE_HOME" 2>/dev/null | awk '{print $1}' || true)"
fi
available_bytes="$(df -PB1 "$TARGET_LOGIN_HOME" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [[ "$source_bytes" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]]; then
  required_bytes=$(( source_bytes + source_bytes / 10 + 64 * 1024 * 1024 ))
  if (( available_bytes < required_bytes )); then
    echo "xDrive migration: insufficient free space to make a safe copy." >&2
    echo "required approximately $(format_bytes "$required_bytes"); available $(format_bytes "$available_bytes")." >&2
    exit 1
  fi
fi

if command -v crontab >/dev/null 2>&1; then
  ROOT_CRON_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/xdrive-root-cron.XXXXXX")"
  TARGET_CRON_SNAPSHOT="$(mktemp "${TMPDIR:-/tmp}/xdrive-target-cron.XXXXXX")"
  crontab -l > "$ROOT_CRON_SNAPSHOT" 2>/dev/null || :
  run_as_target crontab -l > "$TARGET_CRON_SNAPSHOT" 2>/dev/null || :
  chown "$TARGET_UID:$TARGET_GID" "$TARGET_CRON_SNAPSHOT"
fi


# Keep GNU cp --reflink=auto (no rsync/pv requirement). Instead of repeatedly
# scanning directory trees, monitor cp's cumulative I/O using Linux /proc.
# Reflink/metadata copies make this an estimate, not an exact percentage.
COPY_PROGRESS_PID=""
stop_copy_progress() {
  if [[ -n "$COPY_PROGRESS_PID" ]]; then
    kill "$COPY_PROGRESS_PID" 2>/dev/null || true
    wait "$COPY_PROGRESS_PID" 2>/dev/null || true
    COPY_PROGRESS_PID=""
  fi
}

start_copy_progress() {
  local started_at="$1" interval=10 total="${source_bytes:-}" total_human=""
  if [[ "${XD_MIGRATE_TEST_ALLOW_NONROOT:-0}" == "1" &&
        "${XD_MIGRATE_TEST_COPY_PROGRESS_INTERVAL:-}" =~ ^[1-9][0-9]*$ ]]; then
    interval="$XD_MIGRATE_TEST_COPY_PROGRESS_INTERVAL"
  fi
  if [[ "$total" =~ ^[0-9]+$ && "$total" -gt 0 ]]; then
    total_human="$(format_bytes "$total")"
  fi
  # Inspect only the active cp process. Recursively running du against the
  # destination every 10 seconds can stall on millions of backup files.
  local parent_pid="$BASHPID" baseline_wchar=""
  baseline_wchar="$(awk '$1 == "wchar:" {print $2}' "/proc/$parent_pid/io" 2>/dev/null || true)"
  [[ "$baseline_wchar" =~ ^[0-9]+$ ]] || baseline_wchar=0
  (
    local sleep_pid="" child_ids="" candidate="" copy_pid="" bytes="" elapsed=0 percent=0
    local parent_written="" child_written=""
    trap 'if [[ -n "$sleep_pid" ]]; then kill "$sleep_pid" 2>/dev/null || true; fi; exit 0' TERM INT
    while :; do
      sleep "$interval" &
      sleep_pid=$!
      wait "$sleep_pid" || break
      sleep_pid=""
      elapsed=$(( SECONDS - started_at ))
      child_ids=""
      copy_pid=""
      # The migration has exactly one copy child at a time; exclude this
      # monitor. /proc/.../children is a cheap Linux kernel process listing.
      if [[ -r "/proc/$parent_pid/task/$parent_pid/children" ]]; then
        IFS= read -r child_ids < "/proc/$parent_pid/task/$parent_pid/children" || true
      fi
      for candidate in $child_ids; do
        [[ "$candidate" == "$BASHPID" ]] && continue
        if [[ -r "/proc/$candidate/io" ]]; then
          copy_pid="$candidate"
          break
        fi
      done
      # Linux includes reaped children's I/O in the parent's counters. Add
      # the active child's counters, then subtract the pre-copy baseline so
      # progress remains cumulative when --defer-backups copies separate dirs.
      parent_written="$(awk '$1 == "wchar:" {print $2}' "/proc/$parent_pid/io" 2>/dev/null || true)"
      if [[ "$parent_written" =~ ^[0-9]+$ ]]; then
        bytes=$(( parent_written - baseline_wchar ))
        if [[ -n "$copy_pid" ]]; then
          child_written="$(awk '$1 == "wchar:" {print $2}' "/proc/$copy_pid/io" 2>/dev/null || true)"
          if [[ "$child_written" =~ ^[0-9]+$ ]]; then
            bytes=$(( bytes + child_written ))
          fi
        fi
        (( bytes >= 0 )) || bytes=0
        if [[ -n "$total_human" ]]; then
          percent=$(( bytes * 100 / total ))
          (( percent < 100 )) || percent=99
          printf '[xDrive] copy progress (I/O estimate): %s / %s (~%d%%), elapsed %ds\n' \
            "$(format_bytes "$bytes")" "$total_human" "$percent" "$elapsed"
        else
          printf '[xDrive] copy activity: %s written, elapsed %ds\n' \
            "$(format_bytes "$bytes")" "$elapsed"
        fi
        continue
      fi
      printf '[xDrive] copy in progress, elapsed %ds (I/O counters unavailable)\n' "$elapsed"
    done
  ) &
  COPY_PROGRESS_PID=$!
}

rollback() {
  local status=$?
  stop_copy_progress
  [[ "$MIGRATION_COMMITTED" == "1" ]] && return "$status"
  trap - EXIT INT TERM
  set +e
  if [[ "$TARGET_STARTED" == "1" && -f "$TARGET_ENV" && -f "$TARGET_COMPOSE" ]]; then
    echo "[xDrive] migration rollback: stopping target-user deployment..." >&2
    target_compose down --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$SOURCE_STOPPED" == "1" ]]; then
    echo "[xDrive] migration rollback: restarting original root deployment..." >&2
    source_compose up -d --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ "$CRON_CHANGED" == "1" && -n "$ROOT_CRON_SNAPSHOT" && -f "$ROOT_CRON_SNAPSHOT" ]]; then
    echo "[xDrive] migration rollback: restoring backup schedules..." >&2
    crontab "$ROOT_CRON_SNAPSHOT" >/dev/null 2>&1 || true
    if [[ -n "$TARGET_CRON_SNAPSHOT" && -f "$TARGET_CRON_SNAPSHOT" ]]; then
      run_as_target crontab "$TARGET_CRON_SNAPSHOT" >/dev/null 2>&1 || true
    fi
  fi
  if [[ "$TARGET_CREATED" == "1" && -e "$TARGET_HOME" ]]; then
    rm -rf -- "$TARGET_HOME"
  fi
  echo "[xDrive] migration failed; the original deployment remains at $SOURCE_HOME." >&2
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set_env_file() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$file.tmp"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k{print k "=" v; next} {print}' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

env_value() {
  local file="$1" key="$2"
  grep "^${key}=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

rewrite_data_path() {
  local key="$1" value
  value="$(env_value "$TARGET_ENV" "$key")"
  case "$value" in
    "$SOURCE_HOME") set_env_file "$TARGET_ENV" "$key" "$TARGET_HOME" ;;
    "$SOURCE_HOME"/*) set_env_file "$TARGET_ENV" "$key" "$TARGET_HOME${value#$SOURCE_HOME}" ;;
  esac
}

detect_target_shell_rc() {
  if [[ -n "${XD_TARGET_SHELL_RC:-}" ]]; then
    printf '%s\n' "$XD_TARGET_SHELL_RC"
    return
  fi
  case "$(basename "$TARGET_SHELL")" in
    zsh) printf '%s\n' "$TARGET_LOGIN_HOME/.zshrc" ;;
    bash) printf '%s\n' "$TARGET_LOGIN_HOME/.bashrc" ;;
    *) printf '%s\n' "$TARGET_LOGIN_HOME/.profile" ;;
  esac
}

write_target_path() {
  local rc tmp begin end
  rc="$(detect_target_shell_rc)"
  begin="# >>> xDrive server PATH >>>"
  end="# <<< xDrive server PATH <<<"
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  chown "$TARGET_UID:$TARGET_GID" "$rc"
  tmp="$(mktemp "$(dirname "$rc")/.xdrive-shell-rc.XXXXXX")"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    !skip { print }
  ' "$rc" > "$tmp"
  {
    printf '\n%s\n' "$begin"
    printf 'export PATH=%q:$PATH\n' "$TARGET_BIN"
    printf '%s\n' "$end"
  } >> "$tmp"
  chmod --reference="$rc" "$tmp" 2>/dev/null || chmod 600 "$tmp"
  chown "$TARGET_UID:$TARGET_GID" "$tmp"
  mv "$tmp" "$rc"
  TARGET_SHELL_RC="$rc"
}

remove_root_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || return 0
  local existing tmp
  existing="$(crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  crontab "$tmp"
  rm -f "$tmp"
}

install_target_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || {
    echo "[xDrive] warning: crontab is unavailable; scheduled backups were not migrated." >&2
    return 0
  }
  local schedule existing tmp runtime_env="" docker_host_env=""
  schedule="$(env_value "$TARGET_ENV" XD_BACKUP_SCHEDULE)"
  [[ -n "$schedule" ]] || return 0
  existing="$(run_as_target crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  if [[ "$TARGET_DOCKER_MODE" == "rootless" ]]; then
    runtime_env="XDG_RUNTIME_DIR=$TARGET_RUNTIME_DIR "
  fi
  if [[ -n "$TARGET_DOCKER_HOST" ]]; then
    docker_host_env="DOCKER_HOST=$TARGET_DOCKER_HOST "
  fi
  printf '%s %s%sXD_CONFIG_DIR=%q %q >> %q 2>&1 # xdrive-managed-backup\n' \
    "$schedule" "$runtime_env" "$docker_host_env" "$TARGET_HOME" "$TARGET_BIN/server-backup-scheduled.sh" "$TARGET_LOG/backup.log" >> "$tmp"
  chown "$TARGET_UID:$TARGET_GID" "$tmp"
  run_as_target crontab "$tmp"
  rm -f "$tmp"
}

if [[ "$DEFER_BACKUPS" == "1" ]]; then
  # Never omit live bind mounts merely because someone configured them beneath
  # the historical backup tree (including symlinks into that tree).
  for data_key in XD_FILES_DATA_DIR XD_POSTGRES_DATA_DIR XD_CADDY_DATA_DIR XD_CADDY_CONFIG_DIR; do
    data_path="$(env_value "$SOURCE_ENV" "$data_key")"
    [[ -n "$data_path" ]] || continue
    resolved_data_path="$(readlink -f -- "$data_path" 2>/dev/null || true)"
    case "$data_path" in
      "$SOURCE_HOME/backups"|"$SOURCE_HOME/backups/"*)
        echo "xDrive migration: --defer-backups would omit active $data_key; use complete migration instead." >&2
        exit 1
        ;;
    esac
    case "$resolved_data_path" in
      "$SOURCE_HOME/backups"|"$SOURCE_HOME/backups/"*)
        echo "xDrive migration: --defer-backups would omit active $data_key through a symlink; use complete migration instead." >&2
        exit 1
        ;;
    esac
  done
fi

echo "[xDrive] migrating server ownership"
echo "  source:      $SOURCE_HOME (root)"
echo "  target:      $TARGET_HOME ($TARGET_USER uid=$TARGET_UID gid=$TARGET_GID)"
echo "  target Docker mode: $TARGET_DOCKER_MODE"
echo "  target Docker endpoint: $TARGET_DOCKER_ENDPOINT"
echo
echo "[xDrive] stopping the original deployment..."
source_compose down --remove-orphans
SOURCE_STOPPED=1

mkdir -p "$TARGET_HOME"
TARGET_CREATED=1
echo "[xDrive] copying xDrive home; the root copy is retained for rollback..."
echo "[xDrive] progress uses cp process I/O counters; reflinks and metadata can make percentages approximate."
if [[ "$source_bytes" =~ ^[0-9]+$ && "$source_bytes" -gt 0 ]]; then
  echo "[xDrive] copy total (apparent size): $(format_bytes "$source_bytes")"
fi
copy_started_at=$SECONDS
start_copy_progress "$copy_started_at"
copy_status=0
if [[ "$DEFER_BACKUPS" == "1" ]]; then
  # Preserve reflink behavior for data files without traversing backup history.
  # Copy top-level entries separately because GNU cp has no --exclude option.
  shopt -s nullglob dotglob
  for entry in "$SOURCE_HOME"/*; do
    [[ "${entry##*/}" == "backups" ]] && continue
    if cp --help 2>/dev/null | grep -q -- '--reflink'; then
      cp -a --reflink=auto -- "$entry" "$TARGET_HOME/" || { copy_status=$?; break; }
    else
      cp -a -- "$entry" "$TARGET_HOME/" || { copy_status=$?; break; }
    fi
  done
  shopt -u nullglob dotglob
  mkdir -p "$TARGET_HOME/backups"
  chown "$TARGET_UID:$TARGET_GID" "$TARGET_HOME/backups"
else
  if cp --help 2>/dev/null | grep -q -- '--reflink'; then
    cp -a --reflink=auto "$SOURCE_HOME/." "$TARGET_HOME/" || copy_status=$?
  else
    cp -a "$SOURCE_HOME/." "$TARGET_HOME/" || copy_status=$?
  fi
fi
stop_copy_progress
if (( copy_status != 0 )); then
  echo "xDrive migration: copy failed after $(( SECONDS - copy_started_at ))s; rolling back to root deployment." >&2
  exit "$copy_status"
fi
printf '[xDrive] copy complete: 100%%, elapsed %ds\n' "$(( SECONDS - copy_started_at ))"

[[ -f "$TARGET_ENV" && -f "$TARGET_COMPOSE" ]] || {
  echo "xDrive migration: copied deployment is incomplete." >&2
  exit 1
}
# Rewrite every xDrive-managed host bind/runtime path. Earlier migrations
# converted only four storage paths and left Caddy assets, GeoNames snapshots
# and optional worker runtime directories pointing into /root/.xd.
# A later non-root update then
# failed at stage 4 when it tried to mkdir those inaccessible old paths.
# Custom external paths remain unchanged; rewrite_data_path only substitutes
# the old deployment's exact SOURCE_HOME prefix.
for key in XD_FILES_DATA_DIR XD_POSTGRES_DATA_DIR XD_CADDY_DATA_DIR XD_CADDY_CONFIG_DIR \
           XD_CADDY_ASSET_DIR XD_GEONAMES_HOST_DIR XD_MEDIA_WORKER_RUNTIME_DIR \
           XD_PHOTO_FACE_RUNTIME_DIR; do
  rewrite_data_path "$key"
done
set_env_file "$TARGET_ENV" XD_DOCKER_MODE "$TARGET_DOCKER_MODE"

chown "$TARGET_UID:$TARGET_GID" "$TARGET_HOME" "$TARGET_HOME/data" 2>/dev/null || true
for owned_path in "$TARGET_CONFIG" "$TARGET_BIN" "$TARGET_HOME/backups" "$TARGET_LOG" "$TARGET_STATE"; do
  [[ -e "$owned_path" ]] && chown -R "$TARGET_UID:$TARGET_GID" "$owned_path"
done
if [[ "$TARGET_DOCKER_MODE" == "rootless" && -d "$TARGET_HOME/data" ]]; then
  # Rootless Docker must be able to traverse the copied bind mounts. Container
  # entrypoints/storage-init will normalize service-specific mapped ownership.
  chown -R "$TARGET_UID:$TARGET_GID" "$TARGET_HOME/data"
fi
chmod 700 "$TARGET_HOME" "$TARGET_CONFIG" "$TARGET_BIN" "$TARGET_STATE" "$TARGET_LOG" 2>/dev/null || true
chmod 600 "$TARGET_ENV"

# Docker Compose may retain a previously completed storage-init container
# across ownership/host-layout changes. Explicitly run the copied deployment's
# root-owned, image-provided one-shot preparer with the TARGET .env/mount,
# before the Server can access CAS. The preparer owns the UID/GID/marker
# contract; do not chown the entire host data tree to TARGET_USER.
echo "[xDrive] preparing copied file storage for Server container ownership..."
server_storage_uid="$(env_value "$TARGET_ENV" XD_SERVER_UID | tr -d '\r')"
server_storage_gid="$(env_value "$TARGET_ENV" XD_SERVER_GID | tr -d '\r')"
server_storage_uid="${server_storage_uid:-65532}"
server_storage_gid="${server_storage_gid:-65532}"
if [[ ! "$server_storage_uid" =~ ^[0-9]+$ || ! "$server_storage_gid" =~ ^[0-9]+$ ]]; then
  echo "xDrive migration: invalid Server storage UID/GID; refusing to start the new Server." >&2
  exit 1
fi
# Copied markers are not evidence of the copied tree's current ownership.
# Rootless mapping and staged host-user copies can change every cached file.
if ! target_compose run -T --rm --no-deps storage-init storage prepare --force \
    --uid "$server_storage_uid" --gid "$server_storage_gid"; then
  echo "xDrive migration: target file storage initialization failed; refusing to start the new Server and restoring the original deployment." >&2
  exit 1
fi

echo "[xDrive] starting the copied deployment as $TARGET_USER..."
target_compose up -d --remove-orphans
TARGET_STARTED=1

healthy=0
for _ in $(seq 1 60); do
  if target_compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "xDrive migration: target-user deployment did not become healthy." >&2
  exit 1
fi

legacy_link="/usr/local/bin/xdrive-server"
if [[ -L "$legacy_link" ]]; then
  legacy_target="$(readlink -f "$legacy_link" 2>/dev/null || true)"
  if [[ "$legacy_target" == "$SOURCE_HOME/bin/xdrive-server" || "$legacy_target" == "$TARGET_MANAGER" ]]; then
    rm -f "$legacy_link"
    echo "[xDrive] removed legacy system-wide xdrive-server link: $legacy_link"
  fi
fi

mkdir -p "$TARGET_STATE"
cat > "$TARGET_STATE/migrated-from-root" <<EOF
source_home=$SOURCE_HOME
target_home=$TARGET_HOME
target_user=$TARGET_USER
migrated_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chown "$TARGET_UID:$TARGET_GID" "$TARGET_STATE/migrated-from-root"
chmod 600 "$TARGET_STATE/migrated-from-root"
if [[ "$DEFER_BACKUPS" == "1" ]]; then
  cat > "$TARGET_STATE/migration-backups-pending" <<EOF
source_home=$SOURCE_HOME
target_home=$TARGET_HOME
backups_source=$SOURCE_HOME/backups
EOF
  chown "$TARGET_UID:$TARGET_GID" "$TARGET_STATE/migration-backups-pending"
  chmod 600 "$TARGET_STATE/migration-backups-pending"
fi

CRON_CHANGED=1
install_target_backup_schedule
remove_root_backup_schedule
write_target_path

MIGRATION_COMMITTED=1
rm -f "${ROOT_CRON_SNAPSHOT:-}" "${TARGET_CRON_SNAPSHOT:-}" 2>/dev/null || true
trap - EXIT INT TERM

echo
echo "[xDrive] migration completed successfully."
echo "Active deployment: $TARGET_HOME"
echo "Original root copy retained: $SOURCE_HOME"
if [[ "$DEFER_BACKUPS" == "1" ]]; then
  echo "Historical backup archives were deferred; they remain only in $SOURCE_HOME/backups."
  printf '[xDrive] to import historical backups later as root: %q migrate-user %q --backups-only\n' "$SOURCE_HOME/bin/xdrive-server" "$TARGET_USER"
  echo "Do not delete the original root copy before backup history import is complete."
fi
echo "Command path was added to: $TARGET_SHELL_RC"
echo
echo "Open a new login shell as $TARGET_USER, or in an already-open target-user shell run:"
printf '  source %q\n' "$TARGET_SHELL_RC"
echo
echo "Then verify:"
echo "  xdrive-server status"
echo "  xdrive-server doctor"
echo
if [[ "$DEFER_BACKUPS" != "1" ]]; then
  echo "After verifying the migrated deployment and backups, the original root copy may be removed manually:"
  printf '  rm -rf -- %q\n' "$SOURCE_HOME"
else
  echo "The original root copy must be kept until deferred backup import and verification have finished."
fi
