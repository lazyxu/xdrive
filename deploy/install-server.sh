#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

CONFIG_DIR="${XD_CONFIG_DIR:-$HOME/.xd}"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
CADDY_PATH="$CONFIG_DIR/Caddyfile"
ENV_PATH="$CONFIG_DIR/.env"
SOURCE_REF="${XD_SOURCE_REF:-@SOURCE_REF@}"
IMAGE_TAG="${XD_IMAGE_TAG:-@IMAGE_TAG@}"
BUILT_CHANNEL="${XD_BUILT_CHANNEL:-@RELEASE_CHANNEL@}"
BUILT_COMMIT="${XD_BUILT_COMMIT:-@RELEASE_COMMIT@}"
REPOSITORY="${XD_GITHUB_REPOSITORY:-lazyxu/xdrive}"
STAGING_DIR="$CONFIG_DIR/.install-staging"

STAGE_TOTAL=9
STAGE_NO=0
CURRENT_STAGE="startup"
LAST_ERROR_COMMAND=""

stage() {
  STAGE_NO="$1"
  CURRENT_STAGE="$2"
  printf '\n[xDrive] [%s/%s] %s\n' "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE"
}

trap 'LAST_ERROR_COMMAND="${BASH_COMMAND:-unknown}"' ERR
on_exit() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    printf '\n[xDrive] FAILED at stage %s/%s: %s (exit %s)\n' \
      "$STAGE_NO" "$STAGE_TOTAL" "$CURRENT_STAGE" "$status" >&2
  fi
}
trap on_exit EXIT

usage() {
  cat <<'USAGE'
xDrive server installer

Usage:
  install-server.sh [--channel stable|master|commit] [--commit SHA]

Channels:
  stable  Latest successful vMAJOR.MINOR.PATCH release.
  master  Latest fully successful master snapshot.
  commit  Pin to a specified successfully published master commit.

The selected channel is persisted in ~/.xd/.env and reused on later updates.
USAGE
}

requested_channel="${XD_INSTALL_CHANNEL:-}"
requested_commit="${XD_INSTALL_COMMIT:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel)
      [[ $# -ge 2 ]] || { echo "--channel requires a value" >&2; exit 2; }
      requested_channel="$2"; shift 2 ;;
    --commit)
      [[ $# -ge 2 ]] || { echo "--commit requires a SHA" >&2; exit 2; }
      requested_commit="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

existing_env_value() {
  local key="$1"
  [[ -f "$ENV_PATH" ]] || return 0
  grep "^$key=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

if [[ -z "$requested_channel" && -n "$requested_commit" ]]; then
  requested_channel="commit"
fi
if [[ -z "$requested_channel" ]]; then
  requested_channel="$(existing_env_value XD_RELEASE_CHANNEL)"
fi
if [[ -z "$requested_channel" ]]; then
  legacy_image="$(existing_env_value XD_SERVER_IMAGE)"
  case "$legacy_image" in
    *:edge|*:sha-*) requested_channel="master" ;;
    *:v[0-9]*|*:latest) requested_channel="stable" ;;
  esac
fi
if [[ -z "$requested_channel" ]]; then
  if [[ "$BUILT_CHANNEL" != "@RELEASE_CHANNEL@" && -n "$BUILT_CHANNEL" ]]; then
    requested_channel="$BUILT_CHANNEL"
  else
    # The raw master bootstrap is a template, not a stable release artifact.
    # Follow the latest fully successful published master snapshot so the
    # canonical one-line install works before the first vMAJOR.MINOR.PATCH.
    requested_channel="master"
  fi
fi
requested_channel="$(printf '%s' "$requested_channel" | tr '[:upper:]' '[:lower:]')"
case "$requested_channel" in
  stable|master|commit) ;;
  snapshot) requested_channel="master" ;;
  *) echo "invalid channel: $requested_channel (expected stable, master, or commit)" >&2; exit 2 ;;
esac

if [[ "$requested_channel" == "commit" && -z "$requested_commit" ]]; then
  requested_commit="$(existing_env_value XD_RELEASE_COMMIT)"
  if [[ -z "$requested_commit" && "$BUILT_COMMIT" != "@RELEASE_COMMIT@" ]]; then
    requested_commit="$BUILT_COMMIT"
  fi
fi

