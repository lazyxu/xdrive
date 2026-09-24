#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MASTER_SHA="0123456789abcdef0123456789abcdef01234567"
MASTER_SHORT="${MASTER_SHA:0:12}"

mkdir -p "$TMP/bin-ok" "$TMP/bin-fail" "$TMP/state"

cat > "$TMP/bin-ok/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
out=""
write_out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --*=*)
      echo "old curl mock rejects equals-style long option: $1" >&2
      exit 2
      ;;
    -o|--output)
      out="$2"; shift 2 ;;
    --retry|--retry-delay|--connect-timeout)
      [[ $# -ge 2 ]] || exit 2
      shift 2 ;;
    -w|--write-out)
      write_out="$2"; shift 2 ;;
    -f|-L|-s|-S|-fsSL)
      shift ;;
    -*)
      shift ;;
    *)
      url="$1"; shift ;;
  esac
done
[[ -n "$url" ]]
printf '%s\n' "$url" >> "$TEST_STATE/urls"

emit() {
  if [[ -n "$out" ]]; then
    printf '%s' "$1" > "$out"
    if [[ -n "$write_out" ]]; then
      printf '128\t64\t2.0'
    fi
  else
    printf '%s' "$1"
  fi
}

case "$url" in
  */git/ref/tags/snapshot)
    emit '{
  "ref": "refs/tags/snapshot",
  "object": {
    "type": "commit",
    "sha": "0123456789abcdef0123456789abcdef01234567"
  }
}'
    ;;
  */releases/tags/snapshot-0123456789ab)
    emit '{"tag_name":"snapshot-0123456789ab"}'
    ;;
  */0123456789abcdef0123456789abcdef01234567/deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
'
    ;;
  */0123456789abcdef0123456789abcdef01234567/deploy/Caddyfile)
    emit 'example.invalid { respond "ok" }
'
    ;;
  */0123456789abcdef0123456789abcdef01234567/scripts/server-backup.sh)
    emit '#!/usr/bin/env bash
set -euo pipefail
output=""
leave=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) shift 2 ;;
    --output-dir) output="$2"; shift 2 ;;
    --leave-server-stopped) leave=1; shift ;;
    *) shift ;;
  esac
done
[[ "$leave" == "1" ]]
dir="$output/xdrive-backup-test"
mkdir -p "$dir"
printf "%s\n" "$dir"
'
    ;;
  */0123456789abcdef0123456789abcdef01234567/scripts/server-backup-scheduled.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-restore.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-verify.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-doctor.sh)
    emit '#!/usr/bin/env bash
exit 0
'
    ;;
  *)
    echo "unexpected URL: $url" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin-ok/curl"

cat > "$TMP/bin-ok/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 2 && "$1" == "compose" && "$2" == "version" ]]; then
  echo "Docker Compose version v2.test"
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin-ok/docker"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-ok" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/ok.out" 2>"$TMP/ok.err"

grep -q '\[xDrive\] \[1/9\] resolve release channel' "$TMP/ok.out"
grep -q 'Resolved latest fully published master snapshot: 0123456789ab' "$TMP/ok.out"
grep -q '\[xDrive\] \[9/9\] complete' "$TMP/ok.out"
grep -q "XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-$MASTER_SHORT" "$TMP/config-ok/.env"
grep -q "XD_WEB_IMAGE=ghcr.io/lazyxu/xdrive-web:sha-$MASTER_SHORT" "$TMP/config-ok/.env"
grep -q "XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-$MASTER_SHORT" "$TMP/config-ok/.env"
grep -q "XD_HTTPS_PORT=8443" "$TMP/config-ok/.env"
grep -q "/$MASTER_SHA/deploy/docker-compose.yml$" "$TMP/state/urls"

if grep -Eq -- '--(retry|retry-delay|connect-timeout|write-out)=' "$INSTALLER"; then
  echo "installer must use old-curl-compatible space-separated long option values" >&2
  exit 1
fi

if grep -q '/releases/download/snapshot/xdrive-server-install.sh$' "$TMP/state/urls"; then
  echo "raw master installer must not recursively download another installer" >&2
  cat "$TMP/state/urls" >&2
  exit 1
fi

cat > "$TMP/bin-fail/curl" <<'SH'
#!/usr/bin/env bash
exit 22
SH
chmod +x "$TMP/bin-fail/curl"

set +e
PATH="$TMP/bin-fail:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-fail" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/fail.out" 2>"$TMP/fail.err"
status=$?
set -e

