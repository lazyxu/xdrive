#!/usr/bin/env bash
set -euo pipefail
umask 077

REPOSITORY="${XD_REPOSITORY:-lazyxu/xdrive}"
GITLAB_BASE_URL="${XD_GITLAB_BASE_URL:-http://gitlab.t-fluid.com:1080}"
GITLAB_PROJECT="${XD_GITLAB_PROJECT:-xuliang/xdrive}"
GITLAB_LOCAL_FALLBACK_URL="${XD_GITLAB_LOCAL_FALLBACK_URL-http://127.0.0.1:1080}"
INSTALLER_URL_OVERRIDE="${XD_INSTALLER_URL:-}"

resolve_self() {
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "${BASH_SOURCE[0]}" 2>/dev/null && return 0
  fi
  printf '%s\n' "${BASH_SOURCE[0]}"
}

SELF_PATH="$(resolve_self)"
SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"
if [[ "$(basename "$SELF_DIR")" == "bin" ]]; then
  DEFAULT_XDRIVE_HOME="$(cd "$SELF_DIR/.." && pwd)"
else
  # Legacy flat installs placed xdrive-server directly in ~/.xd.
  DEFAULT_XDRIVE_HOME="$SELF_DIR"
fi
XDRIVE_HOME="${XD_CONFIG_DIR:-$DEFAULT_XDRIVE_HOME}"
CONFIG_DIR="$XDRIVE_HOME/config"
BIN_DIR="$XDRIVE_HOME/bin"
DATA_DIR="$XDRIVE_HOME/data"
BACKUP_DIR="$XDRIVE_HOME/backups"
LOG_DIR="$XDRIVE_HOME/logs"
STATE_DIR="$XDRIVE_HOME/state"
LEGACY_VOLUMES_RECORD="$STATE_DIR/legacy-volumes-retained"
ENV_PATH="$CONFIG_DIR/.env"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"

usage() {
  cat <<'EOF'
xDrive server host manager

Usage:
  xdrive-server update [--source github|gitlab] [--channel stable|master] [--backup-file-data]
  xdrive-server control <install|start|serve|stop|status>
  xdrive-server doctor [--strict]
  xdrive-server lan-ca export /absolute/path/root.crt
  xdrive-server status [--summary-only]
  xdrive-server backup [create] [server-backup.sh options...]
  xdrive-server backup --incremental [--repository-dir /absolute/local/path]
  xdrive-server backup list   # includes an active custom scheduled v2 repository
  xdrive-server backup verify [BACKUP_DIR]  # latest also searches configured v2 repository
  xdrive-server backup verify --json [BACKUP_DIR]  # structured snapshot + CAS result
  xdrive-server backup drill ABSOLUTE_V2_SNAPSHOT [--max-mib N]  # Host-only RAM rehearsal
  xdrive-server backup retention-plan [--repository-dir /absolute/local/path] [--keep-last N] [--mode fast|deep]
  xdrive-server backup prune --keep-last N --yes [--repository-dir /absolute/local/path]
  xdrive-server backup delete-snapshot --snapshot xdrive-backup-YYYYMMDDTHHMMSSZ --yes [--repository-dir PATH]
  xdrive-server backup preview-delete-snapshot --snapshot NAME [--mode fast|deep] [--repository-dir PATH]  # read-only
  xdrive-server backup sources BACKUP_DIR
  xdrive-server restore BACKUP_DIR [server-restore.sh options...]
  xdrive-server verify [--online] [--repair [--dry-run]]
  xdrive-server source verify [--json]
  xdrive-server media status [--json]
  xdrive-server media verify [--json]
  xdrive-server media repair [--json] [--dry-run] [--gc-thumbnails] [--gc-intelligence]
  xdrive-server migrate-user USER [--grant-docker-group|--no-grant-docker-group] [--defer-backups]
  xdrive-server migrate-user USER --backups-only
  xdrive-server cleanup legacy-volumes [--yes]
  xdrive-server uninstall [--purge-data] [--purge-backups] --yes
  xdrive-server admin list
  xdrive-server admin reset-password USER [--no-must-change]
  xdrive-server admin reset-password USER --password-stdin [--no-must-change]
  xdrive-server admin enable USER
  xdrive-server admin disable USER
  xdrive-server version

This command runs on the Docker host. It manages the xDrive home (default
~/.xd) and the xDrive containers; it is not the xdrive-server API daemon
inside the container.
EOF
}

detect_shell_rc() {
  local shell_name
  if [[ -n "${XD_SHELL_RC_PATH:-}" ]]; then
    printf '%s\n' "$XD_SHELL_RC_PATH"
    return
  fi
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash) printf '%s\n' "$HOME/.bashrc" ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

remove_user_command_path() {
  local rc tmp begin end
  rc="$(detect_shell_rc)"
  [[ -f "$rc" ]] || return 0
  begin="# >>> xDrive server PATH >>>"
  end="# <<< xDrive server PATH <<<"
  tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-shell-rc.XXXXXX")"
  awk -v begin="$begin" -v end="$end" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    !skip { print }
  ' "$rc" > "$tmp"
  cat "$tmp" > "$rc"
  rm -f "$tmp"
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

compose_with_stdin() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
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

normalize_update_source() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    ""|github) printf '%s\n' github ;;
    gitlab) printf '%s\n' gitlab ;;
    *) echo "xdrive-server: invalid update source: $1 (expected github or gitlab)" >&2; return 2 ;;
  esac
}

installer_url_for_source() {
  local source="$1" channel="${2:-master}"
  if [[ -n "$INSTALLER_URL_OVERRIDE" ]]; then
    printf '%s\n' "$INSTALLER_URL_OVERRIDE"
    return
  fi
  case "$source:$channel" in
    github:master)
      # Use the exact installer asset from the fully published rolling release.
      # Downloading raw master can race ahead of the snapshot bundle and create
      # an unsupported "new installer + old maintenance scripts" combination.
      printf 'https://github.com/%s/releases/download/snapshot/xdrive-server-install.sh\n' "$REPOSITORY"
      ;;
    github:stable)
      printf 'https://github.com/%s/releases/latest/download/xdrive-server-install.sh\n' "$REPOSITORY"
      ;;
    gitlab:master|gitlab:stable)
      # GitLab's rolling snapshot commit is carried in release metadata rather
      # than a movable repository tag. Keep the existing bootstrap URL here;
      # the installer resolves and pins the published GitLab release itself.
      printf '%s/%s/-/raw/master/deploy/install-server.sh\n' "${GITLAB_BASE_URL%/}" "${GITLAB_PROJECT#/}"
      ;;
    *)
      echo "xdrive-server: invalid update channel: $channel" >&2
      return 2
      ;;
  esac
}


# Probe only when the default GitLab provider was implicitly selected.
# A loopback HTTP listener alone is not proof: match the configured project.
prefer_local_gitlab() {
  [[ -z "${XD_GITLAB_BASE_URL+x}" && -z "$INSTALLER_URL_OVERRIDE" ]] || return 0
  [[ "${GITLAB_BASE_URL%/}" == "http://gitlab.t-fluid.com:1080" ]] || return 0
  local candidate="${GITLAB_LOCAL_FALLBACK_URL%/}"
  [[ "$candidate" =~ ^http://(127[.]0[.]0[.]1|localhost):[0-9]{1,5}$ ]] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  command -v python3 >/dev/null 2>&1 || return 0

  local project="${GITLAB_PROJECT#/}" key metadata actual
  key="${project//\//%2F}"
  metadata="$(curl -fsS --noproxy '*' --connect-timeout 1 --max-time 3 \
    "$candidate/api/v4/projects/$key" 2>/dev/null)" || return 0
  # Only a parsed top-level project object may authorize a local installer.
  if ! printf '%s' "$metadata" | python3 -c '
import json,sys
try:
    obj=json.load(sys.stdin)
except (ValueError,TypeError):
    sys.exit(1)
sys.exit(0 if isinstance(obj,dict) and obj.get("path_with_namespace")==sys.argv[1] else 1)
' "$project"; then
    return 0
  fi

  GITLAB_BASE_URL="$candidate"
  export XD_GITLAB_BASE_URL="$GITLAB_BASE_URL"
  echo "[xDrive] found matching local GitLab $project at $candidate; using loopback before remote DNS." >&2
}

# The nested installer also fetches raw files: bypass proxies for loopback.
prepare_local_gitlab_proxy() {
  case "$GITLAB_BASE_URL" in
    http://127.0.0.1:*|http://localhost:*)
      export NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1,localhost"
      export no_proxy="${no_proxy:+$no_proxy,}127.0.0.1,localhost"
      ;;
  esac
}

LAST_DOWNLOAD_TOOL=""

download_installer_url() {
  local installer_url="$1" destination="$2" status
  local -a local_curl_opts=()
  case "$installer_url" in
    http://127.0.0.1:*|http://localhost:*) local_curl_opts=(--noproxy '*') ;;
  esac
  if command -v curl >/dev/null 2>&1; then
    LAST_DOWNLOAD_TOOL="curl"
    if curl -fsSL "${local_curl_opts[@]}" --retry 5 --retry-delay 2 --connect-timeout 10 \
      "$installer_url" -o "$destination" </dev/null; then
      return 0
    else
      status=$?
      rm -f "$destination"
      return "$status"
    fi
  elif command -v wget >/dev/null 2>&1; then
    LAST_DOWNLOAD_TOOL="wget"
    if wget -q --tries=5 --timeout=15 -O "$destination" "$installer_url" </dev/null; then
      return 0
    else
      status=$?
      rm -f "$destination"
      return "$status"
    fi
  else
    echo "xdrive-server: curl or wget is required to update." >&2
    return 127
  fi
}

download_failure_is_connectivity() {
  local tool="$1" status="$2"
  case "$tool:$status" in
    curl:5|curl:6|curl:7|curl:28|curl:35|curl:52|curl:55|curl:56|wget:4|wget:5)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# The rolling snapshot Release can change while its assets are being read.
# Pair each GitHub Release installer with that Release's SHA256SUMS.txt and
# refuse to execute either a corrupt download or mismatched generations.
# The Sigstore provenance bundle independently attests both release digests
# and the OIDC workflow identity. Only explicit strict mode needs gh on host.
verify_github_release_attestation() {
  local installer="$1" manifest="$2" installer_url="$3" channel="$4"
  local bundle="${installer}.attestation.json"
  local -a args=(
    --repo "$REPOSITORY"
    --signer-workflow "$REPOSITORY/.github/workflows/release.yml"
    --bundle "$bundle"
    --deny-self-hosted-runners
  )
  if [[ "$channel" == "master" ]]; then
    args+=(--source-ref refs/heads/master)
  fi
  if ! download_installer_url "${installer_url%/*}/xdrive-release-attestation.json" "$bundle"; then
    echo "xdrive-server: missing GitHub release attestation; refusing installer execution." >&2
    rm -f "$bundle"
    return 1
  fi
  if [[ ! -s "$bundle" ]]; then
    echo "xdrive-server: GitHub release attestation is empty; refusing installer execution." >&2
    rm -f "$bundle"
    return 1
  fi
  # When a Sigstore bundle is distributed alongside its artifact, --repo
  # checks historical owner/repo names but not the immutable repository ID.
  # Reject name-reused repositories even if all string identities match.
  local artifact signed_ids signed_id expected_id="1382670236"
  for artifact in "$installer" "$manifest"; do
    if ! signed_ids="$(gh attestation verify "$artifact" "${args[@]}" \
      --format json \
      --jq '.[].verificationResult.signature.certificate.sourceRepositoryIdentifier' 2>/dev/null)"; then
      echo "xdrive-server: GitHub release attestation identity/digest verification failed; refusing installer execution." >&2
      rm -f "$bundle"
      return 1
    fi
    if [[ -z "$signed_ids" ]]; then
      echo "xdrive-server: GitHub release attestation repository ID missing; refusing installer execution." >&2
      rm -f "$bundle"
      return 1
    fi
    while IFS= read -r signed_id; do
      if [[ "$signed_id" != "$expected_id" ]]; then
        echo "xdrive-server: GitHub release attestation repository ID mismatch; refusing installer execution." >&2
        rm -f "$bundle"
        return 1
      fi
    done <<< "$signed_ids"
  done
  rm -f "$bundle"
  printf '[xDrive] GitHub Actions publisher provenance verified for installer and manifest.\n'
}

verify_github_release_installer() {
  local destination="$1" installer_url="$2" channel="$3" policy="$4" manifest="${destination}.SHA256SUMS.txt"
  local expected actual
  if ! command -v sha256sum >/dev/null 2>&1; then
    echo "xdrive-server: sha256sum is required to verify GitHub release installers." >&2
    return 1
  fi
  if ! download_installer_url "${installer_url%/*}/SHA256SUMS.txt" "$manifest"; then
    echo "xdrive-server: could not download the GitHub release SHA256SUMS.txt; refusing to execute installer." >&2
    rm -f "$manifest"
    return 1
  fi

  # Reject malformed entries anywhere in the published manifest and require
  # exactly one checksum for this installer, including duplicate-valid rows.
  expected="$(awk '
    NF != 2 || length($1) != 64 || $1 !~ /^[[:xdigit:]]+$/ { invalid = 1 }
    $2 == "xdrive-server-install.sh" { matching++; hash = tolower($1) }
    END { if (!invalid && matching == 1) print hash }
  ' "$manifest")"
  if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]]; then
    rm -f "$manifest"
    echo "xdrive-server: GitHub release SHA256SUMS.txt lacks exactly one valid xdrive-server-install.sh checksum." >&2
    return 1
  fi
  actual="$(sha256sum "$destination" | awk '{ print $1 }')"
  if [[ "$expected" != "$actual" ]]; then
    rm -f "$manifest"
    echo "xdrive-server: GitHub release installer SHA-256 mismatch (possible rolling snapshot change); refusing to execute." >&2
    return 1
  fi
  if [[ "$policy" == "required" ]] &&
     ! verify_github_release_attestation "$destination" "$manifest" "$installer_url" "$channel"; then
    rm -f "$manifest"
    return 1
  fi
  rm -f "$manifest"
  printf '[xDrive] GitHub release installer SHA-256 verified: %s\n' "$actual"
}

