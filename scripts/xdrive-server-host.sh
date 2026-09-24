#!/usr/bin/env bash
set -euo pipefail
umask 077

REPOSITORY="${XD_REPOSITORY:-lazyxu/xdrive}"
INSTALLER_URL="${XD_INSTALLER_URL:-https://raw.githubusercontent.com/$REPOSITORY/master/deploy/install-server.sh}"

resolve_self() {
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "${BASH_SOURCE[0]}" 2>/dev/null && return 0
  fi
  printf '%s\n' "${BASH_SOURCE[0]}"
}

SELF_PATH="$(resolve_self)"
DEFAULT_CONFIG_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"
CONFIG_DIR="${XD_CONFIG_DIR:-$DEFAULT_CONFIG_DIR}"
ENV_PATH="$CONFIG_DIR/.env"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"

usage() {
  cat <<'EOF'
xDrive server host manager

Usage:
  xdrive-server update [--channel stable|master|commit] [--commit SHA]
  xdrive-server doctor [--strict]
  xdrive-server status
  xdrive-server backup [server-backup.sh options...]
  xdrive-server restore BACKUP_DIR [server-restore.sh options...]
  xdrive-server verify
  xdrive-server admin list
  xdrive-server admin reset-password USER [--no-must-change]
  xdrive-server admin reset-password USER --password-stdin [--no-must-change]
  xdrive-server admin enable USER
  xdrive-server admin disable USER
  xdrive-server version

This command runs on the Docker host. It manages ~/.xd and the xDrive
containers; it is not the xdrive-server API daemon inside the container.
EOF
}

env_value() {
  local key="$1" value
  [[ -f "$ENV_PATH" ]] || return 0
  value="$(grep "^$key=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s\n' "$value"
}

compose() {
  local domain
  domain="$(env_value XD_DOMAIN)"
  if [[ -n "$domain" ]]; then
    docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
  else
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
  fi
}

compose_with_stdin() {
  local domain
  domain="$(env_value XD_DOMAIN)"
  if [[ -n "$domain" ]]; then
    docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  else
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  fi
}

record_system_audit() {
  local action="$1" result="$2" target_id="${3:-}"
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || return 0

  local args=(audit record --action "$action" --result "$result")
  if [[ -n "$target_id" ]]; then
    args+=(--target-id "$target_id")
  fi

  if compose exec -T server xdrive-server "${args[@]}" >/dev/null 2>&1; then
    return 0
  fi
  if compose run --rm -T --no-deps server "${args[@]}" >/dev/null 2>&1; then
    return 0
  fi
  echo "xdrive-server: warning: could not persist audit event $action/$result" >&2
  return 0
}

download_installer() {
  local destination="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 10 \
      "$INSTALLER_URL" -o "$destination" </dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=5 --timeout=15 -O "$destination" "$INSTALLER_URL" </dev/null
  else
    echo "xdrive-server: curl or wget is required to update." >&2
    return 1
  fi
}

update_cmd() (
  local tmp installer status target_commit audit_target="" previous=""
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/xdrive-server-update.XXXXXX")"
  installer="$tmp/install-server.sh"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  for arg in "$@"; do
    case "$previous" in
      --commit) audit_target="$arg" ;;
      --channel) [[ -z "$audit_target" ]] && audit_target="$arg" ;;
    esac
    previous="$arg"
  done
  [[ -n "$audit_target" ]] || audit_target="$(env_value XD_RELEASE_CHANNEL)"

  echo "[xDrive] downloading host installer..."
  download_installer "$installer"
  chmod 700 "$installer"
  bash -n "$installer"
  echo "[xDrive] installer downloaded and syntax-checked."

  if [[ -t 0 && -r /dev/tty && -w /dev/tty ]]; then
    if bash "$installer" "$@" </dev/tty; then status=0; else status=$?; fi
  else
    if XD_NONINTERACTIVE=1 bash "$installer" "$@" </dev/null; then status=0; else status=$?; fi
  fi

  target_commit="$(env_value XD_RELEASE_COMMIT)"
  if [[ "$status" -eq 0 ]]; then
    [[ -n "$target_commit" ]] && audit_target="$target_commit"
    record_system_audit system.update success "$audit_target"
  else
    record_system_audit system.update failure "$audit_target"
  fi
  return "$status"
)