format_bytes() {
  awk -v bytes="${1:-0}" 'BEGIN {
    split("B KiB MiB GiB TiB", unit, " ");
    n = bytes + 0; i = 1;
    while (n >= 1024 && i < 5) { n /= 1024; i++ }
    if (i == 1) printf "%.0f %s", n, unit[i]; else printf "%.1f %s", n, unit[i]
  }'
}

host_rx_bytes() {
  [[ -r /proc/net/dev ]] || return 1
  awk 'NR > 2 {
    iface=$1; gsub(":", "", iface);
    if (iface != "lo") total += $2
  } END { printf "%.0f\n", total + 0 }' /proc/net/dev
}

monitor_host_rx() {
  local label="$1" start prev now current delta elapsed
  [[ -t 2 ]] || return 0
  prev="$(host_rx_bytes 2>/dev/null || true)"
  [[ -n "$prev" ]] || return 0
  start="$(date +%s)"
  while true; do
    sleep 2
    current="$(host_rx_bytes 2>/dev/null || true)"
    [[ -n "$current" ]] || return 0
    now="$(date +%s)"
    delta=$(( current - prev ))
    (( delta < 0 )) && delta=0
    elapsed=$(( now - start ))
    printf '[xDrive] %s | current host RX: %s/s | elapsed: %ss\n'       "$label" "$(format_bytes $(( delta / 2 )))" "$elapsed" >&2
    prev="$current"
  done
}

fetch() {
  local url="$1" destination="$2" label="${3:-$(basename "$2")}" tmp="$2.tmp"
  local stats size speed seconds monitor_pid=""
  rm -f "$tmp"
  printf '[xDrive] download: %s\n' "$label"
  if command -v curl >/dev/null 2>&1; then
    monitor_host_rx "download $label" &
    monitor_pid=$!
    if ! stats="$(curl -fsSL --retry=3 --retry-delay=1 --connect-timeout=15       --write-out='%{size_download}\t%{speed_download}\t%{time_total}'       "$url" -o "$tmp")"; then
      [[ -n "$monitor_pid" ]] && kill "$monitor_pid" >/dev/null 2>&1 || true
      [[ -n "$monitor_pid" ]] && wait "$monitor_pid" 2>/dev/null || true
      rm -f "$tmp"
      return 1
    fi
    [[ -n "$monitor_pid" ]] && kill "$monitor_pid" >/dev/null 2>&1 || true
    [[ -n "$monitor_pid" ]] && wait "$monitor_pid" 2>/dev/null || true
    IFS=$'\t' read -r size speed seconds <<< "$stats"
    if [[ -n "${size:-}" && -n "${speed:-}" && -n "${seconds:-}" ]]; then
      printf '[xDrive] downloaded: %s | %s | avg %s/s | %ss\n'         "$label" "$(format_bytes "$size")" "$(format_bytes "$speed")" "$seconds"
    else
      printf '[xDrive] downloaded: %s\n' "$label"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget --progress=bar:force:noscroll -O "$tmp" "$url"; then
      rm -f "$tmp"
      return 1
    fi
    printf '[xDrive] downloaded: %s\n' "$label"
  else
    echo "xDrive server installer: curl or wget is required." >&2
    return 1
  fi
  mv "$tmp" "$destination"
}

fetch_stdout() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    echo "xDrive server installer: curl or wget is required." >&2
    exit 1
  fi
}