download_installer() {
  local source="$1" destination="$2" channel="${3:-master}" installer_url status fallback_url attempt previous_gitlab_base
  local policy="${XD_GITHUB_ATTESTATION_POLICY:-}"
  [[ -n "$policy" ]] || policy="$(env_value XD_GITHUB_ATTESTATION_POLICY)"
  policy="${policy:-off}"
  case "$policy" in
    off|required) ;;
    *) echo "xdrive-server: invalid XD_GITHUB_ATTESTATION_POLICY (expected off or required)." >&2; return 2 ;;
  esac
  if [[ "$policy" == "required" ]]; then
    if [[ "$source" != "github" || -n "$INSTALLER_URL_OVERRIDE" || "$REPOSITORY" != "lazyxu/xdrive" ]]; then
      echo "xdrive-server: required publisher verification only supports official lazyxu/xdrive (no GitLab, forks or custom URLs)." >&2
      return 2
    fi
    if ! command -v gh >/dev/null 2>&1; then
      echo "xdrive-server: required GitHub publisher verification needs the gh CLI; refusing installer execution." >&2
      return 1
    fi
  fi
  if [[ "$source" == gitlab ]]; then
    prefer_local_gitlab
    prepare_local_gitlab_proxy
  fi
  installer_url="$(installer_url_for_source "$source" "$channel")"

  # The official GitHub master/stable Release publishes SHA256SUMS.txt beside
  # the installer. Retry the WHOLE pair after a snapshot rollover; never
  # accept a checksum from a different release generation. Intentional custom
  # URL overrides and GitLab retain their existing distribution contract.
  if [[ "$source" == "github" && -z "$INSTALLER_URL_OVERRIDE" ]]; then
    for attempt in 1 2 3; do
      if download_installer_url "$installer_url" "$destination"; then
        if verify_github_release_installer "$destination" "$installer_url" "$channel" "$policy"; then
          return 0
        fi
      fi
      rm -f "$destination" "${destination}.SHA256SUMS.txt" "${destination}.attestation.json"
      if (( attempt < 3 )); then
        echo "[xDrive] GitHub release installer/manifest verification failed; retrying the complete pair ($attempt/3)..." >&2
      fi
    done
    echo "xdrive-server: GitHub installer could not be verified after 3 attempts; no installer was executed." >&2
    return 1
  fi

  if download_installer_url "$installer_url" "$destination"; then
    return 0
  else
    status=$?
  fi

  if [[ "$source" != "gitlab" || -n "$INSTALLER_URL_OVERRIDE" ||
        -n "${XD_GITLAB_BASE_URL+x}" || -z "$GITLAB_LOCAL_FALLBACK_URL" ||
        "${GITLAB_BASE_URL%/}" == "${GITLAB_LOCAL_FALLBACK_URL%/}" ]]; then
    return "$status"
  fi
  if ! download_failure_is_connectivity "$LAST_DOWNLOAD_TOOL" "$status"; then
    return "$status"
  fi

  # Retry the same bounded identity probe: localhost may just have started.
  # Never select unverified loopback after a public connection timeout.
  previous_gitlab_base="${GITLAB_BASE_URL%/}"
  prefer_local_gitlab
  fallback_url="${GITLAB_LOCAL_FALLBACK_URL%/}"
  if [[ "${GITLAB_BASE_URL%/}" != "$fallback_url" ]]; then
    echo "[xDrive] remote GitLab unreachable; local fallback project identity unverified." >&2
    return "$status"
  fi
  echo "[xDrive] GitLab $previous_gitlab_base is unreachable; retrying via verified local GitLab $fallback_url..." >&2
  prepare_local_gitlab_proxy
  installer_url="$(installer_url_for_source "$source" "$channel")"
  download_installer_url "$installer_url" "$destination"
}


install_update_lock_busy() {
  local lock="$STATE_DIR/install.lock" owner_pid=""
  command -v flock >/dev/null 2>&1 || return 1
  mkdir -p "$STATE_DIR"
  exec 7<>"$lock"
  if flock -n 7; then
    flock -u 7 >/dev/null 2>&1 || true
    exec 7>&-
    return 1
  fi
  owner_pid="$(head -n1 "$lock" 2>/dev/null | tr -dc '0-9' || true)"
  exec 7>&-
  if [[ "$owner_pid" =~ ^[0-9]+$ ]]; then
    echo "xdrive-server: another install/update is already running for $XDRIVE_HOME (pid $owner_pid)." >&2
  else
    echo "xdrive-server: another install/update is already running for $XDRIVE_HOME." >&2
  fi
  return 0
}

update_cmd() (
  local tmp installer status target_commit audit_target="" previous="" update_source="" update_channel=""

  # Refuse a duplicate update before doing any network I/O. The installer
  # still owns the authoritative lock, so this is only a fast-path check; a
  # race is safely caught again by install-server.sh.
  if install_update_lock_busy; then
    return 75
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/xdrive-server-update.XXXXXX")"
  installer="$tmp/install-server.sh"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  for arg in "$@"; do
    case "$previous" in
      --channel)
        update_channel="$arg"
        [[ -z "$audit_target" ]] && audit_target="$arg"
        ;;
      --source) update_source="$arg" ;;
    esac
    previous="$arg"
  done
  [[ -n "$audit_target" ]] || audit_target="$(env_value XD_RELEASE_CHANNEL)"
  [[ -n "$update_channel" ]] || update_channel="$(env_value XD_RELEASE_CHANNEL)"
  [[ -n "$update_channel" ]] || update_channel="master"
  case "$update_channel" in
    master|stable) ;;
    *) echo "xdrive-server: invalid update channel: $update_channel (expected stable or master)" >&2; return 2 ;;
  esac
  [[ -n "$update_source" ]] || update_source="$(env_value XD_UPDATE_SOURCE)"
  update_source="$(normalize_update_source "$update_source")"

  echo "[xDrive] downloading $update_channel host installer from $update_source..."
  download_installer "$update_source" "$installer" "$update_channel"
  chmod 700 "$installer"
  bash -n "$installer"
  echo "[xDrive] installer downloaded and syntax-checked."

  if [[ -t 0 && -r /dev/tty && -w /dev/tty ]]; then
    if XD_CONFIG_DIR="$XDRIVE_HOME" bash "$installer" "$@" </dev/tty; then status=0; else status=$?; fi
  else
    if XD_CONFIG_DIR="$XDRIVE_HOME" XD_NONINTERACTIVE=1 bash "$installer" "$@" </dev/null; then status=0; else status=$?; fi
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

control_cmd() {
  local control="$BIN_DIR/server-control.sh"
  [[ -x "$control" ]] || {
    echo "xdrive-server: host control is not installed at $control" >&2
    return 1
  }
  XD_CONFIG_DIR="$XDRIVE_HOME" exec "$control" "$@"
}


