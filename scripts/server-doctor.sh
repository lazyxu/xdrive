#!/usr/bin/env bash
set -u
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR=""
DATA_DIR=""
STATE_DIR=""
COMPOSE_PATH=""
ENV_PATH=""
STRICT=0
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

usage() {
  cat <<'EOF'
Usage: server-doctor.sh [--config-dir DIR] [--strict]

Generates a read-only, automatically redacted xDrive server diagnostic report.
By default diagnostics do not change configuration, restart containers, or
modify data. --strict returns non-zero when one or more checks fail.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) XDRIVE_HOME="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

CONFIG_DIR="$XDRIVE_HOME/config"
DATA_DIR="$XDRIVE_HOME/data"
STATE_DIR="$XDRIVE_HOME/state"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"

safe_path() {
  local value="$1"
  if [[ -n "${HOME:-}" && "$value" == "$HOME"* ]]; then
    printf '~%s' "${value#$HOME}"
  else
    printf '%s' "$value"
  fi
}

format_bytes() {
  awk -v bytes="${1:-0}" 'BEGIN {
    split("B KiB MiB GiB TiB PiB EiB", unit, " ");
    n = bytes + 0; i = 1;
    while (n >= 1024 && i < 7) { n /= 1024; i++ }
    if (i == 1) printf "%.0f %s", n, unit[i]; else printf "%.1f %s", n, unit[i]
  }'
}

redact_stream() {
  local home_re=""
  local -a args
  args=(
    -E
    -e 's#(postgres://[^:/[:space:]]+:)[^@[:space:]]+@#\1<redacted>@#g'
    -e 's#([Aa]uthorization:?[[:space:]]*[Bb]earer[[:space:]]+)[^[:space:]]+#\1<redacted>#g'
    -e 's#((refresh|access)[_-]?[Tt]oken[=:][[:space:]]*)[^ ,;&"]+#\1<redacted>#g'
    -e 's#((XD_JWT_SECRET|POSTGRES_PASSWORD|ALIYUN_ACCESS_KEY_SECRET)[=:][[:space:]]*)[^ ,;&"]+#\1<redacted>#g'
    -e 's#(https?://)[^/@[:space:]]+:[^/@[:space:]]+@#\1<redacted>@#g'
    -e 's#[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}#<session-id>#g'
  )
  if [[ -n "${HOME:-}" ]]; then
    home_re="$(printf '%s' "$HOME" | sed 's/[][\\.^$*+?(){}|]/\\&/g')"
    args+=(-e "s#$home_re#~#g")
  fi
  sed "${args[@]}"
}