resolve_commit() {
  local ref="$1" json full
  [[ "$ref" =~ ^[0-9A-Fa-f]{7,40}$ ]] || {
    echo "xDrive server installer: commit must be 7-40 hexadecimal characters." >&2
    return 1
  }
  if ! json="$(fetch_stdout "https://api.github.com/repos/$REPOSITORY/commits/$ref")"; then
    echo "xDrive server installer: could not query commit $ref." >&2
    return 1
  fi
  full="$(printf '%s\n' "$json" | sed -nE 's/^[[:space:]]*"sha":[[:space:]]*"([0-9a-fA-F]{40})".*/\1/p' | head -n1 | tr '[:upper:]' '[:lower:]')"
  [[ ${#full} -eq 40 ]] || {
    echo "xDrive server installer: could not resolve commit $ref." >&2
    return 1
  }
  printf '%s\n' "$full"
}

resolve_published_master() {
  local json full immutable_tag
  if ! json="$(fetch_stdout "https://api.github.com/repos/$REPOSITORY/git/ref/tags/snapshot")"; then
    echo "xDrive server installer: could not resolve the rolling master snapshot." >&2
    return 1
  fi
  full="$(printf '%s\n' "$json" | sed -nE 's/^[[:space:]]*"sha":[[:space:]]*"([0-9a-fA-F]{40})".*/\1/p' | head -n1 | tr '[:upper:]' '[:lower:]')"
  [[ ${#full} -eq 40 ]] || {
    echo "xDrive server installer: rolling snapshot did not resolve to a commit." >&2
    return 1
  }
  immutable_tag="snapshot-${full:0:12}"
  if ! fetch_stdout "https://api.github.com/repos/$REPOSITORY/releases/tags/$immutable_tag" >/dev/null; then
    echo "xDrive server installer: $immutable_tag is not fully published yet; retry after the master build completes." >&2
    return 1
  fi
  printf '%s\n' "$full"
}

resolve_latest_stable_tag() {
  local json tag
  if ! json="$(fetch_stdout "https://api.github.com/repos/$REPOSITORY/releases/latest")"; then
    echo "xDrive server installer: no stable release is available." >&2
    return 1
  fi
  tag="$(printf '%s\n' "$json" | sed -nE 's/^[[:space:]]*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -n1)"
  [[ -n "$tag" ]] || {
    echo "xDrive server installer: latest stable release has no tag." >&2
    return 1
  }
  printf '%s\n' "$tag"
}

verify_published_commit() {
  local full="$1" tag="snapshot-${1:0:12}"
  if ! fetch_stdout "https://api.github.com/repos/$REPOSITORY/releases/tags/$tag" >/dev/null; then
    echo "xDrive server installer: commit $full has no successful published snapshot ($tag)." >&2
    return 1
  fi
}

resolve_install_source() {
  local channel="$1" commit="$2" full tag
  case "$channel" in
    master)
      full="$(resolve_published_master)"
      SOURCE_REF="$full"
      IMAGE_TAG="sha-${full:0:12}"
      BUILT_CHANNEL="master"
      BUILT_COMMIT="$full"
      echo "Resolved latest fully published master snapshot: ${full:0:12}"
      ;;
    stable)
      tag="$(resolve_latest_stable_tag)"
      SOURCE_REF="$tag"
      IMAGE_TAG="$tag"
      BUILT_CHANNEL="stable"
      BUILT_COMMIT=""
      echo "Resolved stable release: $tag"
      ;;
    commit)
      [[ -n "$commit" ]] || {
        echo "xDrive server installer: --channel commit requires --commit SHA." >&2
        return 1
      }
      full="$(resolve_commit "$commit")"
      verify_published_commit "$full"
      SOURCE_REF="$full"
      IMAGE_TAG="sha-${full:0:12}"
      BUILT_CHANNEL="commit"
      BUILT_COMMIT="$full"
      requested_commit="$full"
      echo "Resolved published commit: ${full:0:12}"
      ;;
  esac
}

artifact_is_template=false
if [[ "$SOURCE_REF" == "@SOURCE_REF@" || "$IMAGE_TAG" == "@IMAGE_TAG@" ]]; then
  artifact_is_template=true
fi

stage 1 "resolve release channel"
needs_source_resolution=false
if [[ "$artifact_is_template" == "true" || "$requested_channel" != "$BUILT_CHANNEL" ]]; then
  needs_source_resolution=true
elif [[ "$requested_channel" == "commit" && -n "$requested_commit" && "$requested_commit" != "$BUILT_COMMIT" ]]; then
  needs_source_resolution=true
fi

if [[ "$needs_source_resolution" == "true" ]]; then
  resolve_install_source "$requested_channel" "$requested_commit"
else
  echo "Using packaged release source: $SOURCE_REF"
fi

if [[ "$SOURCE_REF" == "@SOURCE_REF@" || "$IMAGE_TAG" == "@IMAGE_TAG@" ]]; then
  echo "xDrive server installer: release source resolution left template placeholders unresolved." >&2
  exit 1
fi
echo "Release source: $SOURCE_REF"
echo "Container image tag: $IMAGE_TAG"
need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "xDrive server installer: missing required command: $1" >&2
    exit 1
  }
}

stage 2 "validate host prerequisites"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "xDrive server installer: current published images support Linux amd64 only." >&2; exit 1 ;;
esac

need docker
if ! docker compose version >/dev/null 2>&1; then
  echo "xDrive server installer: Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi

stage 3 "download deployment assets"
mkdir -p "$CONFIG_DIR" "$STAGING_DIR"
chmod 700 "$CONFIG_DIR" "$STAGING_DIR"