# Export a verified public CA certificate through the trusted local Docker management
# plane. This deliberately never installs or trusts the CA on any client.
lan_ca_cmd() (
  if [[ "$#" -ne 2 || "$1" != "export" || -z "$2" || "$2" == "-" ]]; then
    echo "usage: xdrive-server lan-ca export /absolute/path/root.crt" >&2
    return 2
  fi
  if [[ ! -f "$ENV_PATH" || ! -f "$COMPOSE_PATH" ]]; then
    echo "xdrive-server: managed deployment is unavailable." >&2
    return 1
  fi

  local ip port output temp first second third fourth octet code fingerprint pem_sha tool
  ip="$(env_value XD_LAN_HTTPS_IP)"
  port="$(env_value XD_HTTPS_PORT)"
  [[ -n "$port" ]] || port=8443
  if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "xdrive-server: an enabled canonical LAN HTTPS IP is required." >&2
    return 1
  fi
  IFS=. read -r first second third fourth <<< "$ip"
  for octet in "$first" "$second" "$third" "$fourth"; do
    if [[ ! "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] || (( 10#$octet > 255 )); then
      echo "xdrive-server: invalid LAN HTTPS IPv4." >&2
      return 1
    fi
  done
  if ! (( first == 10 || (first == 172 && second >= 16 && second <= 31) ||
           (first == 192 && second == 168) )); then
    echo "xdrive-server: only canonical RFC1918 LAN HTTPS IPs are allowed." >&2
    return 1
  fi
  if [[ ! "$port" =~ ^[1-9][0-9]{0,4}$ ]] || (( 10#$port > 65535 )); then
    echo "xdrive-server: invalid HTTPS port." >&2
    return 1
  fi

  output="$2"
  if [[ "$output" != /* || -e "$output" || -L "$output" ||
        ! -d "$(dirname -- "$output")" ]]; then
    echo "xdrive-server: use a new absolute output path in an existing directory; overwrite is forbidden." >&2
    return 1
  fi
  for tool in docker openssl curl sha256sum mktemp ln; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "xdrive-server: required local verification tool is unavailable: $tool" >&2
      return 1
    fi
  done

  temp="$(mktemp "$(dirname -- "$output")/.xdrive-lan-ca.XXXXXXXX")"
  trap 'rm -f -- "$temp"' EXIT
  chmod 0600 "$temp"
  # Never fetch a root certificate from the untrusted HTTPS destination itself.
  if ! compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$temp" 2>/dev/null; then
    echo "xdrive-server: cannot read the running Caddy local CA." >&2
    return 1
  fi
  if [[ "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$temp")" -ne 1 ||
        "$(grep -c -- '-----END CERTIFICATE-----' "$temp")" -ne 1 ]] ||
     ! openssl x509 -in "$temp" -noout -checkend 0 >/dev/null 2>&1 ||
     ! openssl x509 -in "$temp" -noout -ext basicConstraints 2>/dev/null | grep -q 'CA:TRUE' ||
     ! openssl verify -CAfile "$temp" "$temp" >/dev/null 2>&1; then
    echo "xdrive-server: Caddy local CA is not a valid, current single-root certificate." >&2
    return 1
  fi
  # curl checks the real TLS chain and IP-address SAN with no SNI workarounds,
  # redirects, proxies or TLS bypass. Require actual HTTP 200.
  code="$(curl -sS --noproxy '*' --cacert "$temp" --connect-timeout 4 --max-time 10 \
    --output /dev/null --write-out '%{http_code}' \
    "https://$ip:$port/api/v1/readyz" 2>/dev/null)" || {
    echo "xdrive-server: actual LAN HTTPS chain or IP SAN verification failed." >&2
    return 1
  }
  if [[ "$code" != 200 ]]; then
    echo "xdrive-server: LAN HTTPS readiness did not return HTTP 200." >&2
    return 1
  fi
  # Atomic hard link fails if another process created the target. 0600 file.
  if ! ln -- "$temp" "$output"; then
    echo "xdrive-server: CA export destination is not available." >&2
    return 1
  fi
  pem_sha="$(sha256sum "$output" | cut -d' ' -f1)"
  fingerprint="$(openssl x509 -in "$output" -noout -fingerprint -sha256)"
  printf 'Verified LAN HTTPS: https://%s:%s\n' "$ip" "$port"
  printf 'Public CA certificate exported: %s\n' "$output"
  printf 'CA PEM SHA256 (compare on client): %s\n' "$pem_sha"
  printf 'CA certificate %s\n' "$fingerprint"
  echo "Transfer through an independently trusted channel; compare SHA256 before explicitly trusting on each client."
  echo "No operating-system certificate stores or xDrive login settings were changed."
)

doctor_cmd() {
  local doctor="$BIN_DIR/server-doctor.sh"
  [[ -x "$doctor" ]] || {
    echo "xdrive-server: server doctor is not installed at $doctor" >&2
    return 1
  }
  XD_CONFIG_DIR="$XDRIVE_HOME" exec "$doctor" "$@"
}

display_path() {
  local value="$1"
  if [[ "${XD_STATUS_REDACT_HOME:-0}" == "1" && -n "${HOME:-}" && "$value" == "$HOME"* ]]; then
    printf '~%s' "${value#$HOME}"
  else
    printf '%s' "$value"
  fi
}

docker_mode() {
  local security
  if ! docker info </dev/null >/dev/null 2>&1; then
    printf 'unavailable\n'
    return 0
  fi
  security="$(docker info --format '{{json .SecurityOptions}}' </dev/null 2>/dev/null || true)"
  if printf '%s' "$security" | grep -qi rootless; then
    printf 'rootless\n'
  else
    printf 'rootful\n'
  fi
}

disk_usage_for_path() {
  local path="$1" probe="$1"
  command -v df >/dev/null 2>&1 || { printf 'unavailable'; return 0; }
  while [[ ! -e "$probe" && "$probe" != "/" ]]; do
    probe="$(dirname "$probe")"
  done
  df -hP -- "$probe" 2>/dev/null | awk 'NR==2 {
    printf "%s total, %s used, %s free, %s used, fs=%s", $2, $3, $4, $5, $1
  }'
}

configured_path() {
  local key="$1" fallback="$2" value
  value="$(env_value "$key")"
  [[ -n "$value" ]] || value="$fallback"
  printf '%s\n' "$value"
}

active_mount() {
  local service="$1" destination="$2" id info
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || { printf 'inactive'; return 0; }
  id="$(compose ps -aq "$service" 2>/dev/null | head -n1 || true)"
  [[ -n "$id" ]] || { printf 'inactive'; return 0; }
  info="$(docker inspect "$id" --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{if .Name}}volume={{.Name}}{{else}}bind={{.Source}}{{end}}{{end}}{{end}}" </dev/null 2>/dev/null || true)"
  [[ -n "$info" ]] && printf '%s' "$info" || printf 'missing'
}

status_path_line() {
  local label="$1" path="$2" service="${3:-}" destination="${4:-}" mount="n/a" disk
  disk="$(disk_usage_for_path "$path")"
  if [[ -n "$service" && -n "$destination" ]]; then
    mount="$(active_mount "$service" "$destination")"
  fi
  printf '  %-15s %s\n' "$label" "$(display_path "$path")"
  printf '  %-15s %s; mount=%s\n' "" "${disk:-unavailable}" "$mount"
}

retained_legacy_summary() {
  local value volume exists attached count=0
  if [[ ! -f "$LEGACY_VOLUMES_RECORD" ]]; then
    printf 'none\n'
    return 0
  fi
  while IFS='=' read -r _ value; do
    volume="${value%$'\r'}"
    [[ -n "$volume" ]] || continue
    count=$((count + 1))
    if docker volume inspect "$volume" </dev/null >/dev/null 2>&1; then
      exists="present"
      attached="$(docker ps -aq --filter "volume=$volume" </dev/null 2>/dev/null || true)"
      [[ -n "$attached" ]] && exists="$exists,in-use" || exists="$exists,unused"
    else
      exists="missing"
    fi
    printf '%s (%s)\n' "$volume" "$exists"
  done < "$LEGACY_VOLUMES_RECORD"
  [[ "$count" -gt 0 ]] || printf 'none\n'
}

status_summary() {
  local mode context docker_root source channel commit
  local files_dir postgres_dir caddy_data_dir caddy_config_dir legacy first line

  mode="$(docker_mode)"
  context="$(docker context show </dev/null 2>/dev/null || true)"
  docker_root="$(docker info --format '{{.DockerRootDir}}' </dev/null 2>/dev/null || true)"
  source="$(env_value XD_UPDATE_SOURCE)"
  channel="$(env_value XD_RELEASE_CHANNEL)"
  commit="$(env_value XD_RELEASE_COMMIT)"

  files_dir="$(configured_path XD_FILES_DATA_DIR "$DATA_DIR/files")"
  postgres_dir="$(configured_path XD_POSTGRES_DATA_DIR "$DATA_DIR/postgres")"
  caddy_data_dir="$(configured_path XD_CADDY_DATA_DIR "$DATA_DIR/caddy/data")"
  caddy_config_dir="$(configured_path XD_CADDY_CONFIG_DIR "$DATA_DIR/caddy/config")"

  echo "xDrive installation environment"
  printf '  %-15s %s\n' "Home" "$(display_path "$XDRIVE_HOME")"
  printf '  %-15s %s\n' "Docker mode" "$mode"
  printf '  %-15s %s\n' "Docker context" "${context:-unknown}"
  printf '  %-15s %s\n' "Docker root" "$(display_path "${docker_root:-unknown}")"
  printf '  %-15s %s / %s%s\n' "Update" "${source:-unknown}" "${channel:-unknown}" "${commit:+ / ${commit:0:12}}"
  printf '  %-15s %s\n' "Home disk" "$(disk_usage_for_path "$XDRIVE_HOME")"
  echo "Persistent paths"
  status_path_line "Files" "$files_dir" server /data
  status_path_line "PostgreSQL" "$postgres_dir" postgres /var/lib/postgresql/data
  status_path_line "Caddy data" "$caddy_data_dir" caddy /data
  status_path_line "Caddy config" "$caddy_config_dir" caddy /config
  status_path_line "Backups" "$BACKUP_DIR"

  echo "Retained legacy volumes"
  legacy="$(retained_legacy_summary)"
  first=1
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    if [[ "$first" == "1" ]]; then
      printf '  %-15s %s\n' "Volumes" "$line"
      first=0
    else
      printf '  %-15s %s\n' "" "$line"
    fi
  done <<< "$legacy"
  [[ "$first" == "0" ]] || printf '  %-15s none\n' "Volumes"
}

status_cmd() {
  local summary_only=0 arg
  for arg in "$@"; do
    case "$arg" in
      --summary-only) summary_only=1 ;;
      *) echo "usage: xdrive-server status [--summary-only]" >&2; return 2 ;;
    esac
  done
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: no xDrive deployment found in $CONFIG_DIR" >&2
    return 1
  }
  status_summary
  if [[ "$summary_only" != "1" ]]; then
    echo
    echo "Services"
    compose ps
  fi
}

backup_manifest_value() {
  local manifest="$1" key="$2"
  [[ -f "$manifest" ]] || return 0
  sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$manifest" | head -n1
}

backup_manifest_bool() {
  local manifest="$1" key="$2" fallback="${3:-false}" value
  [[ -f "$manifest" ]] || { printf '%s\n' "$fallback"; return 0; }
  value="$(sed -nE 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' "$manifest" | head -n1)"
  case "$value" in
    true|false) printf '%s\n' "$value" ;;
    *) printf '%s\n' "$fallback" ;;
  esac
}

# Read-only snapshot discovery. Reuse the explicitly configured scheduled v2
# repository instead of silently hiding its generations from list/verify.
# Never create, modify, prune or follow a top-level symlinked repository.
backup_snapshot_roots() {
  BACKUP_SNAPSHOT_ROOTS=("$BACKUP_DIR/snapshots" "$BACKUP_DIR/incremental/snapshots")
  local schedule_format custom_repo default_repo
  schedule_format="$(env_value XD_BACKUP_SCHEDULE_FORMAT)"
  [[ "$schedule_format" == "v2" ]] || return 0
  custom_repo="$(env_value XD_BACKUP_SCHEDULE_REPOSITORY_DIR)"
  [[ -n "$custom_repo" ]] || return 0
  while [[ "$custom_repo" == */ && "$custom_repo" != "/" ]]; do
    custom_repo="${custom_repo%/}"
  done
  [[ "$custom_repo" == /* && ! -L "$custom_repo" ]] || {
    echo "xdrive-server: scheduled v2 repository must be an absolute non-symlink path" >&2
    return 2
  }
  # A configured repository might not exist until the first scheduled run.
  [[ -e "$custom_repo" ]] || return 0
  [[ -d "$custom_repo" ]] || {
    echo "xdrive-server: scheduled v2 repository is not a directory: $custom_repo" >&2
    return 2
  }
  custom_repo="$(cd "$custom_repo" && pwd -P)" || return 1
  default_repo="$BACKUP_DIR/incremental"
  if [[ -d "$default_repo" ]]; then
    default_repo="$(cd "$default_repo" && pwd -P)" || return 1
  fi
  [[ "$custom_repo" == "$default_repo" ]] ||
    BACKUP_SNAPSHOT_ROOTS+=("$custom_repo/snapshots")
}

latest_snapshot_backup() {
  local root
  backup_snapshot_roots || return
  for root in "${BACKUP_SNAPSHOT_ROOTS[@]}"; do
    [[ -d "$root" ]] || continue
    find "$root" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' ! -name '*.partial' -print
  done | awk -F/ '{print $NF "\t" $0}' | sort -r | head -n1 | cut -f2-
}

backup_list_cmd() {
  [[ $# -eq 0 ]] || { echo "usage: xdrive-server backup list" >&2; return 2; }
  local root dir name size created channel commit consistent file_data status found=0 required version manifest_info
  backup_snapshot_roots || return
  printf '%-30s %-20s %-9s %-10s %-14s %-16s %s\n' "BACKUP" "CREATED_UTC" "SIZE" "CHANNEL" "COMMIT" "STATUS" "PATH"
  for root in "${BACKUP_SNAPSHOT_ROOTS[@]}"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r dir; do
      [[ -n "$dir" ]] || continue
      found=1
      name="$(basename "$dir")"
      [[ "$root" == "$BACKUP_DIR/snapshots" ]] || name="cas:$name"
      size="$(du -sh "$dir" 2>/dev/null | awk '{print $1}' || true)"
      created="$(backup_manifest_value "$dir/manifest.json" created_at_utc)"
      channel="$(backup_manifest_value "$dir/manifest.json" release_channel)"
      commit="$(backup_manifest_value "$dir/manifest.json" release_commit)"
      # The listing is informational, but cannot label an ambiguous Manifest
      # as a complete snapshot. Reuse the strict, bounded, nofollow JSON reader.
      manifest_info="$(backup_verified_manifest_info "$dir/manifest.json" 2>/dev/null || true)"
      version="" file_data="" consistent=""
      if [[ -n "$manifest_info" ]]; then
        IFS=$'\t' read -r version file_data consistent <<< "$manifest_info"
      fi
      status="invalid-manifest"
      if [[ "$version" == 1 || "$version" == 2 ]]; then
        status="complete"
        for required in database.dump verify.json manifest.json SHA256SUMS.txt; do
          [[ -f "$dir/$required" && ! -L "$dir/$required" ]] || { status="incomplete"; break; }
        done
        if [[ "$version" == 2 ]]; then
          for required in objects.index legacy.tar; do
            [[ -f "$dir/$required" && ! -L "$dir/$required" ]] || status="incomplete"
          done
          if [[ "$status" == complete ]]; then
            if [[ "$file_data" == true ]]; then status="cas-incremental"
            else status="invalid-manifest"; fi
          fi
        elif [[ "$status" == complete ]]; then
          if [[ "$file_data" == false ]]; then
            status="database-only"
          elif [[ ! -f "$dir/blobs.tar" || -L "$dir/blobs.tar" ]]; then
            status="incomplete"
          fi
        fi
        if [[ "$consistent" == false && "$status" != incomplete &&
              "$status" != invalid-manifest ]]; then
          status="inconsistent"
        fi
      fi
      [[ -n "$created" ]] || created="-"
      [[ -n "$size" ]] || size="-"
      [[ -n "$channel" ]] || channel="-"
      [[ -n "$commit" ]] || commit="-"
      [[ "$commit" == "-" ]] || commit="${commit:0:12}"
      printf '%-30s %-20s %-9s %-10s %-14s %-16s %s\n' "$name" "$created" "$size" "$channel" "$commit" "$status" "$dir"
    done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -name 'xdrive-backup-*' -print | sort -r)
  done
  [[ "$found" == "1" ]] || echo "No snapshot backups found"
  echo "Note: incremental SIZE excludes shared CAS objects; use backup verify PATH for hash validation."
}

# Validate exact version, top-level booleans, regular inode and bounded JSON.
# Do not trust grep matches inside duplicate or nested manifest fields.
backup_verified_manifest_info() {
  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$1" <<'PY'
import json, os, stat, sys

def unique_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out: raise ValueError('duplicate JSON key')
        out[key] = value
    return out

def reject_constant(_):
    raise ValueError('invalid JSON constant')

try:
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(sys.argv[1], flags)
    with os.fdopen(fd, 'rb') as src:
        st = os.fstat(src.fileno())
        if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= 65536:
            raise ValueError('unsafe manifest inode or size')
        data = src.read(65537)
    if len(data) > 65536: raise ValueError('oversized manifest')
    obj = json.loads(data.decode('utf-8'), object_pairs_hook=unique_keys,
                     parse_constant=reject_constant)
    if type(obj) is not dict or type(obj.get('format_version')) is not int:
        raise ValueError('invalid manifest version')
    version = obj['format_version']
    if version not in (1, 2): raise ValueError('unsupported format')
    for key in ('file_data_included', 'consistency_verified'):
        if key in obj and type(obj[key]) is not bool:
            raise ValueError('invalid boolean')
    included = obj.get('file_data_included', True)
    consistent = obj.get('consistency_verified', None)
    print('%s\t%s\t%s' % (version, str(included).lower(),
                           str(consistent).lower() if consistent is not None else 'unknown'))
except (OSError, ValueError, UnicodeError, TypeError):
    print('xdrive-server: invalid or unsafe backup manifest', file=sys.stderr)
    sys.exit(1)
PY
}

# JSON uses the SAME snapshot and referenced-CAS hash pass, not a second read.
backup_verify_json_cmd() {
  [[ $# -le 1 ]] || { echo "usage: xdrive-server backup verify --json [BACKUP_DIR]" >&2; return 2; }
  command -v python3 >/dev/null 2>&1 || { echo "python3 is required for backup verify --json" >&2; return 1; }
  local target="${1:-}" format=unknown cas_file log_file status=0 encode_status=0
  [[ -n "$target" ]] || target="$(latest_snapshot_backup || true)"
  if [[ -n "$target" && -f "$target/manifest.json" && ! -L "$target/manifest.json" ]]; then
    local manifest_info manifest_version
    manifest_info="$(backup_verified_manifest_info "$target/manifest.json" 2>/dev/null || true)"
    IFS=$'\t' read -r manifest_version _ _ <<< "$manifest_info"
    case "$manifest_version" in
      1) format=v1 ;;
      2) format=v2 ;;
    esac
  fi
  cas_file="$(mktemp "${TMPDIR:-/tmp}/xdrive-verify-cas.XXXXXXXX")" || return 1
  log_file="$(mktemp "${TMPDIR:-/tmp}/xdrive-verify-log.XXXXXXXX")" || {
    rm -f -- "$cas_file"; return 1
  }
  if XD_BACKUP_VERIFY_CAS_REPORT_FILE="$cas_file" backup_verify_cmd "$target" >"$log_file" 2>&1; then
    status=0
  else
    status=$?
    cat "$log_file" >&2
  fi
  if python3 - "$cas_file" "$status" "$format" <<'PY'
import json, os, stat, sys
path, code, fmt = sys.argv[1], int(sys.argv[2]), sys.argv[3]
categories = {"missing_object", "object_sha256_mismatch", "object_size_mismatch",
              "unsafe_repository", "unsafe_snapshot", "unsafe_object_bucket",
              "unreadable_or_unsafe_object", "object_read_failed",
              "measurement_overflow", "invalid_object_index",
              "invalid_legacy_archive", "snapshot_outside_repository"}
record = {"protocol":"xdrive-host-backup-verify-v1",
          "state":"success" if code==0 else "failed",
          "format":fmt, "scope":"backup_snapshot_and_referenced_cas",
          "cas_objects_checked":0, "cas_bytes_hashed":0}
cas = None
invalid = False
try:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > 2048:
            raise ValueError("unsafe record")
        data = f.read(2049)
    if len(data)>2048:
        raise ValueError("oversized record")
    if data:
        cas=json.loads(data.decode("utf-8"))
        required={"protocol","state","mode","objects_checked","bytes_hashed"}
        optional={"failure_category"}
        if (not isinstance(cas,dict) or not required <= cas.keys() or
                set(cas)-required-optional or
                cas["protocol"]!="xdrive-backup-verify-v1" or
                cas["state"] not in ("success","failed") or cas["mode"]!="deep"):
            raise ValueError("unsupported receipt")
        for k in ("objects_checked","bytes_hashed"):
            if type(cas[k]) is not int or cas[k]<0 or cas[k]>9007199254740991:
                raise ValueError("unsafe count")
        category=cas.get("failure_category","")
        if type(category) is not str or (category and category not in categories):
            raise ValueError("unknown category")
except (OSError,ValueError,UnicodeError,TypeError,KeyError):
    invalid=True
if fmt=="v2":
    if cas is None and code==0:
        invalid=True
    if cas is not None and not invalid:
        if (code==0)!=(cas["state"]=="success"):
            invalid=True
        else:
            record["cas_objects_checked"]=cas["objects_checked"]
            record["cas_bytes_hashed"]=cas["bytes_hashed"]
            if cas.get("failure_category"):
                record["failure_category"]=cas["failure_category"]
elif fmt=="v1":
    if cas is not None:
        invalid=True
elif code==0:
    invalid=True
if invalid:
    record.update(state="failed",cas_objects_checked=0,cas_bytes_hashed=0,
                  failure_category="invalid_cas_report")
elif code!=0 and "failure_category" not in record:
    record["failure_category"]="snapshot_verification_failed"
print(json.dumps(record,sort_keys=True,separators=(",",":")))
if invalid: sys.exit(1)
PY
  then encode_status=0
  else encode_status=$?
  fi
  rm -f -- "$cas_file" "$log_file"
  (( encode_status == 0 )) || return 1
  return "$status"
}

# A valid v1 SHA256SUMS manifest proves bytes were not altered, but not
# that GNU tar can safely extract the archive to /data. Check only archive
# headers with the Python standard library. No production path is mounted,
# created, or written by this check.
backup_verify_v1_archive_headers() {
  local archive="$1"
  command -v python3 >/dev/null 2>&1 || {
    echo "xdrive-server: Python 3 is required for v1 archive safety verification." >&2
    return 1
  }
  python3 - "$archive" <<'PY'
import sys, tarfile

seen = {}
ancestors = set()
regular = set()

def canonical(name):
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        raise ValueError("absolute or malformed archive path")
    raw = name.split("/")
    if ".." in raw:
        raise ValueError("parent directory traversal")
    return "/".join(part for part in raw if part and part != ".")

try:
    with tarfile.open(sys.argv[1], mode="r:") as archive:
        for member in archive:
            name = canonical(member.name)
            if not name:
                if not member.isdir():
                    raise ValueError("unsafe root archive entry")
                continue
            if name in seen:
                raise ValueError("duplicate normalized archive path")
            if member.isdir():
                kind = "directory"
            elif member.isreg():
                kind = "file"
            elif member.islnk():
                # Hardlinks must point only at a previously seen regular file.
                target = canonical(member.linkname)
                if not target or target not in regular:
                    raise ValueError("external or forward archive hardlink")
                kind = "file"
            else:
                # Symlinks, devices, FIFOs and unknown tar extensions are not
                # safe as source material for a destructive data restore.
                raise ValueError("unsafe archive member type")
            parts = name.split("/")
            for i in range(1, len(parts)):
                parent = "/".join(parts[:i])
                if seen.get(parent) == "file":
                    raise ValueError("file/descendant archive conflict")
                ancestors.add(parent)
            if kind == "file" and name in ancestors:
                raise ValueError("file replaces earlier directory ancestor")
            seen[name] = kind
            if kind == "file":
                regular.add(name)
except (OSError, EOFError, ValueError, tarfile.TarError) as exc:
    print("xdrive-server: v1 archive structure failed safety verification (" +
          type(exc).__name__ + ")", file=sys.stderr)
    sys.exit(1)
PY
}

backup_verify_cmd() {
  if [[ "${1:-}" == "--json" ]]; then
    shift
    backup_verify_json_cmd "$@"
    return $?
  fi
  [[ $# -le 1 ]] || {
    echo "usage: xdrive-server backup verify [BACKUP_DIR]" >&2
    return 2
  }
  command -v sha256sum >/dev/null 2>&1 || {
    echo "xdrive-server: sha256sum is required to verify backups" >&2
    return 1
  }
  local dir="${1:-}" required created channel commit consistent file_data
  local -a required_files
  if [[ -z "$dir" ]]; then
    dir="$(latest_snapshot_backup || true)"
    [[ -n "$dir" ]] || {
      echo "xdrive-server: no snapshot backup is available to verify" >&2
      return 1
    }
  fi
  [[ -d "$dir" ]] || {
    echo "xdrive-server: backup directory not found: $dir" >&2
    return 1
  }
  dir="$(cd "$dir" && pwd)"
  [[ -f "$dir/manifest.json" ]] || {
    echo "xdrive-server: backup is missing manifest.json: $dir" >&2
    return 1
  }
  local backup_version repository_dir server_image manifest_info
  if ! manifest_info="$(backup_verified_manifest_info "$dir/manifest.json")"; then
    echo "xdrive-server: backup manifest validation failed: $dir" >&2
    return 1
  fi
  IFS=$'\t' read -r backup_version file_data consistent <<< "$manifest_info"
  # Keep a shared lease through the entire v2 hash verification and, when
  # invoked via 'backup sources', through the following pg_restore read.
  # This coordinates with the existing exclusive snapshot publication lock
  # and any future reference-aware prune. Never create or truncate the lock.
  if [[ "$backup_version" == "2" ]]; then
    [[ "$(basename "$(dirname "$dir")")" == "snapshots" ]] || {
      echo "xdrive-server: CAS snapshot must be in repository/snapshots." >&2
      return 1
    }
    repository_dir="$(cd "$dir/../.." && pwd -P)" || return 1
    local repository_lock="$repository_dir/.backup.lock"
    [[ -f "$repository_lock" && ! -L "$repository_lock" ]] || {
      echo "xdrive-server: missing or unsafe v2 repository lock: $repository_lock" >&2
      return 1
    }
    command -v flock >/dev/null 2>&1 || {
      echo "xdrive-server: flock is required for v2 repository verification." >&2
      return 1
    }
    exec 7<"$repository_lock"
    flock -s -n 7 || {
      echo "xdrive-server: v2 repository is busy with another operation" >&2
      return 75
    }
  fi
  required_files=(database.dump verify.json manifest.json SHA256SUMS.txt)
  if [[ "$backup_version" == "2" ]]; then
    required_files+=(objects.index legacy.tar)
  elif [[ "$file_data" != "false" ]]; then
    required_files+=(blobs.tar)
  fi
  for required in "${required_files[@]}"; do
    [[ -f "$dir/$required" ]] || {
      echo "xdrive-server: backup is missing $required: $dir" >&2
      return 1
    }
    if [[ "$backup_version" == "2" && -L "$dir/$required" ]]; then
      echo "xdrive-server: v2 snapshot contains symlink $required: $dir" >&2
      return 1
    fi
    if [[ "$backup_version" == "1" && -L "$dir/$required" ]]; then
      echo "xdrive-server: v1 snapshot contains symlink $required: $dir" >&2
      return 1
    fi
  done
  if [[ "$backup_version" == "2" ]]; then
    # Require the exact five committed v2 entries; sha256sum -c alone accepts
    # partial lists that omit objects.index and other required files.
    (
      cd "$dir"
      cmp -s SHA256SUMS.txt <(sha256sum database.dump verify.json manifest.json objects.index legacy.tar)
    ) || { echo "xdrive-server: v2 checksum manifest mismatch: $dir" >&2; return 1; }
  else
    # The v1 writer includes exactly three metadata files and, for a full
    # backup, blobs.tar in this order. sha256sum -c alone accepts a checksum
    # list omitting one or more entire backup members (a false green).
    [[ ! -L "$dir/blobs.tar" ]] || {
      echo "xdrive-server: v1 snapshot contains symlink blobs.tar: $dir" >&2; return 1;
    }
    local -a v1_checksum_files=(database.dump verify.json manifest.json)
    [[ ! -f "$dir/blobs.tar" ]] || v1_checksum_files+=(blobs.tar)
    (
      cd "$dir" || exit 1
      cmp -s SHA256SUMS.txt <(sha256sum "${v1_checksum_files[@]}")
    ) || { echo "xdrive-server: v1 checksum manifest mismatch: $dir" >&2; return 1; }
    if [[ "$file_data" != "false" ]]; then
      backup_verify_v1_archive_headers "$dir/blobs.tar" || return 1
    fi
  fi
  if [[ "$backup_version" == "2" ]]; then
    [[ "$(basename "$(dirname "$dir")")" == "snapshots" ]] || {
      echo "xdrive-server: CAS snapshot must be in repository/snapshots." >&2; return 1;
    }
    repository_dir="$(cd "$dir/../.." && pwd)"
    [[ -d "$repository_dir/objects/sha256" ]] || {
      echo "xdrive-server: CAS objects repository is missing." >&2; return 1;
    }
    local backup_server_id
    backup_server_id="$(compose ps -aq server | head -n1 || true)"
    server_image=""
    if [[ -n "$backup_server_id" ]]; then
      server_image="$(docker inspect "$backup_server_id" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
    fi
    [[ -n "$server_image" ]] || server_image="$(env_value XD_SERVER_IMAGE)"
    [[ -n "$server_image" ]] || { echo "xdrive-server: cannot resolve server image for CAS verification." >&2; return 1; }
    if [[ -n "${XD_BACKUP_VERIFY_CAS_REPORT_FILE:-}" ]]; then
      docker run --rm --user 0:0 \
        --mount "type=bind,src=$repository_dir,dst=/repo,readonly" \
        --entrypoint /usr/local/bin/xdrive-backup-repo \
        "$server_image" verify --repo /repo --snapshot "$(basename "$dir")" --json \
        </dev/null > "$XD_BACKUP_VERIFY_CAS_REPORT_FILE" || return $?
    else
    docker run --rm --user 0:0 \
      --mount "type=bind,src=$repository_dir,dst=/repo,readonly" \
      --entrypoint /usr/local/bin/xdrive-backup-repo \
      "$server_image" verify --repo /repo --snapshot "$(basename "$dir")" </dev/null || return $?
    fi
  fi
  created="$(backup_manifest_value "$dir/manifest.json" created_at_utc)"
  channel="$(backup_manifest_value "$dir/manifest.json" release_channel)"
  commit="$(backup_manifest_value "$dir/manifest.json" release_commit)"
  echo "Backup verified: $dir"
  [[ -n "$created" ]] && echo "  created: $created"
  [[ -n "$channel" ]] && echo "  release: $channel${commit:+ / ${commit:0:12}}"
  if [[ "$file_data" == "false" ]]; then
    echo "  file data: omitted (database-only backup)"
  elif [[ "$backup_version" == "2" ]]; then
    echo "  file data: CAS + Manifest incremental (verified)"
  else
    echo "  file data: included"
  fi
  if [[ "$consistent" == "false" ]]; then
    echo "  warning: this backup was created with consistency_verified=false" >&2
  fi
}


backup_sources_cmd() {
  [[ $# -eq 1 ]] || {
    echo "usage: xdrive-server backup sources BACKUP_DIR" >&2
    return 2
  }
  local dir="$1" created
  [[ -d "$dir" ]] || {
    echo "xdrive-server: backup directory not found: $dir" >&2
    return 1
  }
  dir="$(cd "$dir" && pwd)"
  backup_verify_cmd "$dir" >/dev/null
  [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]] || {
    echo "xdrive-server: active deployment configuration is required to inspect a PostgreSQL backup" >&2
    return 1
  }

  created="$(backup_manifest_value "$dir/manifest.json" created_at_utc)"
  echo "Backup: $dir"
  [[ -n "$created" ]] && echo "Created: $created"
  echo
  printf 'ID\tOWNER_ID\tNAME\tKIND\tDIRECTION\tRUN_MODE\tSTATUS\tUPDATED_AT\n'

  compose_with_stdin exec -T postgres \
    pg_restore --data-only --table=public.xd_sources --file=- \
    < "$dir/database.dump" |
    awk -F '\t' '
      function field(name, n) {
        n=col[name]
        return n > 0 ? $(n) : "-"
      }
      /^COPY public\.xd_sources \(/ {
        header=$0
        sub(/^COPY public\.xd_sources \(/, "", header)
        sub(/\) FROM stdin;$/, "", header)
        count=split(header, columns, /, */)
        for (i=1; i<=count; i++) col[columns[i]]=i
        in_rows=1
        next
      }
      in_rows && $0 == "\\." { in_rows=0; next }
      in_rows {
        found=1
        printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
          field("id"),
          field("owner_id"),
          field("name"),
          field("kind"),
          field("direction"),
          field("run_mode"),
          field("status"),
          field("updated_at")
      }
      END {
        if (!found) print "(no external sources)"
      }
    '
}

backup_create_cmd() {
  local script="$BIN_DIR/server-backup.sh" status
  [[ -x "$script" ]] || {
    echo "xdrive-server: backup tool is not installed at $script" >&2
    return 1
  }
  if XD_CONFIG_DIR="$XDRIVE_HOME" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$status" -eq 0 ]]; then
    record_system_audit system.backup success
  else
    record_system_audit system.backup failure
  fi
  return "$status"
}

# Offline, read-only v2 capacity preview. There is intentionally no prune or
# delete mode. Running the helper through a read-only bind mount makes this
# safe even if the native program acquires new features in the future.
backup_retention_plan_cmd() {
  local repository_dir="" keep_last="7" server_id="" server_image="" configured="" cas_mode="fast"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repository-dir)
        [[ $# -ge 2 ]] || { echo "backup retention-plan: missing repository path" >&2; return 2; }
        repository_dir="$2"
        shift 2
        ;;
      --keep-last)
        [[ $# -ge 2 ]] || { echo "backup retention-plan: missing keep count" >&2; return 2; }
        keep_last="$2"
        shift 2
        ;;
      --mode)
        [[ $# -ge 2 ]] || { echo "backup retention-plan: missing mode" >&2; return 2; }
        cas_mode="$2"
        shift 2
        ;;
      *) echo "usage: xdrive-server backup retention-plan [--repository-dir PATH] [--keep-last N] [--mode fast|deep]" >&2; return 2 ;;
    esac
  done
  [[ "$keep_last" =~ ^[1-9][0-9]*$ ]] || {
    echo "backup retention-plan: keep-last must be a positive integer" >&2
    return 2
  }
  [[ "$cas_mode" == "fast" || "$cas_mode" == "deep" ]] || {
    echo "backup retention-plan: --mode must be fast or deep" >&2
    return 2
  }
  if [[ -z "$repository_dir" && "$(env_value XD_BACKUP_SCHEDULE_FORMAT)" == "v2" ]]; then
    configured="$(env_value XD_BACKUP_SCHEDULE_REPOSITORY_DIR)"
    [[ -z "$configured" ]] || repository_dir="$configured"
  fi
  repository_dir="${repository_dir:-$BACKUP_DIR/incremental}"
  [[ "$repository_dir" == /* && -d "$repository_dir" && ! -L "$repository_dir" ]] || {
    echo "backup retention-plan: repository must be an existing absolute non-symlink directory" >&2
    return 2
  }
  repository_dir="$(cd "$repository_dir" && pwd -P)" || return 1
  command -v docker >/dev/null 2>&1 || { echo "backup retention-plan: Docker is required" >&2; return 1; }
  if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]]; then
    server_id="$(compose ps -aq server | head -n1 || true)"
  fi
  if [[ -n "$server_id" ]]; then
    server_image="$(docker inspect "$server_id" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
  fi
  [[ -n "$server_image" ]] || server_image="$(env_value XD_SERVER_IMAGE)"
  [[ -n "$server_image" ]] || {
    echo "backup retention-plan: Server image is not configured" >&2
    return 1
  }
  if [[ "$cas_mode" == "deep" ]]; then
    # A long-running deep content audit must not race a cooperating writer.
    # Reuse the writer's lock inode; never create or truncate it.
    local repository_lock="$repository_dir/.backup.lock"
    [[ -f "$repository_lock" && ! -L "$repository_lock" ]] || {
      echo "backup retention-plan: deep audit requires an existing safe v2 repository lock" >&2
      return 1
    }
    command -v flock >/dev/null 2>&1 || {
      echo "backup retention-plan: flock is required for deep audit" >&2
      return 1
    }
    exec 7<"$repository_lock"
    flock -s -n 7 || {
      echo "backup retention-plan: v2 repository is busy with another operation" >&2
      return 75
    }
  fi
  docker run --rm --user 0:0 \
    --mount "type=bind,src=$repository_dir,dst=/repo,readonly" \
    --entrypoint /usr/local/bin/xdrive-backup-repo \
    "$server_image" retention-plan --repo /repo --keep-last "$keep_last" --mode "$cas_mode" </dev/null
}

# A destructive backup-repository operation must not point at the live /data
# mount, including any parent/child or symlink-alias of that mount. The normal
# incremental backup writer already makes the same separation mandatory.
backup_prune_require_separate_paths() {
  local repository="$1" source="$2" resolved=""
  [[ "$source" == /* ]] || {
    echo "backup prune: live files location must be an absolute path" >&2
    return 1
  }
  resolved="$(readlink -m -- "$source" 2>/dev/null || readlink -f -- "$source" 2>/dev/null || true)"
  [[ -n "$resolved" ]] || {
    echo "backup prune: cannot verify live file storage path" >&2
    return 1
  }
  # Prefix checks with a trailing slash need an explicit root case:
  # when either side is "/", the other path is necessarily nested.
  if [[ "$repository" == "/" || "$resolved" == "/" ]]; then
    echo "backup prune: repository overlaps live file storage" >&2
    return 1
  fi
  case "$repository/" in
    "$resolved/"*) echo "backup prune: repository overlaps live file storage" >&2; return 1 ;;
  esac
  case "$resolved/" in
    "$repository/"*) echo "backup prune: repository overlaps live file storage" >&2; return 1 ;;
  esac
}

# Destructive Host-only actions share one exact repository guard. The Linux
# helper owns the exclusive .backup.lock inside Docker; never add another Host
# lock on that inode. Selected deletion must not turn into a retention count.
backup_prune_cmd() {
  backup_prune_worker retention "$@"
}
backup_delete_snapshot_cmd() {
  backup_prune_worker selected "$@"
}
backup_preview_delete_snapshot_cmd() {
  backup_prune_worker preview "$@"
}
backup_prune_worker() {
  local operation="$1"
  shift
  [[ "$operation" == retention || "$operation" == selected || "$operation" == preview ]] || return 2
  local repository_dir="" keep_last="" snapshot="" confirmed=0 cas_mode=fast
  local server_id="" server_image="" configured=""
  local live_files_dir="" mounted_data_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repository-dir)
        [[ $# -ge 2 ]] || { echo "backup prune: missing repository path" >&2; return 2; }
        repository_dir="$2"
        shift 2
        ;;
      --keep-last)
        [[ "$operation" == retention && $# -ge 2 ]] || return 2
        keep_last="$2"
        shift 2
        ;;
      --snapshot)
        [[ ( "$operation" == selected || "$operation" == preview ) && $# -ge 2 ]] || return 2
        snapshot="$2"
        shift 2
        ;;
      --mode)
        [[ "$operation" == preview && $# -ge 2 ]] || return 2
        cas_mode="$2"
        shift 2
        ;;
      --yes)
        [[ "$operation" != preview ]] || return 2
        confirmed=1
        shift
        ;;
      *)
        echo "backup: only the documented fixed prune/delete-snapshot flags are supported" >&2
        return 2
        ;;
    esac
  done
  if [[ "$operation" == retention ]]; then
    [[ "$keep_last" =~ ^[1-9][0-9]*$ && -z "$snapshot" && "$confirmed" == 1 ]] || {
      echo "backup prune: explicit --keep-last N --yes is required" >&2
      return 2
    }
  elif [[ "$operation" == selected ]]; then
    [[ -z "$keep_last" && "$snapshot" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ && "$confirmed" == 1 ]] || {
      echo "backup delete-snapshot: exact v2 generation name and --yes required" >&2
      return 2
    }
  else
    [[ -z "$keep_last" && "$snapshot" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ &&
       "$confirmed" == 0 && ( "$cas_mode" == fast || "$cas_mode" == deep ) ]] || {
      echo "backup preview-delete-snapshot: exact v2 generation and fast/deep mode required" >&2
      return 2
    }
  fi
  if [[ -z "$repository_dir" && "$(env_value XD_BACKUP_SCHEDULE_FORMAT)" == "v2" ]]; then
    configured="$(env_value XD_BACKUP_SCHEDULE_REPOSITORY_DIR)"
    [[ -z "$configured" ]] || repository_dir="$configured"
  fi
  [[ -n "$repository_dir" ]] || repository_dir="$BACKUP_DIR/incremental"
  [[ "$repository_dir" == /* && -d "$repository_dir" && ! -L "$repository_dir" ]] || {
    echo "backup prune: repository must be an existing absolute non-symlink directory" >&2
    return 2
  }
  repository_dir="$(cd "$repository_dir" && pwd -P)" || return 1
  # Neither a symlink nor a non-existent generation may enter selected
  # deletion, even though the lower-level helper independently checks this.
  if [[ "$operation" == selected || "$operation" == preview ]]; then
    [[ -d "$repository_dir/snapshots" && ! -L "$repository_dir/snapshots" &&
       -d "$repository_dir/snapshots/$snapshot" &&
       ! -L "$repository_dir/snapshots/$snapshot" ]] || return 2
  fi
  live_files_dir="${XD_FILES_DATA_DIR:-}"
  [[ -n "$live_files_dir" ]] || live_files_dir="$(env_value XD_FILES_DATA_DIR)"
  [[ -n "$live_files_dir" ]] || live_files_dir="$DATA_DIR/files"
  backup_prune_require_separate_paths "$repository_dir" "$live_files_dir" || return 1
  [[ -f "$repository_dir/.backup.lock" && ! -L "$repository_dir/.backup.lock" ]] || {
    echo "backup prune: existing regular repository .backup.lock is required" >&2
    return 1
  }
  command -v docker >/dev/null 2>&1 || { echo "backup prune: Docker is required" >&2; return 1; }
  if [[ -f "$COMPOSE_PATH" && -f "$ENV_PATH" ]]; then
    server_id="$(compose ps -aq server | head -n1 || true)"
  fi
  if [[ -n "$server_id" ]]; then
    # Use the live Server's actual mount source as an additional check;
    # configuration may have changed after that container was created.
    mounted_data_dir="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' </dev/null 2>/dev/null || true)"
    if [[ -n "$mounted_data_dir" ]]; then
      backup_prune_require_separate_paths "$repository_dir" "$mounted_data_dir" || return 1
    fi
    server_image="$(docker inspect "$server_id" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
  fi
  [[ -n "$server_image" ]] || server_image="$(env_value XD_SERVER_IMAGE)"
  [[ -n "$server_image" ]] || {
    echo "backup prune: Server image is not configured" >&2
    return 1
  }
  # All operations share the same verified Server image and reject live-data
  # overlaps. Read-only preview never receives a writable bind, --yes, or a
  # second arbitrary process capability. Deep mode holds a shared writer lock
  # throughout hashing so it cannot race a cooperating v2 writer.
  local -a args
  local repo_mount="type=bind,src=$repository_dir,dst=/repo"
  if [[ "$operation" == preview ]]; then
    args=(preview-delete-snapshot --repo /repo --snapshot "$snapshot" --mode "$cas_mode")
    repo_mount="$repo_mount,readonly"
    if [[ "$cas_mode" == deep ]]; then
      exec 7<"$repository_dir/.backup.lock"
      flock -s -n 7 || {
        echo "backup preview-delete-snapshot: repository busy" >&2
        return 75
      }
    fi
  elif [[ "$operation" == selected ]]; then
    args=(delete-snapshot --repo /repo --snapshot "$snapshot" --yes)
  else
    args=(prune --repo /repo --keep-last "$keep_last" --yes)
  fi
  docker run --rm --network none --user 0:0 \
    --mount "$repo_mount" \
    --entrypoint /usr/local/bin/xdrive-backup-repo \
    "$server_image" "${args[@]}" </dev/null
}

# Host-only, manually invoked v2 recovery rehearsal. Never call the live
# server-restore.sh: all restored database/file content stays in bounded RAM.
backup_isolated_drill_worker() {
  local target="$1" limit="$2" repo snapshot real lock cid live mount image
  local cap=$((limit * 1024 * 1024)) value file pgcode token n cas_name db_name user_uid user_gid
  [[ "$target" == /* && -d "$target" && ! -L "$target" ]] || return 3
  real="$(readlink -f -- "$target" 2>/dev/null || true)"
  [[ -n "$real" && -d "$real" ]] || return 3
  snapshot="$(basename -- "$real")"
  [[ "$snapshot" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || return 3
  [[ "$(basename "$(dirname "$real")")" == snapshots ]] || return 3
  repo="$(readlink -f -- "$(dirname "$(dirname "$real")")" 2>/dev/null || true)"
  [[ -n "$repo" && "$real" == "$repo/snapshots/$snapshot" ]] || return 3
  [[ ! -L "$repo" && ! -L "$repo/snapshots" ]] || return 3
  # Only repositories already recognized by the Host inventory may enter
  # a sandbox. Arbitrary absolute filesystem locations remain prohibited.
  backup_snapshot_roots || return 3
  local allowed_root accepted=false
  for allowed_root in "${BACKUP_SNAPSHOT_ROOTS[@]}"; do
    allowed_root="$(readlink -m -- "$allowed_root" 2>/dev/null || true)"
    if [[ "$allowed_root" == "$repo/snapshots" ]]; then accepted=true; break; fi
  done
  [[ "$accepted" == true ]] || return 3
  # Never mount an online data directory, even as a read-only backup alias.
  for value in "$XDRIVE_HOME/data" "$(env_value XD_FILES_DATA_DIR)" \
      "$(env_value XD_POSTGRES_DATA_DIR)"; do
    [[ -n "$value" ]] || continue
    value="$(readlink -m -- "$value" 2>/dev/null || true)"
    [[ -n "$value" ]] || return 3
    case "$repo/" in "$value/"*) return 3 ;; esac
    case "$value/" in "$repo/"*) return 3 ;; esac
  done
  for live in server postgres; do
    cid="$(compose ps -aq "$live" 2>/dev/null | head -n1 || true)"
    [[ -n "$cid" ]] || continue
    if [[ "$live" == server ]]; then
      mount="$(docker inspect "$cid" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' </dev/null 2>/dev/null)" || return 3
    else
      mount="$(docker inspect "$cid" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Source}}{{end}}{{end}}' </dev/null 2>/dev/null)" || return 3
    fi
    [[ -n "$mount" ]] || return 3
    mount="$(readlink -m -- "$mount" 2>/dev/null || true)"
    [[ -n "$mount" ]] || return 3
    case "$repo/" in "$mount/"*) return 3 ;; esac
    case "$mount/" in "$repo/"*) return 3 ;; esac
  done
  lock="$repo/.backup.lock"
  [[ -f "$lock" && ! -L "$lock" ]] || return 4
  exec 7< "$lock" || return 4
  flock -s -n 7 || return 75
  [[ -f "$real/manifest.json" && ! -L "$real/manifest.json" ]] || return 4
  # No Docker admission from grep matches in duplicate or nested JSON.
  local manifest_info
  manifest_info="$(backup_verified_manifest_info "$real/manifest.json")" || return 4
  [[ "$manifest_info" == $'2\ttrue\ttrue' ]] || return 4
  for file in database.dump verify.json manifest.json objects.index legacy.tar SHA256SUMS.txt; do
    [[ -f "$real/$file" && ! -L "$real/$file" ]] || return 4
  done
  # Refuse huge, invalid or unbounded input before invoking any Docker process.
  if python3 - "$real" "$cap" <<'PY'
import os,re,stat,sys
root,cap=sys.argv[1],int(sys.argv[2])
try:
    def size(name):
        st=os.lstat(os.path.join(root,name))
        if not stat.S_ISREG(st.st_mode): raise ValueError("nonregular")
        return st.st_size
    total=size("legacy.tar")
    if total>cap or size("database.dump")>cap: sys.exit(5)
    fd=os.open(os.path.join(root,"objects.index"),os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,"rb") as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size>64*1024*1024: raise ValueError("unsafe index")
        for row in f:
            fields=row.rstrip(b"\n").split(b"\t")
            if len(fields)!=2 or not re.fullmatch(rb"[0-9a-f]{64}",fields[0]) or \
               not re.fullmatch(rb"(0|[1-9][0-9]{0,18})",fields[1]):
                raise ValueError("invalid index row")
            total+=int(fields[1])
            if total>cap: sys.exit(5)
except (OSError,ValueError):
    sys.exit(4)
PY
  then :; else return $?; fi
  (
    cd "$real" || exit 1
    cmp -s SHA256SUMS.txt <(sha256sum database.dump verify.json manifest.json objects.index legacy.tar)
  ) || return 4
  cid="$(compose ps -aq server 2>/dev/null | head -n1 || true)"
  image=""
  if [[ -n "$cid" ]]; then
    image="$(docker inspect "$cid" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
  fi
  [[ -n "$image" ]] || image="$(env_value XD_SERVER_IMAGE)"
  [[ -n "$image" ]] || return 6
  docker image inspect "$image" >/dev/null 2>&1 || return 6
  docker image inspect postgres:17-alpine >/dev/null 2>&1 || return 6
  user_uid="$(id -u)" || return 6
  user_gid="$(id -g)" || return 6
  [[ "$user_uid" =~ ^[0-9]+$ && "$user_gid" =~ ^[0-9]+$ ]] || return 6
  token="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')" || return 6
  [[ "$token" =~ ^[0-9a-f]{16}$ ]] || return 6
  cas_name="xd-drill-cas-$token"
  db_name="xd-drill-pg-$token"
  # The distroless xDrive helper sees only the immutable repository and /data
  # tmpfs. Its restore command hashes CAS before copying it to memory.
  if ! (
    trap 'docker rm -f "$cas_name" >/dev/null 2>&1 || true' EXIT INT TERM
    timeout --signal=TERM --kill-after=10s 900s \
      docker run --pull never --rm --name "$cas_name" --network none \
      --read-only --cap-drop ALL --security-opt no-new-privileges \
      --pids-limit 64 --cpus 2 --memory "$((limit+256))m" \
      --memory-swap "$((limit+256))m" --user "$user_uid:$user_gid" \
      --tmpfs "/data:rw,nosuid,nodev,noexec,size=${limit}m,uid=$user_uid,gid=$user_gid,mode=0700" \
      --mount "type=bind,src=$repo,dst=/repo,readonly" \
      --entrypoint /usr/local/bin/xdrive-backup-repo "$image" \
      restore --repo /repo --snapshot "$snapshot" --target /data </dev/null
  ) >&2; then return 7; fi
  # PostgreSQL receives ONLY pg_dump custom-format bytes on stdin. No host
  # mounts, live socket/network, or persistent database storage are available.
  pgcode="$(cat <<'SH'
set -eu
export PGDATA=/sandbox/db HOME=/sandbox TMPDIR=/sandbox/tmp
mkdir -p "$PGDATA" /sandbox/socket "$TMPDIR"
chmod 700 "$PGDATA" /sandbox/socket
initdb -D "$PGDATA" -A trust -U xdrive --no-instructions >/dev/null
pg_ctl -D "$PGDATA" -o "-c listen_addresses='' -c unix_socket_directories=/sandbox/socket -c shared_buffers=16MB -c max_connections=10 -c fsync=off" -w start >/dev/null
trap 'pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true' EXIT
createdb -h /sandbox/socket -U xdrive xdrive
pg_restore -Fc --exit-on-error --no-owner --no-privileges -h /sandbox/socket -U xdrive -d xdrive >/dev/null
for relation in xd_nodes xd_files xd_users; do
  psql -qAt -h /sandbox/socket -U xdrive -d xdrive -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) FROM public.$relation" >/dev/null
done
SH
)" || return 8
  if ! (
    trap 'docker rm -f "$db_name" >/dev/null 2>&1 || true' EXIT INT TERM
    timeout --signal=TERM --kill-after=10s 900s \
      docker run --pull never --rm -i --name "$db_name" --network none \
      --read-only --cap-drop ALL --security-opt no-new-privileges \
      --pids-limit 128 --cpus 2 --memory "$((limit+256))m" \
      --memory-swap "$((limit+256))m" --user 70:70 \
      --tmpfs "/sandbox:rw,nosuid,nodev,size=${limit}m,uid=70,gid=70,mode=0700" \
      --tmpfs "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=16m,uid=70,gid=70,mode=0700" \
      --shm-size 32m --entrypoint /bin/sh postgres:17-alpine \
      -ec "$pgcode" < "$real/database.dump"
  ) >&2; then return 8; fi
}

backup_isolated_drill_cmd() {
  [[ $# -eq 1 || $# -eq 3 ]] || {
    echo "usage: xdrive-server backup drill ABSOLUTE_V2_SNAPSHOT [--max-mib 256..8192]" >&2
    return 2
  }
  local source="$1" limit=1024 result=0 state=failed category="" exe
  local name started finished files=false database=false
  if [[ $# -eq 3 ]]; then
    [[ "$2" == --max-mib && "$3" =~ ^[1-9][0-9]{2,3}$ ]] || return 2
    limit="$3"
  fi
  (( limit >= 256 && limit <= 8192 )) || return 2
  name="$(basename -- "$source")"
  [[ "$name" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ ]] || name="unavailable"
  for exe in docker python3 timeout sha256sum readlink flock; do
    command -v "$exe" >/dev/null 2>&1 || return 2
  done
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if backup_isolated_drill_worker "$source" "$limit"; then state=success
  else result=$?; fi
  case "$result" in
    0) category="" ; files=true; database=true ;;
    3) category=unsafe_snapshot ;;
    4) category=invalid_snapshot_checksum ;;
    5) category=sandbox_quota_exceeded ;;
    6) category=runtime_unavailable ;;
    7) category=file_restore_failed ;;
    8) category=postgresql_restore_failed; files=true ;;
    75) category=repository_busy ;;
    *) category=drill_failed ;;
  esac
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"protocol":"xdrive-host-isolated-drill-v1","state":"%s","environment":"host_ephemeral_offline_tmpfs","snapshot":"%s","started_at":"%s","finished_at":"%s","files_restored":%s,"postgresql_restored":%s,"production_verified":false,"max_mib":%s,"failure_category":"%s"}\n' \
    "$state" "$name" "$started" "$finished" "$files" "$database" "$limit" "$category"
  return "$result"
}

backup_cmd() {
  local subcommand="${1:-}"
  case "$subcommand" in
    list)
      shift
      backup_list_cmd "$@"
      ;;
    verify)
      shift
      backup_verify_cmd "$@"
      ;;
    drill)
      shift
      backup_isolated_drill_cmd "$@"
      ;;
    retention-plan)
      shift
      backup_retention_plan_cmd "$@"
      ;;
    prune)
      shift
      backup_prune_cmd "$@"
      ;;
    delete-snapshot)
      shift
      backup_delete_snapshot_cmd "$@"
      ;;
    preview-delete-snapshot)
      shift
      backup_preview_delete_snapshot_cmd "$@"
      ;;
    sources)
      shift
      backup_sources_cmd "$@"
      ;;
    create)
      shift
      backup_create_cmd "$@"
      ;;
    *)
      backup_create_cmd "$@"
      ;;
  esac
}

restore_cmd() {
  local script="$BIN_DIR/server-restore.sh" status read_only_preflight=0 arg
  [[ -x "$script" ]] || {
    echo "xdrive-server: restore tool is not installed at $script" >&2
    return 1
  }
  for arg in "$@"; do
    if [[ "$arg" == --preflight-only ]]; then read_only_preflight=1; fi
  done
  if XD_CONFIG_DIR="$XDRIVE_HOME" "$script" "$@"; then status=0; else status=$?; fi
  # The read-only v1 readiness probe does not restore a live system, even if
  # it passes all manifest, SHA-256, tar and PG TOC checks. Never record a
  # fake production restore success (or failure) for this inspection.
  if [[ "$read_only_preflight" == 1 ]]; then return "$status"; fi
  if [[ "$status" -eq 0 ]]; then
    record_system_audit system.restore success
  else
    record_system_audit system.restore failure
  fi
  return "$status"
}

migrate_user_cmd() {
  local script="$BIN_DIR/server-migrate-user.sh"
  [[ -x "$script" ]] || {
    echo "xdrive-server: migration tool is not installed at $script" >&2
    return 1
  }
  if [[ "${EUID:-$(id -u)}" -ne 0 && "${XD_MIGRATE_TEST_ALLOW_NONROOT:-0}" != "1" ]]; then
    echo "xdrive-server: migrate-user must be started by root." >&2
    return 1
  fi
  XD_SOURCE_CONFIG_DIR="$XDRIVE_HOME" exec "$script" "$@"
}

verify_cmd() {
  local script="$BIN_DIR/server-verify.sh" status repair=0 dry_run=0 arg
  [[ -x "$script" ]] || {
    echo "xdrive-server: verify tool is not installed at $script" >&2
    return 1
  }
  for arg in "$@"; do
    [[ "$arg" == "--repair" ]] && repair=1
    [[ "$arg" == "--dry-run" ]] && dry_run=1
  done
  if XD_CONFIG_DIR="$XDRIVE_HOME" "$script" "$@"; then status=0; else status=$?; fi
  if [[ "$repair" == "1" && "$dry_run" != "1" ]]; then
    if [[ "$status" -eq 0 ]]; then
      record_system_audit system.storage_repair success
    else
      record_system_audit system.storage_repair failure
    fi
  fi
  return "$status"
}

source_cmd() {
  local subcommand="${1:-}"
  case "$subcommand" in
    verify)
      shift
      compose exec -T server xdrive-server source verify "$@"
      ;;
    *)
      echo "usage: xdrive-server source verify [--json]" >&2
      return 2
      ;;
  esac
}

media_cmd() {
  local subcommand="${1:-}"
  case "$subcommand" in
    status)
      shift
      compose exec -T server xdrive-server media status "$@"
      ;;
    verify)
      shift
      compose exec -T server xdrive-server media verify "$@"
      ;;
    repair)
      shift
      local dry_run=0 status arg
      for arg in "$@"; do
        [[ "$arg" == "--dry-run" ]] && dry_run=1
      done
      if compose exec -T server xdrive-server media repair "$@"; then status=0; else status=$?; fi
      if [[ "$dry_run" != "1" ]]; then
        if [[ "$status" -eq 0 ]]; then
          record_system_audit system.media_repair success
        else
          record_system_audit system.media_repair failure
        fi
      fi
      return "$status"
      ;;
    *)
      echo "usage: xdrive-server media <status|verify|repair> [options]" >&2
      return 2
      ;;
  esac
}

remove_backup_schedule() {
  command -v crontab >/dev/null 2>&1 || return 0
  local current tmp
  current="$(crontab -l 2>/dev/null || true)"
  [[ -n "$current" ]] || return 0
  tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-crontab.XXXXXX")"
  printf '%s\n' "$current" | grep -v '# xdrive-managed-backup$' > "$tmp" || true
  crontab "$tmp"
  rm -f "$tmp"
}

legacy_volume_candidates() {
  [[ -f "$LEGACY_VOLUMES_RECORD" ]] || return 0
  awk -F= '
    $1 ~ /^(files|postgres|caddy_data|caddy_config)$/ && length($2) > 0 {
      print $2
    }
  ' "$LEGACY_VOLUMES_RECORD" | awk 'NF && !seen[$0]++'
}

cleanup_legacy_volumes_cmd() {
  local confirm=0 arg volume attached remaining=0
  for arg in "$@"; do
    case "$arg" in
      --yes) confirm=1 ;;
      *) echo "usage: xdrive-server cleanup legacy-volumes [--yes]" >&2; return 2 ;;
    esac
  done

  mapfile -t volumes < <(legacy_volume_candidates)
  if [[ "${#volumes[@]}" -eq 0 ]]; then
    echo "No retained legacy xDrive volumes are recorded."
    rm -f "$LEGACY_VOLUMES_RECORD"
    return 0
  fi

  echo "Retained legacy Docker volumes:"
  printf '  %s\n' "${volumes[@]}"
  if [[ "$confirm" != "1" ]]; then
    echo "No changes made. Rerun with --yes after confirming the bind-mounted deployment and backups are healthy."
    return 2
  fi

  for volume in "${volumes[@]}"; do
    if ! docker volume inspect "$volume" </dev/null >/dev/null 2>&1; then
      echo "[xDrive] legacy volume already absent: $volume"
      continue
    fi
    attached="$(docker ps -aq --filter "volume=$volume" </dev/null 2>/dev/null || true)"
    if [[ -n "$attached" ]]; then
      echo "xdrive-server: refusing to remove legacy volume $volume because container(s) still reference it: $attached" >&2
      remaining=1
      continue
    fi
    echo "[xDrive] removing retained legacy volume: $volume"
    if ! docker volume rm "$volume" </dev/null; then
      remaining=1
    fi
  done

  for volume in "${volumes[@]}"; do
    if docker volume inspect "$volume" </dev/null >/dev/null 2>&1; then
      remaining=1
    fi
  done
  if [[ "$remaining" == "0" ]]; then
    rm -f "$LEGACY_VOLUMES_RECORD"
    echo "Legacy xDrive volumes cleaned up."
    if [[ -f "$STATE_DIR/runtime-uninstalled" ]]; then
      local purge_all=0
      grep -q '^purge_all=1$' "$STATE_DIR/runtime-uninstalled" && purge_all=1
      rm -f "$STATE_DIR/runtime-uninstalled"
      rm -f "$BIN_DIR/xdrive-server"
      rmdir "$BIN_DIR" "$STATE_DIR" 2>/dev/null || true
      remove_user_command_path
      if [[ "$purge_all" == "1" ]]; then
        rm -f "$ENV_PATH"
        rmdir "$CONFIG_DIR" "$DATA_DIR/caddy" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR" "$XDRIVE_HOME" 2>/dev/null || true
        echo "xDrive fully uninstalled after legacy-volume cleanup."
      else
        echo "Retained cleanup manager removed."
      fi
    fi
    return 0
  fi
  echo "xdrive-server: one or more retained legacy volumes remain; the record was kept at $LEGACY_VOLUMES_RECORD" >&2
  return 1
}

cleanup_cmd() {
  local target="${1:-}"
  [[ -n "$target" ]] || {
    echo "usage: xdrive-server cleanup legacy-volumes [--yes]" >&2
    return 2
  }
  shift || true
  case "$target" in
    legacy-volumes) cleanup_legacy_volumes_cmd "$@" ;;
    *) echo "xdrive-server: unknown cleanup target: $target" >&2; return 2 ;;
  esac
}

canonical_path() {
  local path="$1"
  if command -v readlink >/dev/null 2>&1; then
    readlink -m "$path" 2>/dev/null && return 0
  fi
  printf '%s\n' "$path"
}

validate_purge_path() {
  local label="$1" path="$2" resolved home_resolved
  [[ -n "$path" && "$path" == /* ]] || {
    echo "xdrive-server: refusing to purge $label because its path is not absolute: $path" >&2
    return 1
  }
  resolved="$(canonical_path "$path")"
  home_resolved="$(canonical_path "$XDRIVE_HOME")"
  case "$resolved" in
    /|/home|/root|/usr|/etc|/var|/var/lib|/opt|"$HOME"|"$home_resolved"|"$CONFIG_DIR"|"$BACKUP_DIR"|"$BIN_DIR"|"$LOG_DIR"|"$STATE_DIR")
      echo "xdrive-server: refusing dangerous purge path for $label: $resolved" >&2
      return 1
      ;;
  esac
}

purge_container_owned_dir() {
  local label="$1" path="$2" helper_image
  [[ -e "$path" ]] || return 0
  validate_purge_path "$label" "$path"
  helper_image="$(env_value XD_POSTGRES_IMAGE)"
  [[ -n "$helper_image" ]] || helper_image="postgres:17-alpine"
  echo "[xDrive] purging $label: $path"
  docker run --rm --entrypoint sh \
    -v "$path:/xdrive-purge" \
    "$helper_image" \
    -ec 'find /xdrive-purge -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' </dev/null
  rmdir "$path" 2>/dev/null || true
}

uninstall_cmd() {
  local purge_data=0 purge_backups=0 confirm=0 arg
  local files_dir postgres_dir caddy_data_dir caddy_config_dir
  for arg in "$@"; do
    case "$arg" in
      --purge-data) purge_data=1 ;;
      --purge-backups) purge_backups=1 ;;
      --yes) confirm=1 ;;
      *) echo "usage: xdrive-server uninstall [--purge-data] [--purge-backups] --yes" >&2; return 2 ;;
    esac
  done
  if [[ "$confirm" != "1" ]]; then
    echo "xdrive-server: uninstall requires --yes. Data and backups are preserved unless their purge flags are also supplied." >&2
    return 2
  fi

  files_dir="$(env_value XD_FILES_DATA_DIR)"
  postgres_dir="$(env_value XD_POSTGRES_DATA_DIR)"
  caddy_data_dir="$(env_value XD_CADDY_DATA_DIR)"
  caddy_config_dir="$(env_value XD_CADDY_CONFIG_DIR)"
  [[ -n "$files_dir" ]] || files_dir="$DATA_DIR/files"
  [[ -n "$postgres_dir" ]] || postgres_dir="$DATA_DIR/postgres"
  [[ -n "$caddy_data_dir" ]] || caddy_data_dir="$DATA_DIR/caddy/data"
  [[ -n "$caddy_config_dir" ]] || caddy_config_dir="$DATA_DIR/caddy/config"

  if [[ "$purge_data" == "1" ]]; then
    validate_purge_path "file data" "$files_dir"
    validate_purge_path "PostgreSQL data" "$postgres_dir"
    validate_purge_path "Caddy data" "$caddy_data_dir"
    validate_purge_path "Caddy config" "$caddy_config_dir"
  fi

  if [[ -x "$BIN_DIR/server-control.sh" ]]; then
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" stop || true
    XD_CONFIG_DIR="$XDRIVE_HOME" "$BIN_DIR/server-control.sh" remove-schedule || true
  fi

  if [[ -f "$ENV_PATH" && -f "$COMPOSE_PATH" ]]; then
    echo "[xDrive] stopping and removing xDrive containers and network..."
    compose down --remove-orphans
  else
    echo "[xDrive] no active Compose deployment found; cleaning host control files only."
  fi

  remove_backup_schedule

  if [[ "$purge_data" == "1" ]]; then
    purge_container_owned_dir "file data" "$files_dir"
    purge_container_owned_dir "PostgreSQL data" "$postgres_dir"
    purge_container_owned_dir "Caddy data" "$caddy_data_dir"
    purge_container_owned_dir "Caddy config" "$caddy_config_dir"
    rmdir "$DATA_DIR/caddy" "$DATA_DIR" 2>/dev/null || true
  fi
  if [[ "$purge_backups" == "1" ]]; then
    echo "[xDrive] purging backups: $BACKUP_DIR"
    rm -rf "$BACKUP_DIR"
  fi

  rm -f "$CONFIG_DIR/docker-compose.yml" "$CONFIG_DIR/Caddyfile"
  rm -rf "$LOG_DIR"

  if [[ -f "$LEGACY_VOLUMES_RECORD" ]]; then
    local retained_tmp manager_tmp purge_all=0
    [[ "$purge_data" == "1" && "$purge_backups" == "1" ]] && purge_all=1
    retained_tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-legacy-volumes.XXXXXX")"
    manager_tmp="$(mktemp "${TMPDIR:-/tmp}/xdrive-manager.XXXXXX")"
    cp "$LEGACY_VOLUMES_RECORD" "$retained_tmp"
    cp "$BIN_DIR/xdrive-server" "$manager_tmp"
    rm -rf "$STATE_DIR" "$BIN_DIR"
    mkdir -p "$STATE_DIR" "$BIN_DIR"
    chmod 700 "$STATE_DIR" "$BIN_DIR"
    mv "$retained_tmp" "$LEGACY_VOLUMES_RECORD"
    mv "$manager_tmp" "$BIN_DIR/xdrive-server"
    chmod 600 "$LEGACY_VOLUMES_RECORD"
    chmod 700 "$BIN_DIR/xdrive-server"
    printf 'purge_all=%s\n' "$purge_all" > "$STATE_DIR/runtime-uninstalled"
    chmod 600 "$STATE_DIR/runtime-uninstalled"
    echo "[xDrive] retained legacy-volume record: $LEGACY_VOLUMES_RECORD"
    echo "[xDrive] cleanup-only manager retained at $BIN_DIR/xdrive-server"
    echo "[xDrive] run '$BIN_DIR/xdrive-server cleanup legacy-volumes --yes' when you are ready to remove the old volumes."
  else
    rm -rf "$STATE_DIR" "$BIN_DIR"
    remove_user_command_path
  fi

  if [[ "$purge_data" == "1" && "$purge_backups" == "1" && ! -f "$LEGACY_VOLUMES_RECORD" ]]; then
    rm -f "$ENV_PATH"
    rmdir "$CONFIG_DIR" "$DATA_DIR/caddy" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR" "$XDRIVE_HOME" 2>/dev/null || true
    echo "xDrive fully uninstalled; runtime, data, backups, and retained configuration were removed."
    return 0
  fi

  echo "xDrive runtime uninstalled."
  [[ -f "$ENV_PATH" ]] && echo "Retained configuration/secrets: $ENV_PATH"
  [[ "$purge_data" != "1" ]] && echo "Retained data: $files_dir, $postgres_dir, $caddy_data_dir, $caddy_config_dir"
  [[ "$purge_backups" != "1" ]] && echo "Retained backups: $BACKUP_DIR"
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
  if ! compose exec -T server xdrive-server version 2>/dev/null; then
    channel="$(env_value XD_RELEASE_CHANNEL)"
    commit="$(env_value XD_RELEASE_COMMIT)"
    printf 'server version: unavailable\n'
    printf 'channel: %s\n' "${channel:-unknown}"
    [[ -n "$commit" ]] && printf 'commit: %s\n' "$commit"
  fi
  image="$(env_value XD_SERVER_IMAGE)"
  [[ -n "$image" ]] && printf 'server image: %s\n' "$image"
}

cmd="${1:-}"
[[ -n "$cmd" ]] || { usage >&2; exit 2; }
shift || true

case "$cmd" in
  update) update_cmd "$@" ;;
  control) control_cmd "$@" ;;
  doctor) doctor_cmd "$@" ;;
  lan-ca) lan_ca_cmd "$@" ;;
  status) status_cmd "$@" ;;
  backup) backup_cmd "$@" ;;
  restore) restore_cmd "$@" ;;
  verify) verify_cmd "$@" ;;
  source) source_cmd "$@" ;;
  media) media_cmd "$@" ;;
  migrate-user) migrate_user_cmd "$@" ;;
  cleanup) cleanup_cmd "$@" ;;
  uninstall) uninstall_cmd "$@" ;;
  admin) admin_cmd "$@" ;;
  version) version_cmd ;;
  -h|--help|help) usage ;;
  *) echo "xdrive-server: unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
