#!/bin/sh
# Select only shipped, static Caddyfiles. Never substitute unvalidated IP
# strings into a shell command or turn on plaintext LAN authentication.
set -eu

private_ipv4() {
  address="$1"
  case "$address" in
    ''|*[!0-9.]*|.*|*.|*..*) return 1 ;;
  esac
  saved_ifs="$IFS"
  IFS=.
  # The character allowlist above excludes whitespace and glob metacharacters.
  set -- $address
  IFS="$saved_ifs"
  [ "$#" -eq 4 ] || return 1
  for octet in "$@"; do
    case "$octet" in ''|0?*) return 1 ;; esac
    [ "$octet" -le 255 ] 2>/dev/null || return 1
  done
  case "$1" in
    10) return 0 ;;
    172) [ "$2" -ge 16 ] && [ "$2" -le 31 ]; return $? ;;
    192) [ "$2" -eq 168 ]; return $? ;;
  esac
  return 1
}

# New installs require one of the two HTTPS entries; old domainless HTTP
# deployments can remain in compatibility mode only with an explicit marker.
case "${XD_LEGACY_HTTP_ONLY:-0}" in
  0|1) ;;
  *) echo "xDrive Caddy: invalid legacy compatibility mode." >&2; exit 1 ;;
esac
if [ -n "${XD_LAN_HTTPS_IP:-}" ]; then
  if ! private_ipv4 "$XD_LAN_HTTPS_IP"; then
    echo "xDrive Caddy: XD_LAN_HTTPS_IP must be a canonical RFC1918 IPv4 address." >&2
    exit 1
  fi
  if [ -n "${XD_DOMAIN:-}" ]; then
    config=/etc/caddy/Caddyfile.lan-ip
  else
    config=/etc/caddy/Caddyfile.lan-only
  fi
elif [ -n "${XD_DOMAIN:-}" ]; then
  config=/etc/caddy/Caddyfile
elif [ "${XD_LEGACY_HTTP_ONLY:-0}" = "1" ]; then
  config=/etc/caddy/Caddyfile.http
else
  echo "xDrive Caddy: cannot disable both LAN IP HTTPS and domain HTTPS." >&2
  exit 1
fi

# Test-only/diagnostic mode: validates the selector without running Caddy.
if [ "${1:-}" = "--check" ]; then
  printf '%s\n' "$config"
  exit 0
fi
exec caddy run --config "$config" --adapter caddyfile