raw_base="https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_REF"
fetch "$raw_base/deploy/docker-compose.yml" "$STAGING_DIR/docker-compose.yml" "1/6 docker-compose.yml"
fetch "$raw_base/deploy/Caddyfile" "$STAGING_DIR/Caddyfile" "2/6 Caddyfile"
asset_no=2
for maintenance_script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh; do
  asset_no=$((asset_no + 1))
  fetch "$raw_base/scripts/$maintenance_script" "$STAGING_DIR/$maintenance_script" "$asset_no/6 $maintenance_script"
  chmod 700 "$STAGING_DIR/$maintenance_script"
done
chmod 600 "$STAGING_DIR/docker-compose.yml" "$STAGING_DIR/Caddyfile"

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$bytes" <<'PY'
import secrets, sys
print(secrets.token_hex(int(sys.argv[1])))
PY
  else
    od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

ensure_env() {
  local key="$1" value="$2"
  if ! grep -q "^${key}=" "$ENV_PATH" 2>/dev/null; then printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"; fi
}

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_PATH" 2>/dev/null; then
    local tmp="$ENV_PATH.tmp"
    awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k{print k "=" v; next} {print}' "$ENV_PATH" > "$tmp"
    mv "$tmp" "$ENV_PATH"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"
  fi
}

env_value() {
  local key="$1" value
  value="$(grep "^${key}=" "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s\n' "$value"
}

managed_container_id() {
  local service="$1" conventional id
  conventional="xdrive-${service}-1"

  # The compose project is explicitly named xdrive, so prefer the stable
  # container name. This also works for older deployments whose compose labels
  # may be missing or differ from the current project metadata.
  if docker inspect "$conventional" >/dev/null 2>&1; then
    printf '%s\n' "$conventional"
    return 0
  fi

  # Fall back to Compose discovery when the conventional name is unavailable.
  if [[ -f "$COMPOSE_PATH" ]]; then
    id="$(docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" ps -aq "$service" 2>/dev/null | head -n1 || true)"
    if [[ -n "$id" ]]; then
      printf '%s\n' "$id"
      return 0
    fi
  fi

  docker ps -aq \
    --filter "label=com.docker.compose.project=xdrive" \
    --filter "label=com.docker.compose.service=$service" 2>/dev/null | head -n1
}

container_env_value() {
  local container_id="$1" key="$2"
  [[ -n "$container_id" ]] || return 0
  docker inspect "$container_id" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n "s/^${key}=//p" | tail -n1
}

wait_existing_postgres() {
  local container_id="$1" i
  if [[ "$(docker inspect "$container_id" --format '{{.State.Running}}' 2>/dev/null || true)" != "true" ]]; then
    docker start "$container_id" >/dev/null
  fi
  for i in $(seq 1 30); do
    if docker exec "$container_id" pg_isready -h 127.0.0.1 -U xdrive -d xdrive >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "xDrive server installer: existing PostgreSQL container did not become ready." >&2
  return 1
}

postgres_password_works() {
  local container_id="$1" password="$2"
  [[ -n "$password" ]] || return 1

  # Do not probe 127.0.0.1 here: an old pg_hba.conf can trust loopback while
  # still requiring SCRAM on the Docker bridge, which would make a bad password
  # look valid. Connect to the container's bridge address instead, matching the
  # authentication path used by the xDrive server container.
  docker exec -e "PGPASSWORD=$password" "$container_id" sh -ec '
    set -- $(hostname -i)
    [ "$#" -gt 0 ]
    exec psql -h "$1" -U xdrive -d xdrive -Atqc "SELECT 1"
  ' >/dev/null 2>&1
}

repair_postgres_password_via_local_socket() {
  local container_id="$1" password="$2"
  [[ -n "$password" ]] || return 1
  docker exec "$container_id" psql -U xdrive -d xdrive -Atqc 'SELECT 1' >/dev/null 2>&1 || return 1
  docker exec -i "$container_id" \
    psql -U xdrive -d xdrive -v ON_ERROR_STOP=1 -v "password_value=$password" >/dev/null <<'SQL'
ALTER ROLE xdrive WITH PASSWORD :'password_value';
SQL
}

