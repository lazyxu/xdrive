#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCTOR="$ROOT/scripts/server-doctor.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home/config" "$TMP/home/data/files" "$TMP/home/data/postgres" "$TMP/home/data/caddy/data" "$TMP/home/data/caddy/config" "$TMP/home/state" "$TMP/state"

cat > "$TMP/home/config/.env" <<'EOF'
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
chmod 600 "$TMP/home/config/.env"
printf 'name: xdrive\nservices: {}\n' > "$TMP/home/config/docker-compose.yml"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$1" == "--version" ]]; then echo "Docker version test"; exit 0; fi
if [[ "$1" == "compose" && "$2" == "version" ]]; then echo "Docker Compose version v2.test"; exit 0; fi
if [[ "$1" == "info" ]]; then
  if [[ "$args" == *"--format"* ]]; then echo '[]'; else echo "/"; fi
  exit 0
fi
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
    exec)
      echo 'cas metadata health: status=ok ready=3 deleting=0 stale_deleting=0 missing_metadata=0 refcount_mismatch=0 state_mismatch=0 size_mismatch=0 key_hash_mismatch=0 invalid_state=0'
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
printf '%s\n' "$*" >> "$TEST_STATE/curl-args"
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

TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report" 2>"$TMP/err"

grep -q '^xDrive server diagnostic report' "$TMP/report"
grep -q '\[PASS\] Docker' "$TMP/report"
grep -q '\[PASS\] Docker access' "$TMP/report"
grep -q 'mode=rootful; usable without sudo' "$TMP/report"
grep -q '\[PASS\] host layout' "$TMP/report"
grep -q '\[PASS\] PostgreSQL auth' "$TMP/report"
grep -q '\[PASS\] CAS metadata health' "$TMP/report"
grep -q '\[PASS\] TLS/local HTTPS' "$TMP/report"
grep -q '/api/v1/readyz' "$TMP/state/curl-args"
grep -q 'https://api.github.com/' "$TMP/state/curl-args"
grep -q 'https://github.com/' "$TMP/state/curl-args"
grep -q 'https://release-assets.githubusercontent.com/' "$TMP/state/curl-args"
grep -q 'https://ghcr.io/v2/' "$TMP/state/curl-args"
grep -q 'https://pkg-containers.githubusercontent.com/' "$TMP/state/curl-args"
grep -q 'summary:' "$TMP/report"

cat >> "$TMP/home/config/.env" <<'EOF'
XD_UPDATE_SOURCE=gitlab
XD_IMAGE_REGISTRY=registry.gitlab.example/xuliang/xdrive
EOF
: > "$TMP/state/curl-args"
TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-gitlab" 2>"$TMP/err-gitlab"
grep -q 'source=gitlab channel=master' "$TMP/report-gitlab"
grep -q 'http://gitlab.t-fluid.com:1080/xuliang/xdrive' "$TMP/state/curl-args"
grep -q 'http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive' "$TMP/state/curl-args"
grep -q 'https://registry.gitlab.example/v2/' "$TMP/state/curl-args"
if grep -q 'https://api.github.com/' "$TMP/state/curl-args"; then
  echo "GitLab doctor path unexpectedly probed GitHub" >&2
  exit 1
fi

for secret in super-secret-db-password super-secret-jwt super-secret-alidns token-should-not-leak db-password-should-not-leak refresh-should-not-leak env-should-not-leak; do
  if grep -Fq "$secret" "$TMP/report" "$TMP/err"; then
    echo "doctor leaked secret: $secret" >&2
    exit 1
  fi
done
grep -q '<redacted>' "$TMP/report"

echo "server doctor tests passed"