record() {
  local status="$1" name="$2" detail="$3"
  detail="$(printf '%s' "$detail" | tr '\r\n' '  ' | redact_stream)"
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
  esac
  printf '[%s] %-22s %s\n' "$status" "$name" "$detail"
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
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

container_report() {
  local service="$1" id state health image
  id="$(compose ps -q "$service" 2>/dev/null | head -n1 || true)"
  if [[ -z "$id" ]]; then
    record FAIL "container $service" "container not found"
    return
  fi
  state="$(docker inspect "$id" --format '{{.State.Status}}' </dev/null 2>/dev/null || true)"
  health="$(docker inspect "$id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' </dev/null 2>/dev/null || true)"
  image="$(docker inspect "$id" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
  if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
    record PASS "container $service" "state=$state health=$health image=$image"
  else
    record FAIL "container $service" "state=${state:-unknown} health=${health:-unknown} image=${image:-unknown}"
  fi
}

volume_report() {
  local service="$1" destination="$2" id info
  id="$(compose ps -aq "$service" 2>/dev/null | head -n1 || true)"
  if [[ -z "$id" ]]; then
    record WARN "$service data mount" "container not found"
    return
  fi
  info="$(docker inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{if .Name}}volume={{.Name}}{{else}}bind={{.Source}}{{end}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
  if [[ -n "$info" ]]; then
    record PASS "$service data mount" "$info -> $destination"
  else
    record FAIL "$service data mount" "no mount found at $destination"
  fi
}

echo "xDrive server diagnostic report"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "home:   $(safe_path "$XDRIVE_HOME")"
echo "config: $(safe_path "$CONFIG_DIR")"
echo "redaction: passwords, JWTs, access/refresh tokens, Authorization headers and home paths are redacted"
echo
echo "---- installation environment ----"
summary_manager="$XDRIVE_HOME/bin/xdrive-server"
if [[ -x "$summary_manager" ]]; then
  if ! XD_STATUS_REDACT_HOME=1 XD_CONFIG_DIR="$XDRIVE_HOME" "$summary_manager" status --summary-only 2>/dev/null | redact_stream; then
    record WARN "environment summary" "host manager summary failed; continuing with detailed diagnostics"
  fi
else
  record WARN "environment summary" "host manager missing at $(safe_path "$summary_manager"); detailed diagnostics follow"
fi
echo

if command -v docker >/dev/null 2>&1; then
  record PASS "Docker" "$(docker --version </dev/null 2>/dev/null || echo installed)"
  if docker info </dev/null >/dev/null 2>&1; then
    security_options="$(docker info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
    if printf '%s' "$security_options" | grep -qi rootless; then
      docker_mode="rootless"
    else
      docker_mode="rootful"
    fi
    record PASS "Docker access" "user=$(id -un 2>/dev/null || id -u) uid=$(id -u) mode=$docker_mode; usable without sudo"
  else
    docker_mode="unknown"
    record FAIL "Docker access" "current user cannot query the Docker daemon without sudo"
  fi
else
  docker_mode="unavailable"
  record FAIL "Docker" "docker command not found"
fi

if docker compose version </dev/null >/dev/null 2>&1; then
  record PASS "Docker Compose" "$(docker compose version </dev/null 2>/dev/null | head -n1)"
else
  record FAIL "Docker Compose" "docker compose v2 unavailable"
fi

if [[ -f "$ENV_PATH" ]]; then
  mode="$(stat -c '%a' "$ENV_PATH" 2>/dev/null || true)"
  if [[ "$mode" == "600" ]]; then
    record PASS "environment file" "$(safe_path "$ENV_PATH") mode=600"
  else
    record WARN "environment file" "$(safe_path "$ENV_PATH") mode=${mode:-unknown}; expected 600"
  fi
else
  record FAIL "environment file" "missing $(safe_path "$ENV_PATH")"
fi

if [[ -f "$COMPOSE_PATH" ]]; then
  record PASS "compose file" "$(safe_path "$COMPOSE_PATH")"
else
  record FAIL "compose file" "missing $(safe_path "$COMPOSE_PATH")"
fi

update_source="$(env_value XD_UPDATE_SOURCE)"
[[ -n "$update_source" ]] || update_source="github"
channel="$(env_value XD_RELEASE_CHANNEL)"
commit="$(env_value XD_RELEASE_COMMIT)"
server_image="$(env_value XD_SERVER_IMAGE)"
release_detail="source=$update_source channel=${channel:-unknown}"
if [[ -n "$commit" ]]; then release_detail+=" commit=${commit:0:12}"; fi
if [[ -n "$server_image" ]]; then
  image_tag="${server_image##*:}"
  release_detail+=" server=$server_image"
  if [[ "$image_tag" == sha-* ]]; then
    release_detail+=" snapshot=${image_tag#sha-}"
  fi
fi
record PASS "release state" "$release_detail"

if command -v flock >/dev/null 2>&1; then
  exec 8>"$STATE_DIR/install.lock"
  if flock -n 8; then
    record PASS "install/update lock" "free"
    flock -u 8
  else
    record WARN "install/update lock" "currently held; install/update may be running"
  fi
  exec 8>&-
else
  record WARN "install/update lock" "flock command unavailable"
fi

if [[ -d "$STATE_DIR/upgrade-transaction" ]]; then
  record WARN "rollback state" "unfinished transaction state exists at $(safe_path "$STATE_DIR/upgrade-transaction")"
else
  record PASS "rollback state" "no unfinished transaction"
fi

if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] && command -v docker >/dev/null 2>&1; then
  for service in postgres server worker caddy; do
    container_report "$service"
  done

  pg_id="$(compose ps -q postgres 2>/dev/null | head -n1 || true)"
  pg_password="$(env_value POSTGRES_PASSWORD)"
  if [[ -n "$pg_id" && -n "$pg_password" ]]; then
    if docker exec -e "PGPASSWORD=$pg_password" "$pg_id" sh -ec '
      set -- $(hostname -i)
      [ "$#" -gt 0 ]
      exec psql -h "$1" -U xdrive -d xdrive -Atqc "SELECT 1"
    ' </dev/null >/dev/null 2>&1; then
      record PASS "PostgreSQL auth" "xdrive role authenticates over the Docker network"
    else
      record FAIL "PostgreSQL auth" "xdrive role password does not authenticate over the Docker network"
    fi
  else
    record FAIL "PostgreSQL auth" "PostgreSQL container or configured password unavailable"
  fi

  cas_health=""
  if cas_health="$(compose exec -T server xdrive-server storage health 2>&1)"; then
    if [[ "$cas_health" == *"status=warning"* ]]; then
      record WARN "CAS metadata health" "$cas_health"
    else
      record PASS "CAS metadata health" "$cas_health"
    fi
  else
    record FAIL "CAS metadata health" "${cas_health:-health command failed}"
  fi

  volume_report postgres /var/lib/postgresql/data
  volume_report server /data
  volume_report caddy /data
  volume_report caddy /config