recover_existing_runtime_secrets() {
  [[ -f "$COMPOSE_PATH" ]] || return 0

  local postgres_id server_id configured_pg runtime_pg candidate configured_jwt runtime_jwt
  postgres_id="$(managed_container_id postgres)"
  server_id="$(managed_container_id server)"

  if [[ -n "$postgres_id" ]]; then
    wait_existing_postgres "$postgres_id"
    configured_pg="$(env_value POSTGRES_PASSWORD)"
    runtime_pg="$(container_env_value "$postgres_id" POSTGRES_PASSWORD)"

    if postgres_password_works "$postgres_id" "$configured_pg"; then
      :
    elif postgres_password_works "$postgres_id" "$runtime_pg"; then
      set_env POSTGRES_PASSWORD "$runtime_pg"
      echo "Recovered PostgreSQL password from the existing xDrive container and verified Docker-network authentication."
    else
      candidate="$configured_pg"
      [[ -n "$candidate" ]] || candidate="$runtime_pg"
      if [[ -z "$candidate" ]]; then
        candidate="$(random_hex 24)"
      fi

      if repair_postgres_password_via_local_socket "$postgres_id" "$candidate" \
          && postgres_password_works "$postgres_id" "$candidate"; then
        set_env POSTGRES_PASSWORD "$candidate"
        echo "Repaired the managed PostgreSQL role password to match xDrive configuration and verified Docker-network authentication."
      else
        cat >&2 <<'MSG'
xDrive server installer: existing PostgreSQL credentials cannot be reconciled safely.
The database volume was left untouched. Repair the xdrive role password or restore the
previous POSTGRES_PASSWORD in ~/.xd/.env, then rerun the installer.
MSG
        return 1
      fi
    fi
  fi

  configured_jwt="$(env_value XD_JWT_SECRET)"
  if [[ -z "$configured_jwt" && -n "$server_id" ]]; then
    runtime_jwt="$(container_env_value "$server_id" XD_JWT_SECRET)"
    if [[ -n "$runtime_jwt" ]]; then
      set_env XD_JWT_SECRET "$runtime_jwt"
      echo "Recovered JWT secret from the existing xDrive server container."
    fi
  fi
}