doctor_cmd() {
  local doctor="$CONFIG_DIR/server-doctor.sh"
  [[ -x "$doctor" ]] || {
    echo "xdrive-server: server doctor is not installed at $doctor" >&2
    return 1
  }
  XD_CONFIG_DIR="$CONFIG_DIR" exec "$doctor" "$@"
}

status_cmd() {
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: no xDrive deployment found in $CONFIG_DIR" >&2
    return 1
  }
  compose ps
}

backup_cmd() {
  local script="$CONFIG_DIR/server-backup.sh" status
  [[ -x "$script" ]] || {
    echo "xdrive-server: backup tool is not installed at $script" >&2
    return 1
  }
  if XD_CONFIG_DIR="$CONFIG_DIR" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$status" -eq 0 ]]; then
    record_system_audit system.backup success
  else
    record_system_audit system.backup failure
  fi
  return "$status"
}

restore_cmd() {
  local script="$CONFIG_DIR/server-restore.sh" status
  [[ -x "$script" ]] || {
    echo "xdrive-server: restore tool is not installed at $script" >&2
    return 1
  }
  if XD_CONFIG_DIR="$CONFIG_DIR" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$status" -eq 0 ]]; then
    record_system_audit system.restore success
  else
    record_system_audit system.restore failure
  fi
  return "$status"
}

verify_cmd() {
  local script="$CONFIG_DIR/server-verify.sh"
  [[ -x "$script" ]] || {
    echo "xdrive-server: verify tool is not installed at $script" >&2
    return 1
  }
  XD_CONFIG_DIR="$CONFIG_DIR" exec "$script" "$@"
}

admin_cmd() {
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: no xDrive deployment found in $CONFIG_DIR" >&2
    return 1
  }

  local subcommand="${1:-}"
  [[ -n "$subcommand" ]] || {
    echo "usage: xdrive-server admin <list|reset-password|enable|disable>" >&2
    return 2
  }
  shift || true

  case "$subcommand" in
    list)
      compose exec -T server xdrive-server admin list "$@"
      ;;
    enable|disable)
      compose exec -T server xdrive-server admin "$subcommand" "$@"
      ;;
    reset-password)
      local password_stdin=0 arg password confirm
      for arg in "$@"; do
        case "$arg" in
          --password-stdin)
            password_stdin=1
            ;;
          --password|--password=*)
            echo "xdrive-server: --password is not supported; use the interactive prompt or --password-stdin." >&2
            return 2
            ;;
        esac
      done

      if [[ "$password_stdin" == "1" ]]; then
        compose_with_stdin exec -T server xdrive-server admin reset-password "$@"
        return
      fi

      if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
        echo "xdrive-server: no interactive terminal; pass --password-stdin and provide the password on stdin." >&2
        return 2
      fi
      read -r -s -p "New password: " password </dev/tty
      printf '\n' >/dev/tty
      read -r -s -p "Confirm password: " confirm </dev/tty
      printf '\n' >/dev/tty
      if [[ -z "$password" ]]; then
        echo "xdrive-server: password is empty." >&2
        return 2
      fi
      if [[ "$password" != "$confirm" ]]; then
        echo "xdrive-server: passwords do not match." >&2
        return 2
      fi
      printf '%s\n' "$password" |
        compose_with_stdin exec -T server xdrive-server admin reset-password "$@" --password-stdin
      unset password confirm
      ;;
    *)
      echo "usage: xdrive-server admin <list|reset-password|enable|disable>" >&2
      return 2
      ;;
  esac
}

version_cmd() {
  local channel commit image
  channel="$(env_value XD_RELEASE_CHANNEL)"
  commit="$(env_value XD_RELEASE_COMMIT)"
  image="$(env_value XD_SERVER_IMAGE)"
  printf 'channel: %s\n' "${channel:-unknown}"
  [[ -n "$commit" ]] && printf 'commit: %s\n' "${commit:0:12}"
  [[ -n "$image" ]] && printf 'server image: %s\n' "$image"
}

cmd="${1:-}"
[[ -n "$cmd" ]] || { usage >&2; exit 2; }
shift || true

case "$cmd" in
  update) update_cmd "$@" ;;
  doctor) doctor_cmd "$@" ;;
  status) status_cmd "$@" ;;
  backup) backup_cmd "$@" ;;
  restore) restore_cmd "$@" ;;
  verify) verify_cmd ;;
  admin) admin_cmd "$@" ;;
  version) version_cmd ;;
  -h|--help|help) usage ;;
  *) echo "xdrive-server: unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
