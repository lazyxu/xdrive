#!/usr/bin/env bash
set -euo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
BACKUP_DIR="$XDRIVE_HOME/backups/snapshots"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
# Version 1 tar backups remain the scheduled default. Version 2 is
# explicitly opted in through config/.env and never uses tar retention.
schedule_format="$(grep '^XD_BACKUP_SCHEDULE_FORMAT=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
schedule_format="${schedule_format:-v1}"
case "$schedule_format" in
  v1|v2) ;;
  *) echo "XD_BACKUP_SCHEDULE_FORMAT must be v1 or v2" >&2; exit 2 ;;
esac
repository_dir="$(grep '^XD_BACKUP_SCHEDULE_REPOSITORY_DIR=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
if [[ -n "$repository_dir" ]]; then
  [[ "$schedule_format" == "v2" ]] || {
    echo "XD_BACKUP_SCHEDULE_REPOSITORY_DIR requires v2" >&2
    exit 2
  }
  [[ "$repository_dir" == /* && ! -L "$repository_dir" ]] || {
    echo "XD_BACKUP_SCHEDULE_REPOSITORY_DIR must be an absolute non-symlink path" >&2
    exit 2
  }
fi
mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR"

lock_dir=""
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/scheduled-backup.lock"
  if ! flock -n 9; then
    echo "scheduled backup skipped: another backup is already running"
    exit 0
  fi
else
  lock_dir="$STATE_DIR/scheduled-backup.lock.d"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    echo "scheduled backup skipped: another backup is already running"
    exit 0
  fi
  trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT INT TERM
fi
if [[ "$schedule_format" == "v2" ]]; then
  # Shared immutable CAS objects can be referenced by multiple generations.
  # Until reference-aware GC exists, neither v2 snapshots nor repository
  # objects are ever removed by the scheduled wrapper.
  repo_args=()
  [[ -z "$repository_dir" ]] || repo_args=(--repository-dir "$repository_dir")
  if [[ -x "$BIN_DIR/xdrive-server" ]]; then
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/xdrive-server" backup --incremental "${repo_args[@]}"
  else
    "$BIN_DIR/server-backup.sh" --config-dir "$XDRIVE_HOME" --incremental "${repo_args[@]}"
  fi
else
  retention_days="$(grep '^XD_BACKUP_RETENTION_DAYS=' "$ENV_PATH" | tail -n1 | cut -d= -f2- || true)"
  retention_days="${retention_days:-7}"
  [[ "$retention_days" =~ ^[0-9]+$ ]] || { echo "XD_BACKUP_RETENTION_DAYS must be an integer" >&2; exit 1; }

  backup_dir="$BACKUP_DIR"
  if [[ -x "$BIN_DIR/xdrive-server" ]]; then
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/xdrive-server" backup --output-dir "$backup_dir"
  else
    "$BIN_DIR/server-backup.sh" --config-dir "$XDRIVE_HOME" --output-dir "$backup_dir"
  fi

  if (( retention_days > 0 )); then
    find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -mtime "+$retention_days" -print -exec rm -rf -- {} +
  fi
fi