validate_domain() {
  local value="$1"
  if [[ -z "$value" ]]; then
    return 0
  fi
  if [[ "$value" == *"://"* || "$value" == *"/"* || "$value" == *":"* || "$value" == *" "* || "$value" == *".."* ]]; then
    echo "xDrive server installer: XD_DOMAIN must be a hostname only, for example drive.example.com." >&2
    return 1
  fi
  if [[ ! "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    echo "xDrive server installer: invalid XD_DOMAIN: $value" >&2
    return 1
  fi
}

validate_port() {
  local value="$1"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
    echo "xDrive server installer: XD_HTTPS_PORT must be an integer from 1 to 65535." >&2
    return 1
  fi
}

https_url() {
  local domain="$1" port="$2"
  if [[ "$port" == "443" ]]; then
    printf 'https://%s\n' "$domain"
  else
    printf 'https://%s:%s\n' "$domain" "$port"
  fi
}

stage 4 "prepare server configuration"
touch "$ENV_PATH"
chmod 600 "$ENV_PATH"
recover_existing_runtime_secrets
ensure_env POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-$(random_hex 24)}"
ensure_env XD_JWT_SECRET "${XD_JWT_SECRET:-$(random_hex 48)}"
ensure_env XD_ACCESS_TOKEN_TTL "${XD_ACCESS_TOKEN_TTL:-15m}"
ensure_env XD_REFRESH_TOKEN_TTL "${XD_REFRESH_TOKEN_TTL:-720h}"
ensure_env XD_WEB_BIND "${XD_WEB_BIND:-127.0.0.1}"
ensure_env XD_WEB_PORT "${XD_WEB_PORT:-3000}"
ensure_env XD_ALLOWED_ORIGIN "${XD_ALLOWED_ORIGIN:-http://localhost:3000}"
ensure_env XD_MAX_UPLOAD_BYTES "${XD_MAX_UPLOAD_BYTES:-21474836480}"
ensure_env XD_DOMAIN "${XD_DOMAIN:-}"
ensure_env XD_HTTPS_BIND "${XD_HTTPS_BIND:-0.0.0.0}"
ensure_env XD_HTTPS_PORT "${XD_HTTPS_PORT:-8443}"
ensure_env ALIYUN_ACCESS_KEY_ID "${ALIYUN_ACCESS_KEY_ID:-}"
ensure_env ALIYUN_ACCESS_KEY_SECRET "${ALIYUN_ACCESS_KEY_SECRET:-}"
ensure_env XD_POSTGRES_MEMORY_LIMIT "${XD_POSTGRES_MEMORY_LIMIT:-1g}"
ensure_env XD_POSTGRES_CPU_LIMIT "${XD_POSTGRES_CPU_LIMIT:-1.0}"
ensure_env XD_POSTGRES_PIDS_LIMIT "${XD_POSTGRES_PIDS_LIMIT:-256}"
ensure_env XD_SERVER_MEMORY_LIMIT "${XD_SERVER_MEMORY_LIMIT:-1g}"
ensure_env XD_SERVER_CPU_LIMIT "${XD_SERVER_CPU_LIMIT:-1.0}"
ensure_env XD_SERVER_PIDS_LIMIT "${XD_SERVER_PIDS_LIMIT:-256}"
ensure_env XD_WEB_MEMORY_LIMIT "${XD_WEB_MEMORY_LIMIT:-256m}"
ensure_env XD_WEB_CPU_LIMIT "${XD_WEB_CPU_LIMIT:-0.50}"
ensure_env XD_WEB_PIDS_LIMIT "${XD_WEB_PIDS_LIMIT:-128}"
ensure_env XD_CADDY_MEMORY_LIMIT "${XD_CADDY_MEMORY_LIMIT:-256m}"
ensure_env XD_CADDY_CPU_LIMIT "${XD_CADDY_CPU_LIMIT:-0.50}"
ensure_env XD_CADDY_PIDS_LIMIT "${XD_CADDY_PIDS_LIMIT:-128}"
ensure_env XD_LOG_MAX_SIZE "${XD_LOG_MAX_SIZE:-10m}"
ensure_env XD_LOG_MAX_FILES "${XD_LOG_MAX_FILES:-5}"
ensure_env XD_BACKUP_RETENTION_DAYS "${XD_BACKUP_RETENTION_DAYS:-7}"
ensure_env XD_BACKUP_SCHEDULE "${XD_BACKUP_SCHEDULE:-17 3 * * *}"
ensure_env XD_RELEASE_CHANNEL "$requested_channel"
ensure_env XD_RELEASE_COMMIT "${requested_commit:-}"
set_env XD_RELEASE_CHANNEL "$requested_channel"
if [[ "$requested_channel" == "commit" ]]; then
  set_env XD_RELEASE_COMMIT "$requested_commit"
else
  set_env XD_RELEASE_COMMIT ""
fi
domain="$(env_value XD_DOMAIN)"
https_port="$(env_value XD_HTTPS_PORT)"
validate_port "$https_port"
if [[ -z "$domain" && -r /dev/tty && -w /dev/tty && "${XD_NONINTERACTIVE:-0}" != "1" ]]; then
  read -r -p "Public domain for DNS-01 HTTPS (blank for HTTP/private mode): " input_domain </dev/tty || true
  domain="${input_domain:-}"
  if [[ -n "$domain" ]]; then
    domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
    validate_domain "$domain"
    set_env XD_DOMAIN "$domain"
  fi
fi

if [[ -n "$domain" ]]; then
  validate_domain "$domain"
  alidns_key_id="$(env_value ALIYUN_ACCESS_KEY_ID)"
  alidns_key_secret="$(env_value ALIYUN_ACCESS_KEY_SECRET)"
  if [[ -z "$alidns_key_id" || -z "$alidns_key_secret" ]]; then
    if [[ -r /dev/tty && -w /dev/tty && "${XD_NONINTERACTIVE:-0}" != "1" ]]; then
      if [[ -z "$alidns_key_id" ]]; then
        read -r -p "AliDNS AccessKey ID: " alidns_key_id </dev/tty
        [[ -n "$alidns_key_id" ]] || { echo "AliDNS AccessKey ID cannot be empty." >&2; exit 1; }
        set_env ALIYUN_ACCESS_KEY_ID "$alidns_key_id"
      fi
      if [[ -z "$alidns_key_secret" ]]; then
        read -r -s -p "AliDNS AccessKey Secret: " alidns_key_secret </dev/tty
        printf '\n' >/dev/tty
        [[ -n "$alidns_key_secret" ]] || { echo "AliDNS AccessKey Secret cannot be empty." >&2; exit 1; }
        set_env ALIYUN_ACCESS_KEY_SECRET "$alidns_key_secret"
      fi
    else
      echo "xDrive server installer: XD_DOMAIN requires ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET for DNS-01 HTTPS." >&2
      exit 1
    fi
  fi
  public_url="$(https_url "$domain" "$https_port")"
  set_env XD_ALLOWED_ORIGIN "$public_url"
  set_env XD_WEB_BIND "127.0.0.1"
else
  # HTTP/private mode remains directly reachable on XD_WEB_PORT.
  if [[ "$(env_value XD_WEB_BIND)" == "127.0.0.1" && "${XD_KEEP_LOOPBACK_HTTP:-0}" != "1" ]]; then
    set_env XD_WEB_BIND "0.0.0.0"
  fi
fi

stage 5 "create pre-upgrade backup"
# Upgrade safety: take a backup with the currently installed deployment before
# replacing compose/scripts or switching image tags. If an older installation
# predates the maintenance scripts, use the freshly staged backup tool against
# the old compose/env files. A failed backup aborts the upgrade.
if [[ -f "$COMPOSE_PATH" ]]; then
  if docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" ps -q server 2>/dev/null | grep -q .; then
    backup_tool="$CONFIG_DIR/server-backup.sh"
    if [[ ! -x "$backup_tool" ]]; then
      backup_tool="$STAGING_DIR/server-backup.sh"
    fi
    echo "Existing xDrive deployment detected; creating pre-upgrade backup..."
    "$backup_tool" --config-dir "$CONFIG_DIR" --output-dir "$CONFIG_DIR/pre-upgrade-backups"
  fi
fi

stage 6 "install deployment files"
# Only point at the new release images after the old deployment has been
# backed up successfully. This keeps pre-upgrade verification on the exact
# server/Web version that owns the current database and blob layout.
set_env XD_SERVER_IMAGE "ghcr.io/lazyxu/xdrive-server:$IMAGE_TAG"
set_env XD_WEB_IMAGE "ghcr.io/lazyxu/xdrive-web:$IMAGE_TAG"
set_env XD_CADDY_IMAGE "ghcr.io/lazyxu/xdrive-caddy:$IMAGE_TAG"

install -m 600 "$STAGING_DIR/docker-compose.yml" "$COMPOSE_PATH"
install -m 600 "$STAGING_DIR/Caddyfile" "$CADDY_PATH"
for maintenance_script in server-backup.sh server-backup-scheduled.sh server-restore.sh server-verify.sh; do
  install -m 700 "$STAGING_DIR/$maintenance_script" "$CONFIG_DIR/$maintenance_script"
done
rm -rf "$STAGING_DIR"

compose() {
  if [[ -n "$(env_value XD_DOMAIN)" ]]; then
    docker compose --profile https --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  else
    docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
  fi
}

install_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || {
    echo "Backup schedule: crontab is unavailable; run $CONFIG_DIR/server-backup-scheduled.sh from your scheduler."
    return 0
  }
  local schedule existing tmp
  schedule="$(env_value XD_BACKUP_SCHEDULE)"
  [[ -n "$schedule" ]] || return 0
  existing="$(crontab -l 2>/dev/null || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$existing" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  printf '%s XD_CONFIG_DIR=%q %q >> %q 2>&1 # xdrive-managed-backup\n' \
    "$schedule" "$CONFIG_DIR" "$CONFIG_DIR/server-backup-scheduled.sh" "$CONFIG_DIR/backup.log" >> "$tmp"
  crontab "$tmp"
  rm -f "$tmp"
  echo "Backup schedule installed: $schedule; retention $(env_value XD_BACKUP_RETENTION_DAYS) days."
}