[[ "$status" -ne 0 ]]
grep -q 'could not resolve the rolling master snapshot' "$TMP/fail.err"
grep -q '\[xDrive\] FAILED at stage 1/9: resolve release channel' "$TMP/fail.err"
if grep -q 'unresolved deployment template' "$TMP/fail.err"; then
  echo "installer fell back to the old unresolved-template failure" >&2
  cat "$TMP/fail.err" >&2
  exit 1
fi

# Existing deployments may have a stale .env password while PostgreSQL is
# healthy. Reproduce the production failure: the managed container still exists
# under its conventional Compose name, but Docker-network password auth fails.
mkdir -p "$TMP/bin-upgrade" "$TMP/config-upgrade"
cp "$TMP/bin-ok/curl" "$TMP/bin-upgrade/curl"

cat > "$TMP/bin-upgrade/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >> "$TEST_STATE/docker-calls"

if [[ "$#" -ge 2 && "$1" == "compose" && "$2" == "version" ]]; then
  echo "Docker Compose version v2.test"
  exit 0
fi

# Conventional Compose container names must be detected even when label lookup
# is unavailable.
if [[ "$1" == "inspect" && "$2" == "xdrive-postgres-1" && "$args" != *"--format"* ]]; then
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-server-1" && "$args" != *"--format"* ]]; then
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-postgres-1" && "$args" == *".State.Running"* ]]; then
  echo "true"
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-postgres-1" && "$args" == *".Config.Env"* ]]; then
  echo "POSTGRES_PASSWORD=stale-db-password"
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-server-1" && "$args" == *".Config.Env"* ]]; then
  echo "XD_JWT_SECRET=legacy-jwt-secret"
  exit 0
fi

if [[ "$1" == "exec" && "$args" == *"pg_isready"* ]]; then
  exit 0
fi

# Bridge-address authentication fails with the stale password until the local
# socket repair has changed the database role.
if [[ "$1" == "exec" && "$args" == *"PGPASSWORD=stale-db-password"* && "$args" == *"hostname -i"* ]]; then
  if [[ -f "$TEST_STATE/password-repaired" ]]; then
    exit 0
  fi
  exit 1
fi

# Local Unix-socket access remains available to the managed PostgreSQL
# superuser, allowing a safe ALTER ROLE without touching the data volume.
if [[ "$1" == "exec" && "$args" == *"psql -U xdrive -d xdrive -Atqc SELECT 1"* ]]; then
  exit 0
fi
if [[ "$1" == "exec" && "$2" == "-i" && "$args" == *"psql -U xdrive -d xdrive -v ON_ERROR_STOP=1"* ]]; then
  cat >/dev/null
  touch "$TEST_STATE/password-repaired"
  exit 0
fi

if [[ "$1" == "compose" && ( "$args" == *" ps -q server"* || "$args" == *" ps -aq server"* ) ]]; then
  echo "xdrive-server-1"
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin-upgrade/docker"

cat > "$TMP/config-upgrade/.env" <<'EOF'
POSTGRES_PASSWORD=stale-db-password
XD_RELEASE_CHANNEL=master
EOF
cat > "$TMP/config-upgrade/docker-compose.yml" <<'EOF'
name: xdrive
services: {}
EOF
cat > "$TMP/config-upgrade/server-backup.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
echo "mock pre-upgrade backup"
SH
chmod +x "$TMP/config-upgrade/server-backup.sh"

rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
if ! TEST_STATE="$TMP/state" \
PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-upgrade" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
bash "$INSTALLER" >"$TMP/upgrade.out" 2>"$TMP/upgrade.err"; then
  echo "upgrade recovery scenario failed" >&2
  cat "$TMP/upgrade.out" >&2 || true
  cat "$TMP/upgrade.err" >&2 || true
  echo "docker calls:" >&2
  cat "$TMP/state/docker-calls" >&2 || true
  exit 1
fi

test -f "$TMP/state/password-repaired"
grep -q '^POSTGRES_PASSWORD=stale-db-password$' "$TMP/config-upgrade/.env"
grep -q '^XD_JWT_SECRET=legacy-jwt-secret$' "$TMP/config-upgrade/.env"
grep -q 'Repaired the managed PostgreSQL role password to match xDrive configuration and verified Docker-network authentication.' "$TMP/upgrade.out"
grep -q 'Recovered JWT secret from the existing xDrive server container.' "$TMP/upgrade.out"
grep -q '\[xDrive\] existing deployment detected; entering upgrade maintenance window...' "$TMP/upgrade.out"
grep -q '\[xDrive\] transaction armed; rollback backup:' "$TMP/upgrade.out"

echo "server installer bootstrap and stage-reporting tests passed"