fi

files_dir="$(env_value XD_FILES_DATA_DIR)"
postgres_dir="$(env_value XD_POSTGRES_DATA_DIR)"
caddy_data_dir="$(env_value XD_CADDY_DATA_DIR)"
caddy_config_dir="$(env_value XD_CADDY_CONFIG_DIR)"
[[ -n "$files_dir" ]] || files_dir="$DATA_DIR/files"
[[ -n "$postgres_dir" ]] || postgres_dir="$DATA_DIR/postgres"
[[ -n "$caddy_data_dir" ]] || caddy_data_dir="$DATA_DIR/caddy/data"
[[ -n "$caddy_config_dir" ]] || caddy_config_dir="$DATA_DIR/caddy/config"
for data_pair in   "files|$files_dir"   "postgres|$postgres_dir"   "caddy-data|$caddy_data_dir"   "caddy-config|$caddy_config_dir"; do
  data_name="${data_pair%%|*}"
  data_path="${data_pair#*|}"
  if [[ -d "$data_path" ]]; then
    record PASS "$data_name path" "$(safe_path "$data_path")"
  else
    record WARN "$data_name path" "$(safe_path "$data_path") is missing"
  fi
done

legacy_flat=0
for legacy_path in "$XDRIVE_HOME/.env" "$XDRIVE_HOME/docker-compose.yml" "$XDRIVE_HOME/Caddyfile" "$XDRIVE_HOME/xdrive-server"; do
  [[ -e "$legacy_path" ]] && legacy_flat=1
done
if [[ "$legacy_flat" == "1" ]]; then
  record WARN "legacy host layout" "flat files remain under $(safe_path "$XDRIVE_HOME"); current layout uses config/ and bin/"
else
  record PASS "host layout" "canonical config/bin/data/backups/logs/state layout"
fi

legacy_volumes="$(docker volume ls -q --filter 'label=com.docker.compose.project=xdrive' 2>/dev/null | grep -E '(_|^)(postgres-data|file-data|caddy-data|caddy-config)$' || true)"
if [[ -n "$legacy_volumes" ]]; then
  record WARN "legacy volumes" "$(printf '%s' "$legacy_volumes" | tr '\n' ' ') retained for migration safety"
fi

if command -v df >/dev/null 2>&1; then
  df_line="$(df -hP "$XDRIVE_HOME" 2>/dev/null | tail -n1 || true)"
  [[ -n "$df_line" ]] && record PASS "xDrive disk" "$df_line" || record WARN "xDrive disk" "unable to read filesystem usage"
  docker_root="$(docker info --format '{{.DockerRootDir}}' </dev/null 2>/dev/null || true)"
  if [[ -n "$docker_root" ]]; then
    root_line="$(df -hP "$docker_root" 2>/dev/null | tail -n1 || true)"
    [[ -n "$root_line" ]] && record PASS "Docker disk" "$root_line" || record WARN "Docker disk" "unable to read Docker filesystem usage"
  fi
fi