echo "xDrive compose: $COMPOSE_PATH"
echo "xDrive env:     $ENV_PATH"

if [[ "${XD_INSTALL_NO_START:-0}" == "1" ]]; then
  stage 9 "complete"
  echo "Files installed without starting containers."
  exit 0
fi

stage 7 "pull images and start services"
echo "[xDrive] pulling container images (plain layer progress; no animated/ANSI progress bar)..."
pull_started="$(date +%s)"
pull_monitor_pid=""
monitor_host_rx "container image pull" &
pull_monitor_pid=$!
if ! compose --progress plain pull; then
  [[ -n "$pull_monitor_pid" ]] && kill "$pull_monitor_pid" >/dev/null 2>&1 || true
  [[ -n "$pull_monitor_pid" ]] && wait "$pull_monitor_pid" 2>/dev/null || true
  cat >&2 <<'MSG'
xDrive server installer: container pull failed.
Make the xdrive-server, xdrive-web, and xdrive-caddy packages Public in GitHub package settings,
or authenticate first with: docker login ghcr.io
MSG
  exit 1
fi
[[ -n "$pull_monitor_pid" ]] && kill "$pull_monitor_pid" >/dev/null 2>&1 || true
[[ -n "$pull_monitor_pid" ]] && wait "$pull_monitor_pid" 2>/dev/null || true
echo "[xDrive] container image pull complete in $(( $(date +%s) - pull_started ))s."
compose up -d --remove-orphans

