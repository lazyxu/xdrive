#!/usr/bin/env bash
set -u
umask 077

DOCTOR_ORIGINAL_ARGS=("$@")
XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
CONFIG_DIR=""
DATA_DIR=""
STATE_DIR=""
COMPOSE_PATH=""
ENV_PATH=""
STRICT=0
PROFILE=fast
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

usage() {
  cat <<'EOF'
Usage: server-doctor.sh [--config-dir DIR] [--fast|--deep] [--strict]

Generates a read-only, automatically redacted xDrive server diagnostic report.
--fast (default) runs bounded health probes without traversing files, contacting
external update hosts, or collecting container logs. --deep additionally checks
external connectivity and recent logs, with longer probe timeouts. Neither mode
reads Blob contents or computes SHA-256; use storage verify separately.
--strict returns non-zero when one or more checks fail.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) XDRIVE_HOME="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    --fast) PROFILE=fast; shift ;;
    --deep) PROFILE=deep; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

CONFIG_DIR="$XDRIVE_HOME/config"
DATA_DIR="$XDRIVE_HOME/data"
STATE_DIR="$XDRIVE_HOME/state"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"

# GNU timeout is required: never silently fall back to a potentially hanging
# Docker/Server probe. Docker and metadata timeouts are per invocation.
if ! command -v timeout >/dev/null 2>&1; then
  echo "xdrive-server doctor: GNU timeout is required for bounded diagnostics" >&2
  exit 2
fi

# A bounded Docker invocation is not a bounded diagnostic report: several
# independently stalled probes could accumulate. Apply a whole-report
# watchdog, including the installation summary and cleanup. An incomplete
# report must exit nonzero even without --strict, never masquerade as healthy.
if [[ "${XD_DOCTOR_BUDGET_CHILD:-0}" != "1" ]]; then
  FAST_BUDGET_SECONDS=30
  DEEP_BUDGET_SECONDS=180
  report_budget="$FAST_BUDGET_SECONDS"
  [[ "$PROFILE" == deep ]] && report_budget="$DEEP_BUDGET_SECONDS"
  report_status=0
  XD_DOCTOR_BUDGET_CHILD=1 timeout --signal=TERM --kill-after=2s "${report_budget}s" \
    bash "$0" "${DOCTOR_ORIGINAL_ARGS[@]}" || report_status=$?
  if [[ "$report_status" -eq 124 || "$report_status" -eq 137 ]]; then
    printf '[WARN] doctor total timeout: diagnostic incomplete after %ss (profile=%s; not a PASS)\n' \
      "$report_budget" "$PROFILE" >&2
  fi
  exit "$report_status"
fi

DOCKER_PROBE_SECONDS=6
CAS_TIMEOUT_SECONDS=4
WITNESS_TIMEOUT_SECONDS=5
VERSION_TIMEOUT_SECONDS=5
SUMMARY_TIMEOUT_SECONDS=5
if [[ "$PROFILE" == deep ]]; then
  DOCKER_PROBE_SECONDS=15
  CAS_TIMEOUT_SECONDS=30
  WITNESS_TIMEOUT_SECONDS=15
  VERSION_TIMEOUT_SECONDS=10
  SUMMARY_TIMEOUT_SECONDS=10
fi
bounded() {
  local seconds="$1"
  shift
  timeout --signal=TERM --kill-after=2s "${seconds}s" "$@" </dev/null
}
docker_probe() {
  bounded "$DOCKER_PROBE_SECONDS" docker "$@"
}

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
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
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

# Fixed host file *metadata only*. Never read potentially credential-bearing
# snapshot contents or print operator-defined paths, domains, PIDs or hashes.
# All output belongs to a small nonsecret status vocabulary.
caddy_host_meta_state() {
  local dir="$1" filename="$2" file modified now
  [[ -d "$dir" && ! -L "$dir" ]] || { printf 'directory-unavailable\n'; return; }
  file="$dir/$filename"
  [[ ! -L "$file" ]] || { printf 'invalid-file\n'; return; }
  if [[ ! -e "$file" ]]; then
    printf 'missing\n'
    return
  fi
  [[ -f "$file" ]] || { printf 'invalid-file\n'; return; }
  modified="$(stat -c %Y -- "$file" 2>/dev/null)" || { printf 'unreadable\n'; return; }
  now="$(date +%s)" || { printf 'unreadable\n'; return; }
  [[ "$modified" =~ ^[0-9]{1,12}$ && "$now" =~ ^[0-9]{1,12}$ ]] ||
    { printf 'invalid-time\n'; return; }
  if (( modified < now - 45 || modified > now + 15 )); then
    printf 'stale\n'
  else
    printf 'fresh\n'
  fi
}