domain="$(env_value XD_DOMAIN)"
https_port="$(env_value XD_HTTPS_PORT)"
if [[ -n "$domain" ]]; then
  probe_ip="$(env_value XD_HTTPS_BIND)"
  if [[ -z "$probe_ip" || "$probe_ip" == "0.0.0.0" || "$probe_ip" == "::" ]]; then probe_ip="127.0.0.1"; fi
  port="${https_port:-8443}"
  url="https://$domain"
  [[ "$port" != "443" ]] && url+=":$port"
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 8 --resolve "$domain:$port:$probe_ip" "$url/api/v1/readyz" >/dev/null 2>&1; then
    record PASS "TLS/local HTTPS" "$url certificate and readiness endpoint verified"
  else
    record FAIL "TLS/local HTTPS" "$url failed certificate/readiness verification"
  fi
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 8 "$url/api/v1/readyz" >/dev/null 2>&1; then
    record PASS "public HTTPS" "$url reachable through normal DNS/routing"
  else
    record WARN "public HTTPS" "$url not reachable from this host through normal DNS/routing"
  fi
else
  record WARN "TLS" "XD_DOMAIN is empty; server is in HTTP/private mode"
fi

shell_proxy=0
[[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]] && shell_proxy=1
docker_proxy="$(docker info --format '{{.HTTPSProxy}}' </dev/null 2>/dev/null || true)"
if [[ "$shell_proxy" == "1" && -z "$docker_proxy" ]]; then
  record WARN "Docker HTTPS proxy" "shell HTTPS_PROXY is set but Docker daemon proxy is empty; registry pulls may bypass the shell proxy"
elif [[ -n "$docker_proxy" ]]; then
  record PASS "Docker HTTPS proxy" "configured in Docker daemon"
else
  record PASS "Docker HTTPS proxy" "not configured; Docker uses direct registry access"
fi

if command -v curl >/dev/null 2>&1; then
  external_http_check() {
    local name="$1" url="$2" result code remote connect tls total speed
    result="$(curl -sS -L --connect-timeout 5 --max-time 8 -o /dev/null \
      -w '%{http_code}\t%{remote_ip}\t%{time_connect}\t%{time_appconnect}\t%{time_total}\t%{speed_download}' \
      "$url" 2>/dev/null || true)"
    IFS=$'\t' read -r code remote connect tls total speed <<< "$result"
    if [[ -n "$code" && "$code" != "000" ]]; then
      record PASS "$name" "HTTP $code remote=${remote:-?} connect=${connect:-?}s tls=${tls:-?}s total=${total:-?}s avg=$(format_bytes "${speed:-0}")/s"
    else
      record WARN "$name" "$url unreachable or timed out"
    fi
  }

  if [[ "$update_source" == "gitlab" ]]; then
    gitlab_base="${XD_GITLAB_BASE_URL:-http://gitlab.t-fluid.com:1080}"
    external_http_check "GitLab Web" "${gitlab_base%/}/xuliang/xdrive"
    external_http_check "GitLab API" "${gitlab_base%/}/api/v4/projects/xuliang%2Fxdrive"
    image_registry="$(env_value XD_IMAGE_REGISTRY)"
    registry_host="${image_registry%%/*}"
    if [[ -n "$registry_host" ]]; then
      external_http_check "GitLab registry" "https://$registry_host/v2/"
    fi
  else
    external_http_check "GitHub API" "https://api.github.com/"
    external_http_check "GitHub Web" "https://github.com/"
    external_http_check "Release CDN" "https://release-assets.githubusercontent.com/"
    external_http_check "GHCR registry" "https://ghcr.io/v2/"
    external_http_check "Container CDN" "https://pkg-containers.githubusercontent.com/"
  fi
else
  record WARN "external network" "curl unavailable; update-provider network checks skipped"
fi

echo
echo "---- recent container logs (last 100 lines, redacted) ----"
if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] && command -v docker >/dev/null 2>&1; then
  services=(postgres server worker caddy)
  compose logs --tail=100 --no-color "${services[@]}" 2>&1 | redact_stream || true
else
  echo "logs unavailable because Docker/Compose configuration is incomplete"
fi

echo
echo "summary: $PASS_COUNT pass, $WARN_COUNT warn, $FAIL_COUNT fail"
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "doctor result: usable; review warnings if present"
else
  echo "doctor result: attention required"
fi

if [[ "$STRICT" == "1" && "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