stage 8 "verify service health"
healthy=0
for _ in $(seq 1 60); do
  if compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "xDrive server did not become healthy. Recent logs:" >&2
  compose logs --tail=100 postgres server web >&2 || true
  exit 1
fi

wait_https() {
  local domain="$1" port="$2" attempt
  local bind probe_ip url
  bind="$(env_value XD_HTTPS_BIND)"
  probe_ip="127.0.0.1"
  if [[ -n "$bind" && "$bind" != "0.0.0.0" && "$bind" != "::" ]]; then
    probe_ip="$bind"
  fi
  url="$(https_url "$domain" "$port")"

  echo "Waiting for AliDNS DNS-01 certificate and HTTPS readiness on port $port..."
  for attempt in $(seq 1 90); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS --max-time 8 --resolve "$domain:$port:$probe_ip" "$url/api/v1/healthz" >/dev/null 2>&1; then
        echo "HTTPS ready: $url"
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q --timeout=8 --spider "$url/api/v1/healthz" >/dev/null 2>&1; then
        echo "HTTPS ready: $url"
        return 0
      fi
    fi
    sleep 2
  done

  echo "xDrive HTTPS did not become ready." >&2
  echo "Confirm AliDNS credentials can edit TXT records, the domain resolves to this server, and inbound TCP $port reaches it." >&2
  echo "DNS-01 certificate issuance does not require inbound TCP 80 or 443." >&2
  compose logs --tail=120 caddy web server >&2 || true
  return 1
}

if [[ -n "$(env_value XD_DOMAIN)" ]]; then
  wait_https "$(env_value XD_DOMAIN)" "$(env_value XD_HTTPS_PORT)"
fi

stage 9 "finalize installation"
compose ps
install_backup_schedule

if ! compose exec -T server xdrive-server admin exists >/dev/null 2>&1; then
  echo
  echo "xDrive requires an administrator account before users can sign in."
  if [[ -r /dev/tty && -w /dev/tty ]]; then
    admin_username="admin"
    read -r -p "Administrator username [admin]: " input_username </dev/tty || true
    [[ -n "${input_username:-}" ]] && admin_username="$input_username"
    while true; do
      read -r -s -p "Administrator password: " admin_password </dev/tty || true; printf '\n' >/dev/tty
      read -r -s -p "Confirm administrator password: " admin_password_confirm </dev/tty || true; printf '\n' >/dev/tty
      if [[ "$admin_password" == "$admin_password_confirm" && -n "$admin_password" ]]; then break; fi
      echo "Passwords did not match; try again." >/dev/tty
    done
    printf '%s\n' "$admin_password" | compose exec -T server xdrive-server admin create --username "$admin_username" --password-stdin
    unset admin_password admin_password_confirm
  else
    echo "Create the first administrator with:"
    echo "  read -s -p 'Admin password: ' P; echo; printf '%s\\n' \"\$P\" | docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' exec -T server xdrive-server admin create --username admin --password-stdin; unset P"
  fi
fi

echo
if [[ -n "$(env_value XD_DOMAIN)" ]]; then
  public_url="$(https_url "$(env_value XD_DOMAIN)" "$(env_value XD_HTTPS_PORT)")"
  echo "xDrive is running at: $public_url"
  echo "TLS mode: AliDNS DNS-01; inbound TCP $(env_value XD_HTTPS_PORT) must reach this server. Ports 80/443 are not required for ACME."
else
  echo "xDrive is running in HTTP/private mode on port $(env_value XD_WEB_PORT)."
fi
echo "Backup now:      $CONFIG_DIR/server-backup.sh"
echo "Restore:         $CONFIG_DIR/server-restore.sh"
echo "Verify storage:  $CONFIG_DIR/server-verify.sh"
echo "Release channel: $(env_value XD_RELEASE_CHANNEL)${requested_commit:+ ($requested_commit)}"
echo "Manage: docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' <command>"
