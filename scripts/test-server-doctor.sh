#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCTOR="$ROOT/scripts/server-doctor.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/config"

cat > "$TMP/config/.env" <<'EOF'
POSTGRES_PASSWORD=super-secret-db-password
XD_JWT_SECRET=super-secret-jwt
ALIYUN_ACCESS_KEY_SECRET=super-secret-alidns
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=0123456789abcdef0123456789abcdef01234567
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-0123456789ab
XD_DOMAIN=drive.example.test
XD_HTTPS_PORT=8443
XD_HTTPS_BIND=0.0.0.0
EOF
chmod 600 "$TMP/config/.env"
printf 'name: xdrive\nservices: {}\n' > "$TMP/config/docker-compose.yml"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$1" == "--version" ]]; then echo "Docker version test"; exit 0; fi
if [[ "$1" == "compose" && "$2" == "version" ]]; then echo "Docker Compose version v2.test"; exit 0; fi
if [[ "$1" == "info" ]]; then echo "/"; exit 0; fi
if [[ "$1" == "inspect" ]]; then
  if [[ "$args" == *".State.Status"* ]]; then echo "running"; exit 0; fi
  if [[ "$args" == *".State.Health"* ]]; then echo "healthy"; exit 0; fi
  if [[ "$args" == *".Config.Image"* ]]; then echo "ghcr.io/lazyxu/test:sha-test"; exit 0; fi
  if [[ "$args" == *".Mounts"* ]]; then echo "volume=xdrive_test-data"; exit 0; fi
fi
if [[ "$1" == "exec" ]]; then exit 0; fi
if [[ "$1" == "compose" ]]; then
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --profile|--env-file|-f) shift 2 ;;
      *) break ;;
    esac
  done
  case "$1" in
    ps)
      case "${@: -1}" in
        postgres) echo "pg-id" ;;
        server) echo "server-id" ;;
        web) echo "web-id" ;;
        caddy) echo "caddy-id" ;;
      esac
      exit 0
      ;;
    logs)
      echo 'server | Authorization: Bearer token-should-not-leak'
      echo 'server | postgres://xdrive:db-password-should-not-leak@postgres:5432/xdrive'
      echo 'server | refresh_token=refresh-should-not-leak'
      echo 'server | POSTGRES_PASSWORD=env-should-not-leak'
      exit 0
      ;;
  esac
fi
echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  if [[ "$arg" == "-w" || "$arg" == "--write-out" ]]; then
    printf '401'
    exit 0
  fi
done
exit 0
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/df" <<'SH'
#!/usr/bin/env bash
echo 'Filesystem Size Used Avail Use% Mounted on'
echo '/dev/test 100G 20G 80G 20% /'
SH
chmod +x "$TMP/bin/df"

PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/config" \
  bash "$DOCTOR" >"$TMP/report" 2>"$TMP/err"

grep -q '^xDrive server diagnostic report' "$TMP/report"
grep -q '\[PASS\] Docker' "$TMP/report"
grep -q '\[PASS\] PostgreSQL auth' "$TMP/report"
grep -q '\[PASS\] TLS/local HTTPS' "$TMP/report"
grep -q 'summary:' "$TMP/report"

for secret in super-secret-db-password super-secret-jwt super-secret-alidns token-should-not-leak db-password-should-not-leak refresh-should-not-leak env-should-not-leak; do
  if grep -Fq "$secret" "$TMP/report" "$TMP/err"; then
    echo "doctor leaked secret: $secret" >&2
    exit 1
  fi
done
grep -q '<redacted>' "$TMP/report"

echo "server doctor tests passed"