# Strictly read-only fixed Docker Server /host-control mount comparison.
# Output only a fixed reason; no actual mount path, Docker ID or env contents.
caddy_bridge_mount_state() {
  local host="$1" id raw src actual expected
  [[ -d "$host" && ! -L "$host" ]] || { echo host-directory-unavailable; return; }
  id="$(compose ps -q server 2>/dev/null | head -n1 || true)"
  [[ -n "$id" ]] || { echo server-container-unavailable; return; }
  raw="$(bounded 4 docker inspect --format '{{range .Mounts}}{{if eq .Destination "/host-control"}}{{.Type}}|{{.Source}}|{{.RW}}{{end}}{{end}}' "$id" 2>/dev/null)" || { echo docker-inspect-unavailable; return; }
  [[ -n "$raw" ]] || { echo mount-missing; return; }
  case "$raw" in
    bind\|/*\|true) ;;
    bind\|/*\|false) echo mount-read-only; return ;;
    *) echo mount-invalid; return ;;
  esac
  src="${raw#bind|}"
  src="${src%|true}"
  [[ "$src" != *"|"* && "$src" != *$'\n'* ]] || { echo mount-invalid; return; }
  expected="$(readlink -f -- "$host" 2>/dev/null)" || { echo host-directory-unavailable; return; }
  actual="$(readlink -f -- "$src" 2>/dev/null)" || { echo mount-source-mismatch; return; }
  if [[ "$actual" == "$expected" ]]; then echo matched-metadata-only
  else echo mount-source-mismatch; fi
}

# Numeric host GID is advisory with Rootless or userns remapping;
# only a running Server witness proves actual bridge readability.
caddy_bridge_group_hint() {
  local host="$1" gid expected
  [[ -d "$host" && ! -L "$host" ]] || { echo unknown; return; }
  [[ "$docker_mode" != rootless ]] || { echo rootless-userns-check-server; return; }
  gid="$(stat -c %g -- "$host" 2>/dev/null)" || { echo unknown; return; }
  expected="$(env_value XD_SERVER_GID)"
  [[ "$expected" =~ ^[0-9]{1,10}$ ]] || expected=65532
  if [[ "$gid" == "$expected" ]]; then echo group-matched-not-proof
  else echo group-mismatch; fi
}

# Never print CLI output: it may be an old binary or unexpected data.
caddy_running_server_revision_state() {
  local expected raw actual
  expected="$(env_value XD_RELEASE_COMMIT)"
  raw="$(set -o pipefail; bounded "$VERSION_TIMEOUT_SECONDS" docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" exec -T server xdrive-server version 2>/dev/null | head -c 2048)" ||
    { echo running-version-unavailable; return; }
  actual="$(printf '%s\n' "$raw" | LC_ALL=C sed -nE 's/^commit: ([0-9a-f]{40})$/\1/p' | head -n1)"
  [[ "$actual" =~ ^[0-9a-f]{40}$ ]] || { echo running-commit-unavailable; return; }
  [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || { echo running-commit-unpinned; return; }
  if [[ "$actual" == "$expected" ]]; then echo matches-pinned-commit
  else echo running-commit-mismatch; fi
}

compose() {
  docker_probe compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
}

container_report() {
  local service="$1" id state health image
  id="$(compose ps -q "$service" 2>/dev/null | head -n1 || true)"
  if [[ -z "$id" ]]; then
    record FAIL "container $service" "container not found"
    return
  fi
  state="$(docker_probe inspect "$id" --format '{{.State.Status}}' </dev/null 2>/dev/null || true)"
  health="$(docker_probe inspect "$id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' </dev/null 2>/dev/null || true)"
  image="$(docker_probe inspect "$id" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
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
  info="$(docker_probe inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{if .Name}}volume={{.Name}}{{else}}bind={{.Source}}{{end}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
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
echo "profile: $PROFILE (Blob file traversal and SHA-256 verification are not part of doctor)"
echo
echo "---- installation environment ----"
summary_manager="$XDRIVE_HOME/bin/xdrive-server"
if [[ -x "$summary_manager" ]]; then
  if ! (set -o pipefail; XD_STATUS_REDACT_HOME=1 XD_CONFIG_DIR="$XDRIVE_HOME" bounded "$SUMMARY_TIMEOUT_SECONDS" "$summary_manager" status --summary-only 2>/dev/null | redact_stream); then
    record WARN "environment summary" "host manager summary failed; continuing with detailed diagnostics"
  fi
else
  record WARN "environment summary" "host manager missing at $(safe_path "$summary_manager"); detailed diagnostics follow"
fi
echo

if command -v docker >/dev/null 2>&1; then
  record PASS "Docker" "$(docker_probe --version </dev/null 2>/dev/null || echo installed)"
  if docker_probe info </dev/null >/dev/null 2>&1; then
    security_options="$(docker_probe info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
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

if docker_probe compose version </dev/null >/dev/null 2>&1; then
  record PASS "Docker Compose" "$(docker_probe compose version </dev/null 2>/dev/null | head -n1)"
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
  server_id="$(compose ps -q server 2>/dev/null | head -n1 || true)"
  pg_password="$(env_value POSTGRES_PASSWORD)"
  pg_image=""
  if [[ -n "$pg_id" ]]; then
    pg_image="$(docker_probe inspect "$pg_id" --format '{{.Image}}' </dev/null 2>/dev/null || true)"
  fi
  # The DB container's own IP and the Server's actual network path can have
  # different pg_hba.conf rules. Verify using the PostgreSQL image as a
  # temporary client attached to the live Server namespace, with no DB mounts.
  if [[ -z "$pg_id" || -z "$pg_password" ]]; then
    record FAIL "PostgreSQL auth" "PostgreSQL container or configured password unavailable"
  elif [[ -z "$server_id" ||
       "$(docker_probe inspect "$server_id" --format '{{.State.Running}}' </dev/null 2>/dev/null || true)" != "true" ]]; then
    record WARN "PostgreSQL auth" "Server is not running; cannot verify its actual database connection path"
  elif [[ ! "$pg_image" =~ ^sha256:[[:xdigit:]]{64}$ ]]; then
    record FAIL "PostgreSQL auth" "local PostgreSQL client image is unavailable; no password conclusion"
  elif PGPASSWORD="$pg_password" docker_probe run --rm --pull never --network "container:$server_id" \
      --entrypoint psql -e PGPASSWORD -e PGCONNECT_TIMEOUT=5 "$pg_image" \
      -h postgres -U xdrive -d xdrive -Atqc 'SELECT 1' </dev/null >/dev/null 2>&1; then
    record PASS "PostgreSQL auth" "xdrive role authenticates from the live Server network"
  else
    record FAIL "PostgreSQL auth" "Server-network login probe failed; check credentials, Docker network and local client availability"
  fi

  # storage health checks CAS *database references*, not Blob bytes. Even this
  # SQL can grow expensive on large libraries, so fail open on a time limit.
  cas_health=""
  cas_health_status=0
  cas_health="$(bounded "$CAS_TIMEOUT_SECONDS" docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" exec -T server xdrive-server storage health 2>&1)" || cas_health_status=$?
  if [[ "$cas_health_status" -eq 124 || "$cas_health_status" -eq 137 ]]; then
    record WARN "CAS metadata health" "timed out after ${CAS_TIMEOUT_SECONDS}s; incomplete, run doctor --deep"
  elif [[ "$cas_health_status" -ne 0 ]]; then
    record FAIL "CAS metadata health" "Server storage health command failed (exit=$cas_health_status)"
  elif [[ "$cas_health" == *"status=warning"* ]]; then
    record WARN "CAS metadata health" "$cas_health"
  elif [[ "$cas_health" == *"cas metadata health: status=ok"* ]]; then
    record PASS "CAS metadata health" "$cas_health"
  else
    record WARN "CAS metadata health" "unrecognized Server health output; check Server version"
  fi

  volume_report postgres /var/lib/postgresql/data
  volume_report server /data
  volume_report caddy /data
  volume_report caddy /config

  # Distinguish host producer failure from a running Server mount mismatch.
  # Presence/freshness alone does NOT verify contents, Docker health or TLS.
  caddy_host_dir="$(env_value XD_HOST_CONTROL_HOST_DIR)"
  [[ -n "$caddy_host_dir" ]] || caddy_host_dir="$STATE_DIR/control"
  caddy_host_heartbeat_state="$(caddy_host_meta_state "$caddy_host_dir" heartbeat)"
  caddy_host_snapshot_state="$(caddy_host_meta_state "$caddy_host_dir" caddy-runtime-status.json)"
  caddy_host_env_state="$(caddy_host_meta_state "$caddy_host_dir" caddy-env-observed.json)"
  caddy_mount_state="$(caddy_bridge_mount_state "$caddy_host_dir")"
  if [[ "$caddy_mount_state" == matched-metadata-only ]]; then
    record PASS "Caddy Server mount" "fixed host bridge bind matches running Server (metadata only)"
  else
    record WARN "Caddy Server mount" "reason=$caddy_mount_state; inspect fixed /host-control bind without touching Caddy"
  fi
  caddy_group_hint="$(caddy_bridge_group_hint "$caddy_host_dir")"
  caddy_running_rev="$(caddy_running_server_revision_state)"
  if [[ "$caddy_running_rev" == matches-pinned-commit ]]; then
    record PASS "Caddy Server revision" "running Server matches pinned deployment commit (not latest release proof)"
  else
    record WARN "Caddy Server revision" "reason=$caddy_running_rev; compare running Server image to deployed release"
  fi
  if [[ "$caddy_host_heartbeat_state" == fresh && "$caddy_host_snapshot_state" == fresh ]]; then
    record PASS "Caddy Host producer" "host heartbeat=fresh snapshot=fresh (metadata only; Server and TLS separately checked)"
  else
    record WARN "Caddy Host producer" "host heartbeat=$caddy_host_heartbeat_state snapshot=$caddy_host_snapshot_state (metadata only)"
  fi

  if [[ "$caddy_host_env_state" == fresh ]]; then
    record PASS "Caddy config snapshot" "host .env observed=fresh (metadata only; Server JSON validation is separate)"
  else
    record WARN "Caddy config snapshot" "host .env observed=$caddy_host_env_state; missing/stale snapshot makes HTTPS and AliDNS admin reads return HTTP 503"
  fi

  # Same actual Server mount and reader as the Admin UI; never infer
  # observability from a healthy Caddy alone. Avoid printing untrusted CLI
  # output, which an older or misrouted binary might fill with secrets.
  caddy_witness_verified=0
  caddy_witness_output=""
  caddy_witness_status=0
  caddy_witness_output="$(bounded "$WITNESS_TIMEOUT_SECONDS" docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" exec -T server xdrive-server caddy-host witness-check 2>/dev/null)" || caddy_witness_status=$?
  if [[ "$caddy_witness_status" -eq 0 && "$caddy_witness_output" == "Caddy local observation: local-https-observed" ]]; then
    record PASS "Caddy Host witness" "running Server sees fresh local HTTPS evidence (not WAN or applied-revision proof)"
    caddy_witness_verified=1
  else
    if [[ "$caddy_witness_status" -eq 124 || "$caddy_witness_status" -eq 137 ]]; then
      caddy_witness_reason="witness-timeout"
    else
      caddy_witness_reason="$(printf '%s' "$caddy_witness_output" | sed -n 's/^Caddy local observation: //p')"
    fi
    case "$caddy_witness_reason" in
      witness-timeout|control-not-configured|heartbeat-missing|heartbeat-unreadable|heartbeat-invalid|heartbeat-stale|snapshot-missing|snapshot-unreadable|snapshot-invalid|snapshot-stale|snapshot-invalid-or-changing|gateway-healthy|gateway-unhealthy|gateway-starting|gateway-running-unverified|gateway-stopped|gateway-unknown|https-not-configured|domain-tls-unverified|lan-tls-unverified)
        ;;
      *) caddy_witness_reason="unsupported-or-unavailable-server-witness" ;;
    esac
    record WARN "Caddy Host witness" "reason=$caddy_witness_reason; verify Host Control producer and running Server /host-control mount; does NOT mean Caddy is uninstalled"
    # The two observers are independent: only correlate fixed reason codes.
    # Neither a fresh host file nor its name proves live Caddy or HTTPS.
    case "$caddy_witness_reason:$caddy_host_snapshot_state" in
      snapshot-missing:fresh|snapshot-unreadable:fresh|snapshot-invalid-or-changing:fresh)
        record WARN "Caddy Host correlation" "host-snapshot-present-server-unreadable; verify the running Server /host-control bind mount and GID"
        ;;
      snapshot-missing:missing|snapshot-missing:directory-unavailable)
        record WARN "Caddy Host correlation" "host-snapshot-not-produced; check Host Control sampler without restarting Caddy"
        ;;
      snapshot-stale:stale)
        record WARN "Caddy Host correlation" "host-snapshot-stale; check Host Control sampler cadence"
        ;;
      unsupported-or-unavailable-server-witness:*|witness-timeout:*)
        record WARN "Caddy Host correlation" "running-server-witness-cli-unavailable; verify deployed Server image version"
        ;;
    esac
  fi
  # A numeric GID mismatch alone is not proof of failed access; require a
  # fresh witness on the exact bind mount before clearing the advisory warning.
  if [[ "$caddy_group_hint" == group-matched-not-proof ]]; then
    record PASS "Caddy bridge access" "numeric GID matches (not proof of running Server read access)"
  elif [[ "$caddy_witness_verified" == 1 && "$caddy_mount_state" == matched-metadata-only ]]; then
    record PASS "Caddy bridge access" "running Server verified fixed Host Control access despite numeric GID mismatch"
  else
    record WARN "Caddy bridge access" "reason=$caddy_group_hint; verify standard Unix group ownership/modes and Docker Rootless/userns mapping"
  fi
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

legacy_volumes="$(docker_probe volume ls -q --filter 'label=com.docker.compose.project=xdrive' 2>/dev/null | grep -E '(_|^)(postgres-data|file-data|caddy-data|caddy-config)$' || true)"
if [[ -n "$legacy_volumes" ]]; then
  record WARN "legacy volumes" "$(printf '%s' "$legacy_volumes" | tr '\n' ' ') retained for migration safety"
fi

if command -v df >/dev/null 2>&1; then
  df_line="$(df -hP "$XDRIVE_HOME" 2>/dev/null | tail -n1 || true)"
  [[ -n "$df_line" ]] && record PASS "xDrive disk" "$df_line" || record WARN "xDrive disk" "unable to read filesystem usage"
  docker_root="$(docker_probe info --format '{{.DockerRootDir}}' </dev/null 2>/dev/null || true)"
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
  local_https_seconds=4
  [[ "$PROFILE" == deep ]] && local_https_seconds=8
  if command -v curl >/dev/null 2>&1 && curl -fsS --connect-timeout 2 --max-time "$local_https_seconds" --resolve "$domain:$port:$probe_ip" "$url/api/v1/readyz" >/dev/null 2>&1; then
    record PASS "TLS/local HTTPS" "$url certificate and readiness endpoint verified"
  else
    record FAIL "TLS/local HTTPS" "$url failed certificate/readiness verification"
  fi
  if [[ "$PROFILE" == deep ]]; then
    if command -v curl >/dev/null 2>&1 && curl -fsS --connect-timeout 5 --max-time 8 "$url/api/v1/readyz" >/dev/null 2>&1; then
      record PASS "public HTTPS" "$url reachable through normal DNS/routing"
    else
      record WARN "public HTTPS" "$url not reachable from this host through normal DNS/routing"
    fi
  else
    record SKIP "public HTTPS" "fast profile; run doctor --deep for public DNS/routing"
  fi
else
  record WARN "TLS" "XD_DOMAIN is empty; server is in HTTP/private mode"
fi

shell_proxy=0
[[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]] && shell_proxy=1
docker_proxy="$(docker_probe info --format '{{.HTTPSProxy}}' </dev/null 2>/dev/null || true)"
if [[ "$shell_proxy" == "1" && -z "$docker_proxy" ]]; then
  record WARN "Docker HTTPS proxy" "shell HTTPS_PROXY is set but Docker daemon proxy is empty; registry pulls may bypass the shell proxy"
elif [[ -n "$docker_proxy" ]]; then
  record PASS "Docker HTTPS proxy" "configured in Docker daemon"
else
  record PASS "Docker HTTPS proxy" "not configured; Docker uses direct registry access"
fi

if [[ "$PROFILE" == deep ]] && command -v curl >/dev/null 2>&1; then
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
elif [[ "$PROFILE" == deep ]]; then
  record WARN "external network" "curl unavailable; update-provider network checks skipped"
else
  record SKIP "external network" "fast profile; run doctor --deep for update-provider connectivity"
fi

if [[ "$PROFILE" == deep ]]; then
  echo
  echo "---- recent container logs (last 100 lines, redacted) ----"
  if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]] && command -v docker >/dev/null 2>&1; then
    services=(postgres server worker caddy)
    (set -o pipefail; compose logs --tail=100 --no-color "${services[@]}" 2>&1 | redact_stream) ||
      record WARN "container logs" "could not read logs before timeout"
  else
    record SKIP "container logs" "Docker/Compose configuration incomplete"
  fi
else
  record SKIP "container logs" "fast profile; run doctor --deep for recent logs"
fi

echo
echo "summary: $PASS_COUNT pass, $WARN_COUNT warn, $FAIL_COUNT fail, $SKIP_COUNT skip"
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "doctor result: usable; review warnings if present"
else
  echo "doctor result: attention required"
fi

if [[ "$STRICT" == "1" && "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
exit 0
