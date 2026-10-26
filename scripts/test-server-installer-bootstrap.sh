#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "server installer bootstrap test failed (exit $status)" >&2
    for file in ok.out ok.err signed.out signed.err tampered.out tampered.err bad-incomplete.err bad-malformed.err fail.out fail.err upgrade.out upgrade.err state/urls state/docker-calls; do
      if [[ -f "$TMP/$file" ]]; then
        echo "===== $file =====" >&2
        cat "$TMP/$file" >&2 || true
      fi
    done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

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

if [[ "${TEST_TAMPER_STAGE_SCRIPT:-0}" == 1 &&
      "$url" == */scripts/server-control.sh ]]; then
  emit '#!/usr/bin/env bash
exit 99
'
  exit 0
fi

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
  */releases/tags/snapshot)
    emit '{"tag_name":"snapshot"}'
    ;;
  */0123456789abcdef0123456789abcdef01234567/deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
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
  */0123456789abcdef0123456789abcdef01234567/scripts/server-migrate-user.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-restore.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-verify.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-doctor.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/server-control.sh|\
  */0123456789abcdef0123456789abcdef01234567/scripts/caddy-admission.py|\
  */0123456789abcdef0123456789abcdef01234567/scripts/caddy-env-config.py|\
  */0123456789abcdef0123456789abcdef01234567/scripts/xdrive-server-host.sh)
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
if [[ "$1" == "info" ]]; then
  if [[ "$*" == *"--format"* ]]; then echo '[]'; fi
  exit 0
fi
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
XD_SHELL_RC_PATH="$TMP/config-ok.bashrc" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
XD_LAN_HTTPS_IP=192.168.2.4 \
bash "$INSTALLER" >"$TMP/ok.out" 2>"$TMP/ok.err"

grep -q '\[xDrive\] \[1/9\] resolve release channel' "$TMP/ok.out"
grep -q 'Resolved latest fully published master snapshot: 0123456789ab' "$TMP/ok.out"
grep -q '\[xDrive\] \[9/9\] complete' "$TMP/ok.out"
grep -q "XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-$MASTER_SHORT" "$TMP/config-ok/config/.env"
grep -q "XD_CADDY_IMAGE=ghcr.io/lazyxu/xdrive-caddy:sha-$MASTER_SHORT" "$TMP/config-ok/config/.env"
grep -q "XD_PHOTO_FACE_IMAGE=ghcr.io/lazyxu/xdrive-photo-face:sha-$MASTER_SHORT" "$TMP/config-ok/config/.env"
grep -Fq "XD_PHOTO_FACE_RUNTIME_DIR=$TMP/config-ok/state/photo-face" "$TMP/config-ok/config/.env"
grep -Fq "XD_GEONAMES_HOST_DIR=$TMP/config-ok/data/geonames" "$TMP/config-ok/config/.env"
if grep -q '^XD_WEB_IMAGE=' "$TMP/config-ok/config/.env"; then
  echo "new installs must not persist the retired XD_WEB_IMAGE" >&2
  exit 1
fi
grep -q 'container_name: xdrive-postgres' "$ROOT/deploy/docker-compose.yml"
grep -q 'container_name: xdrive-server' "$ROOT/deploy/docker-compose.yml"
grep -q 'container_name: xdrive-worker' "$ROOT/deploy/docker-compose.yml"
grep -q 'container_name: xdrive-photo-face' "$ROOT/deploy/docker-compose.yml"
grep -q 'profiles: \["photo-intelligence"\]' "$ROOT/deploy/docker-compose.yml"
grep -q 'container_name: xdrive-caddy' "$ROOT/deploy/docker-compose.yml"
if grep -q '^  web:' "$ROOT/deploy/docker-compose.yml"; then
  echo "new Compose must not contain a web service" >&2
  exit 1
fi
grep -q "XD_HTTPS_PORT=8443" "$TMP/config-ok/config/.env"
grep -q '^XD_LAN_HTTPS_IP=192.168.2.4$' "$TMP/config-ok/config/.env"
grep -q '^XD_WEB_BIND=127.0.0.1$' "$TMP/config-ok/config/.env"

# A noninteractive fresh host without a trusted/private identity must NOT
# silently fall back to plaintext HTTP login merely to pass a bootstrap test.
set +e
TEST_STATE="$TMP/state" \
PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-no-identity" \
XD_SHELL_RC_PATH="$TMP/config-no-identity.bashrc" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
XD_LAN_HTTPS_IP='' \
bash "$INSTALLER" >"$TMP/no-identity.out" 2>"$TMP/no-identity.err"
no_identity_status=$?
set -e
[[ "$no_identity_status" -ne 0 ]]
grep -q 'cannot disable both LAN IP HTTPS and public domain HTTPS' "$TMP/no-identity.err"
# Existing-upgrade-only plaintext compatibility must be forbidden on fresh hosts,
# even when the operator tries to force the marker explicitly.
set +e
TEST_STATE="$TMP/state" \
PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-no-identity-explicit-legacy" \
XD_SHELL_RC_PATH="$TMP/config-no-identity-explicit-legacy.bashrc" \
XD_NONINTERACTIVE=1 \
XD_INSTALL_NO_START=1 \
XD_LAN_HTTPS_IP='' \
XD_LEGACY_HTTP_ONLY=1 \
bash "$INSTALLER" >"$TMP/no-identity-explicit-legacy.out" 2>"$TMP/no-identity-explicit-legacy.err"
explicit_legacy_status=$?
set -e
[[ "$explicit_legacy_status" -ne 0 ]]
grep -q 'cannot disable both LAN IP HTTPS and public domain HTTPS' "$TMP/no-identity-explicit-legacy.err"
connector_active="$(grep '^XD_CONNECTOR_SECRET_ACTIVE_VERSION=' "$TMP/config-ok/config/.env" | tail -n1 | cut -d= -f2-)"
connector_keys="$(grep '^XD_CONNECTOR_SECRET_KEYS=' "$TMP/config-ok/config/.env" | tail -n1 | cut -d= -f2-)"
[[ "$connector_active" == "1" ]]
[[ "$connector_keys" =~ ^1:[0-9a-f]{64}$ ]]
if grep -q '^XD_CONNECTOR_SECRET_KEY=' "$TMP/config-ok/config/.env"; then
  echo "new installs must not persist the legacy connector key variable" >&2
  exit 1
fi
grep -q "/$MASTER_SHA/deploy/docker-compose.yml$" "$TMP/state/urls"
test -x "$TMP/config-ok/bin/xdrive-server"
test -x "$TMP/config-ok/bin/server-migrate-user.sh"
test -x "$TMP/config-ok/bin/server-backup.sh"
python3 "$ROOT/scripts/test-signed-deploy-assets-contract.py"
grep -q 'raw bootstrap template: no embedded deployment asset checksums' "$TMP/ok.err"
grep -q '# >>> xDrive server PATH >>>' "$TMP/config-ok.bashrc"
grep -Fq "$TMP/config-ok/bin" "$TMP/config-ok.bashrc"
test -f "$TMP/config-ok/state/layout-version"
test "$(cat "$TMP/config-ok/state/layout-version")" = "2"
test ! -e "$TMP/config-ok/.env"
test ! -e "$TMP/config-ok/docker-compose.yml"

# The release-generated installer binds all 11 raw deployment assets to
# digests calculated from its authenticated checkout. Recreate that set from
# the already-fetched happy-path fixture and test the generated trust boundary.
signed_manifest="$TMP/staged-source.sha256"
{
  sha256sum "$TMP/config-ok/config/docker-compose.yml" | awk '{ print $1 "  deploy/docker-compose.yml" }'
  for source_script in server-backup.sh server-backup-scheduled.sh server-restore.sh \
    server-verify.sh server-doctor.sh server-migrate-user.sh server-control.sh \
    caddy-env-config.py caddy-admission.py xdrive-server-host.sh; do
    staged_name="$source_script"
    [[ "$source_script" == xdrive-server-host.sh ]] && staged_name=xdrive-server
    sha256sum "$TMP/config-ok/bin/$staged_name" | awk -v path="scripts/$source_script" '{ print $1 "  " path }'
  done
} > "$signed_manifest"
embedded_b64="$(base64 -w0 "$signed_manifest")"
sed "s|@DEPLOY_ASSET_MANIFEST_B64@|$embedded_b64|g" "$INSTALLER" > "$TMP/signed-installer.sh"
bash -n "$TMP/signed-installer.sh"
TEST_STATE="$TMP/state" PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-signed" XD_SHELL_RC_PATH="$TMP/config-signed.bashrc" \
XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 XD_LAN_HTTPS_IP=192.168.2.4 \
bash "$TMP/signed-installer.sh" >"$TMP/signed.out" 2>"$TMP/signed.err"
grep -q 'all 11 signed release deployment asset SHA-256 checks passed' "$TMP/signed.out"
if grep -q 'raw bootstrap template' "$TMP/signed.err"; then
  echo "rendered signed installer must never skip embedded asset verification" >&2
  exit 1
fi
test -x "$TMP/config-signed/bin/xdrive-server"

# A single tampered secondary script must abort *before* it can be installed.
set +e
TEST_TAMPER_STAGE_SCRIPT=1 TEST_STATE="$TMP/state" PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-tampered" XD_SHELL_RC_PATH="$TMP/config-tampered.bashrc" \
XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 XD_LAN_HTTPS_IP=192.168.2.4 \
bash "$TMP/signed-installer.sh" >"$TMP/tampered.out" 2>"$TMP/tampered.err"
tampered_status=$?
set -e
[[ "$tampered_status" -ne 0 ]]
grep -q 'SHA-256 mismatch for scripts/server-control.sh' "$TMP/tampered.err"
test ! -e "$TMP/config-tampered/bin/xdrive-server"

# Missing manifest entries and an invalid encoding must also fail closed.
grep -v '  scripts/server-control.sh$' "$signed_manifest" > "$TMP/incomplete-source.sha256"
for case_name in incomplete malformed; do
  if [[ "$case_name" == incomplete ]]; then
    bad_b64="$(base64 -w0 "$TMP/incomplete-source.sha256")"
  else
    bad_b64="invalid-base64-encoding"
  fi
  sed "s|@DEPLOY_ASSET_MANIFEST_B64@|$bad_b64|g" "$INSTALLER" > "$TMP/bad-$case_name-install.sh"
  set +e
  TEST_STATE="$TMP/state" PATH="$TMP/bin-ok:/usr/bin:/bin" \
  XD_CONFIG_DIR="$TMP/config-$case_name" XD_SHELL_RC_PATH="$TMP/config-$case_name.bashrc" \
  XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 XD_LAN_HTTPS_IP=192.168.2.4 \
  bash "$TMP/bad-$case_name-install.sh" >"$TMP/bad-$case_name.out" 2>"$TMP/bad-$case_name.err"
  invalid_status=$?
  set -e
  [[ "$invalid_status" -ne 0 ]]
  grep -Eq 'missing signed SHA-256|invalid embedded deployment asset hash manifest' "$TMP/bad-$case_name.err"
  test ! -e "$TMP/config-$case_name/bin/xdrive-server"
done

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
XD_SHELL_RC_PATH="$TMP/config-fail.bashrc" \
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

if [[ "$1" == "info" ]]; then
  if [[ "$args" == *"--format"* ]]; then echo '[]'; fi
  exit 0
fi

# First upgrade prefetches the exact target verifier image before stage-5.
# The host Docker mock must allow the real image API without a network pull.
if [[ "$1" == "image" && "${2:-}" == "inspect" ]]; then
  exit 1
fi
if [[ "$1" == "pull" ]]; then
  [[ "${2:-}" == "ghcr.io/lazyxu/xdrive-server:sha-0123456789ab" ]] || exit 90
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
if [[ "$1" == "inspect" && "$2" == "xdrive-postgres-1" && "$args" == *".Image"* ]]; then
  printf 'sha256:%064d\n' 0
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-server-1" && "$args" == *".State.Running"* ]]; then
  echo "${TEST_SERVER_RUNNING:-false}"
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-postgres-1" && "$args" == *".Config.Env"* ]]; then
  echo "POSTGRES_PASSWORD=stale-db-password"
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-server-1" && "$args" == *".Mounts"* && -n "${TEST_CAS_MOUNT_DIR:-}" ]]; then
  if [[ "$args" == *".Type"* ]]; then
    echo bind
  elif [[ "$args" == *".Source"* ]]; then
    if [[ "${TEST_CAS_MOUNT_MISMATCH:-0}" == "1" ]]; then
      echo /unrelated/custom-file-data
    else
      echo "$TEST_CAS_MOUNT_DIR"
    fi
  fi
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-postgres-1" && "$args" == *".Image"* && -n "${TEST_CAS_MOUNT_DIR:-}" ]]; then
  printf 'sha256:%064d\n' 0
  exit 0
fi
if [[ "$1" == "run" && -n "${TEST_CAS_MOUNT_DIR:-}" ]]; then
  [[ "$args" == *"--pull never"* && "$args" == *"--network none"* &&
     "$args" == *"--user 0:0"* ]] || exit 91
  [[ "$args" == *"type=bind,src=$TEST_CAS_MOUNT_DIR,dst=/data"* ]] || exit 92
  [[ "$args" == *".xdrive-blobs/sha256/[0-9a-f][0-9a-f]"* ]] || exit 93
  [[ "$args" == *"xdrive-cas-parent-repair 65532 65532"* ]] || exit 94
  [[ "$args" == *".xdrive-cas-lifecycle-locks/[0-9a-f][0-9a-f].lock"* ]] || exit 95
  [[ "$args" == *"chmod 0600"* ]] || exit 96
  [[ "$args" != *"rm -f "* && "$args" != *"truncate "* ]] || exit 97
  [[ "$args" == *"/data/.xdrive-temp-lifecycle.lock"* &&
     "$args" == *"/data/.xdrive-localpush-stage-locks/[0-9a-f][0-9a-f].lock"* ]] || exit 98
  [[ "$args" == *'stat -Lc "%h"'* ]] || exit 99
  [[ "$args" == *'pinned=/proc/self/fd/9'* && "$args" == *'exec 9<'* ]] || exit 100
  # The real image helper repairs only bounded directories and existing
  # 256 fixed zero-byte CAS shard lock inodes. This mock verifies the scope.
  echo "[xDrive] checked 4 CAS parent directories and 1 lifecycle lock files; owner corrections 2."
  exit 0
fi
if [[ "$1" == "inspect" && "$2" == "xdrive-server-1" && "$args" == *".Config.Env"* ]]; then
  if [[ "${TEST_MIGRATED_DB_READY:-0}" == "1" ]]; then
    if [[ "${TEST_MIGRATED_DSN_MISMATCH:-0}" == "1" ]]; then
      echo "XD_DATABASE_URL=postgres://xdrive:different-secret@postgres:5432/xdrive?sslmode=disable"
    else
      echo "XD_DATABASE_URL=postgres://xdrive:stale-db-password@postgres:5432/xdrive?sslmode=disable"
    fi
  fi
  echo "XD_JWT_SECRET=legacy-jwt-secret"
  exit 0
fi

# PostgreSQL password authentication must use the actual xDrive Server
# network namespace, regardless of application HTTP readiness.
if [[ "$1" == "run" && "$args" == *"--entrypoint psql"* ]]; then
  [[ "$args" == *"--pull never"* && "$args" == *"--network container:xdrive-server-1"* ]] || exit 9
  [[ "$args" == *"-e PGPASSWORD"* && "$args" == *"-e PGCONNECT_TIMEOUT=5"* ]] || exit 9
  [[ "${PGPASSWORD:-}" == "stale-db-password" ]] || exit 2
  [[ "$args" != *"PGPASSWORD=stale-db-password"* ]] || exit 11
  case "${TEST_SERVER_NETWORK_AUTH_MODE:-}" in
    valid) exit 0 ;;
    needs-repair) [[ -f "$TEST_STATE/password-repaired" ]]; exit $? ;;
    network-down) exit 1 ;;
    *) echo "unexpected auth probe mode" >&2; exit 9 ;;
  esac
fi
if [[ "$1" == "run" && "$args" == *"--entrypoint pg_isready"* ]]; then
  [[ "$args" == *"--pull never"* && "$args" == *"--network container:xdrive-server-1"* ]] || exit 9
  [[ "${TEST_SERVER_NETWORK_AUTH_MODE:-}" != "network-down" ]]
  exit $?
fi

if [[ "$1" == "exec" && "$args" == *"pg_isready"* ]]; then
  exit 0
fi
# readyz is a genuine DB readiness probe in production. A migrated, freshly
# restarted Server has the correct runtime DSN although the postgres container
# address-based psql probe may fail in a different network configuration.
if [[ "$1" == "exec" && "$args" == *"xdrive-server healthcheck http://127.0.0.1:8080/api/v1/readyz"* ]]; then
  [[ "${TEST_MIGRATED_DB_READY:-0}" == "1" ]]
  exit $?
fi

# Bridge-address authentication fails with the stale password until the local
# socket repair has changed the database role.
if [[ "$1" == "exec" && "$args" == *"-e PGPASSWORD"* && "$args" == *"hostname -i"* ]]; then
  [[ "${PGPASSWORD:-}" == "stale-db-password" ]] || exit 2
  [[ "$args" != *"PGPASSWORD=stale-db-password"* ]] || exit 11
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
# Exercise installer rollback after a deliberately refused stale /root path:
# it must restore the old active files and start the old deployment.
if [[ "$1" == "compose" && "$args" == *" up -d --remove-orphans"* ]]; then
  exit 0
fi
if [[ "$1" == "compose" && "$args" == *" exec -T server xdrive-server healthcheck"* ]]; then
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin-upgrade/docker"

cat > "$TMP/config-upgrade/.env" <<'EOF'
POSTGRES_PASSWORD=stale-db-password
XD_CONNECTOR_SECRET_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
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

# Exercise a canonical post-migration layout, not only a legacy root install.
cp -a "$TMP/config-upgrade" "$TMP/config-migrated"
mkdir -p "$TMP/config-migrated/config" "$TMP/config-migrated/bin"
mv "$TMP/config-migrated/.env" "$TMP/config-migrated/config/.env"
mv "$TMP/config-migrated/docker-compose.yml" "$TMP/config-migrated/config/docker-compose.yml"
mv "$TMP/config-migrated/server-backup.sh" "$TMP/config-migrated/bin/server-backup.sh"
printf 'XD_DOCKER_MODE=rootful\n' >> "$TMP/config-migrated/config/.env"
cp -a "$TMP/config-migrated" "$TMP/config-mismatched-dsn"
cp -a "$TMP/config-migrated" "$TMP/config-live-auth-503"
cp -a "$TMP/config-migrated" "$TMP/config-live-needs-repair"
cp -a "$TMP/config-migrated" "$TMP/config-live-network-down"

rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
if ! TEST_STATE="$TMP/state" \
PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-upgrade" \
XD_SHELL_RC_PATH="$TMP/config-upgrade.bashrc" \
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
test -f "$TMP/config-upgrade/.env"
grep -q '^POSTGRES_PASSWORD=stale-db-password$' "$TMP/config-upgrade/config/.env"
grep -q '^XD_JWT_SECRET=legacy-jwt-secret$' "$TMP/config-upgrade/config/.env"
grep -q '^XD_LEGACY_HTTP_ONLY=1$' "$TMP/config-upgrade/config/.env"
grep -Fq 'XD_LEGACY_HTTP_ONLY: ${XD_LEGACY_HTTP_ONLY:-0}' "$ROOT/deploy/docker-compose.yml"
grep -q '^XD_CONNECTOR_SECRET_ACTIVE_VERSION=1$' "$TMP/config-upgrade/config/.env"
grep -q '^XD_CONNECTOR_SECRET_KEYS=1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$' "$TMP/config-upgrade/config/.env"
if grep -q '^XD_CONNECTOR_SECRET_KEY=' "$TMP/config-upgrade/config/.env"; then
  echo "legacy connector key must be removed after keyring migration" >&2
  exit 1
fi
grep -q 'Migrated legacy connector credential key into keyring version 1.' "$TMP/upgrade.out"
grep -q 'Repaired the managed PostgreSQL role password to match xDrive configuration and verified Docker-network authentication.' "$TMP/upgrade.out"
grep -q 'Recovered JWT secret from the existing xDrive server container.' "$TMP/upgrade.out"
# A legacy deployment without discoverable Caddy must upgrade without aborting.
# Warning is mandatory: old lazy assets cannot be claimed as preserved.
grep -q 'WARNING: old Caddy unavailable; no historical PWA assets migrated.' "$TMP/upgrade.err"
grep -q '\[xDrive\] existing deployment detected; entering upgrade maintenance window...' "$TMP/upgrade.out"
grep -q '\[xDrive\] transaction armed; rollback backup:' "$TMP/upgrade.out"
test -x "$TMP/config-upgrade/bin/xdrive-server"
test -f "$TMP/config-upgrade/config/docker-compose.yml"

# Regression: after root-to-normal-user migration the freshly restarted
# Server still connects with the exact copied password. A Docker-container
# self-IP probe failure must NOT trigger an unnecessary ALTER ROLE or abort.
rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
if ! TEST_MIGRATED_DB_READY=1 TEST_STATE="$TMP/state" \
  PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
  XD_CONFIG_DIR="$TMP/config-migrated" \
  XD_SHELL_RC_PATH="$TMP/config-migrated.bashrc" \
  XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" >"$TMP/migrated.out" 2>"$TMP/migrated.err"; then
  echo "migrated running-Server database readiness recovery failed" >&2
  cat "$TMP/migrated.out" "$TMP/migrated.err" >&2
  exit 1
fi
test ! -e "$TMP/state/password-repaired"
grep -Fq 'Preserved PostgreSQL password: the running xDrive Server uses this exact DSN and passes database readiness.' "$TMP/migrated.out"
grep -Fxq "POSTGRES_PASSWORD=stale-db-password" "$TMP/config-migrated/config/.env"
grep -Fq 'healthcheck http://127.0.0.1:8080/api/v1/readyz' "$TMP/state/docker-calls"
# The readyz response alone must NOT be trusted when the running Server DSN
# differs from the configured password: retain the legacy role-repair path.
rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
if ! TEST_MIGRATED_DB_READY=1 TEST_MIGRATED_DSN_MISMATCH=1 TEST_STATE="$TMP/state" \
  PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
  XD_CONFIG_DIR="$TMP/config-mismatched-dsn" \
  XD_SHELL_RC_PATH="$TMP/config-mismatched-dsn.bashrc" \
  XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" >"$TMP/mismatched-dsn.out" 2>"$TMP/mismatched-dsn.err"; then
  echo "mismatched running-Server DSN should retain legacy role repair" >&2
  cat "$TMP/mismatched-dsn.out" "$TMP/mismatched-dsn.err" >&2
  exit 1
fi
test -f "$TMP/state/password-repaired"
grep -Fq 'Repaired the managed PostgreSQL role password' "$TMP/mismatched-dsn.out"
# Live Server can return HTTP 503 because of storage or DB readiness while
# the actual password is valid from its network. The installer must not reset
# that role merely because the DB container's self-IP probe fails.
rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
if ! TEST_SERVER_RUNNING=true TEST_SERVER_NETWORK_AUTH_MODE=valid TEST_STATE="$TMP/state" \
  PATH="$TMP/bin-upgrade:/usr/bin:/bin" XD_CONFIG_DIR="$TMP/config-live-auth-503" \
  XD_SHELL_RC_PATH="$TMP/config-live-auth-503.bashrc" \
  XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" >"$TMP/live-auth-503.out" 2>"$TMP/live-auth-503.err"; then
  echo "server-network password probe should succeed despite HTTP 503" >&2
  cat "$TMP/live-auth-503.out" "$TMP/live-auth-503.err" >&2
  exit 1
fi
test ! -e "$TMP/state/password-repaired"
grep -Fq 'run --rm --pull never --network container:xdrive-server-1 --entrypoint psql' "$TMP/state/docker-calls"
if grep -Fq 'hostname -i' "$TMP/state/docker-calls"; then
  echo "postgres self-IP probe was used despite a running Server" >&2
  exit 1
fi

# True stale password: the Server is unhealthy, live network is reachable,
# and only a successful trusted local role repair allows the new password.
rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
if ! TEST_SERVER_RUNNING=true TEST_SERVER_NETWORK_AUTH_MODE=needs-repair TEST_STATE="$TMP/state" \
  PATH="$TMP/bin-upgrade:/usr/bin:/bin" XD_CONFIG_DIR="$TMP/config-live-needs-repair" \
  XD_SHELL_RC_PATH="$TMP/config-live-needs-repair.bashrc" \
  XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" >"$TMP/live-needs-repair.out" 2>"$TMP/live-needs-repair.err"; then
  echo "server-network credential repair did not recover stale role" >&2
  cat "$TMP/live-needs-repair.out" "$TMP/live-needs-repair.err" >&2
  exit 1
fi
test -f "$TMP/state/password-repaired"
grep -Fq 'run --rm --pull never --network container:xdrive-server-1 --entrypoint pg_isready' "$TMP/state/docker-calls"
grep -Fq 'Repaired the managed PostgreSQL role password' "$TMP/live-needs-repair.out"

# Network is unreachable: never ALTER ROLE because changing a password does
# not repair DNS/bridge reachability. Database data must remain untouched.
rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
set +e
TEST_SERVER_RUNNING=true TEST_SERVER_NETWORK_AUTH_MODE=network-down TEST_STATE="$TMP/state" \
  PATH="$TMP/bin-upgrade:/usr/bin:/bin" XD_CONFIG_DIR="$TMP/config-live-network-down" \
  XD_SHELL_RC_PATH="$TMP/config-live-network-down.bashrc" \
  XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" >"$TMP/live-network-down.out" 2>"$TMP/live-network-down.err"
network_down_status=$?
set -e
[[ "$network_down_status" -ne 0 ]]
test ! -e "$TMP/state/password-repaired"
grep -Fq 'PostgreSQL is not reachable from the running Server network; refusing role password changes' "$TMP/live-network-down.err"


# A previously successful root-to-user migration may have been made with an
# older migrator that rewrote only four paths. Four persisted host directories
# remain under /root/.xd, making the NEXT normal-user update fail at stage 4.
# This must recover strictly from the verified root migration marker, without
# ever attempting to mkdir a directory in /root or touching unrelated paths.
cp -a "$TMP/config-migrated" "$TMP/config-old-root-paths"
# Keep all already-normalized host paths under the cloned installation.
sed -i "s#$TMP/config-migrated#$TMP/config-old-root-paths#g" \
  "$TMP/config-old-root-paths/config/.env"
mkdir -p "$TMP/config-old-root-paths/state"
cat > "$TMP/config-old-root-paths/state/migrated-from-root" <<EOF
source_home=/root/.xd
target_home=$TMP/config-old-root-paths
target_user=$(id -un)
migrated_at_utc=2026-10-25T00:00:00Z
EOF
chmod 600 "$TMP/config-old-root-paths/state/migrated-from-root"
root_env="$TMP/config-old-root-paths/config/.env"
grep -Ev '^XD_(CADDY_ASSET|MEDIA_WORKER_RUNTIME|PHOTO_FACE_RUNTIME|GEONAMES_HOST)_DIR=' "$root_env" > "$root_env.cleaned"
mv "$root_env.cleaned" "$root_env"
cat >> "$root_env" <<'EOF'
XD_CADDY_ASSET_DIR=/root/.xd/data/caddy/assets
XD_GEONAMES_HOST_DIR=/root/.xd/data/geonames
XD_MEDIA_WORKER_RUNTIME_DIR=/root/.xd/state/media-worker
XD_PHOTO_FACE_RUNTIME_DIR=/root/.xd/state/photo-face
EOF
chmod 600 "$root_env"
# Simulate CAS objects and persistent shard locks with a current staging
# marker but old root ownership. Both canonical directories and lock inodes
# require bounded repair before the strict stage-5 consistency scan.
mkdir -p "$TMP/config-old-root-paths/data/files/.xdrive-blobs/sha256/ab"
mkdir -p "$TMP/config-old-root-paths/data/files/.xdrive-cas-lifecycle-locks"
: > "$TMP/config-old-root-paths/data/files/.xdrive-cas-lifecycle-locks/ab.lock"
cp -a "$TMP/config-old-root-paths" "$TMP/config-old-root-paths-no-marker"
rm -f "$TMP/config-old-root-paths-no-marker/state/migrated-from-root"
cp -a "$TMP/config-old-root-paths" "$TMP/config-old-root-paths-override"
# The negative override case has valid migration identity. It must still
# reject an explicit operator override rather than silently rewriting it.
sed -i "s#^target_home=.*#target_home=$TMP/config-old-root-paths-override#" \
  "$TMP/config-old-root-paths-override/state/migrated-from-root"

if [[ "$(id -u)" -ne 0 ]]; then
  rm -f "$TMP/state/password-repaired" "$TMP/state/docker-calls"
  if ! TEST_MIGRATED_DB_READY=1 TEST_STATE="$TMP/state" \
    PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
    XD_CONFIG_DIR="$TMP/config-old-root-paths" \
    XD_SHELL_RC_PATH="$TMP/config-old-root-paths.bashrc" \
    TEST_CAS_MOUNT_DIR="$TMP/config-old-root-paths/data/files" \
    XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
    bash "$INSTALLER" >"$TMP/root-path-recovered.out" 2>"$TMP/root-path-recovered.err"; then
    echo "post-migration old-root path recovery failed" >&2
    cat "$TMP/root-path-recovered.out" "$TMP/root-path-recovered.err" >&2
    exit 1
  fi
  grep -Fxq "XD_CADDY_ASSET_DIR=$TMP/config-old-root-paths/data/caddy/assets" \
    "$TMP/config-old-root-paths/config/.env"
  grep -Fxq "XD_GEONAMES_HOST_DIR=$TMP/config-old-root-paths/data/geonames" \
    "$TMP/config-old-root-paths/config/.env"
  grep -Fxq "XD_MEDIA_WORKER_RUNTIME_DIR=$TMP/config-old-root-paths/state/media-worker" \
    "$TMP/config-old-root-paths/config/.env"
  grep -Fxq "XD_PHOTO_FACE_RUNTIME_DIR=$TMP/config-old-root-paths/state/photo-face" \
    "$TMP/config-old-root-paths/config/.env"
  test -d "$TMP/config-old-root-paths/data/caddy/assets"
  test -d "$TMP/config-old-root-paths/data/geonames"
  test -d "$TMP/config-old-root-paths/state/media-worker"
  test -d "$TMP/config-old-root-paths/state/photo-face"
  [[ "$(grep -Fc 'repaired migrated XD_' "$TMP/root-path-recovered.out")" -eq 4 ]]
  test ! -e "$TMP/state/password-repaired"
  grep -Fq 'validating migrated CAS directory permissions' "$TMP/root-path-recovered.out"
  grep -Fq 'checked 4 CAS parent directories and 1 lifecycle lock files; owner corrections 2.' "$TMP/root-path-recovered.out"
  grep -Fq -- "--network none --user 0:0 --mount type=bind,src=$TMP/config-old-root-paths/data/files,dst=/data" "$TMP/state/docker-calls"

  # An active Server mount mismatch fails closed rather than re-owning an
  # unrelated user-selected file storage directory.
  cp -a "$TMP/config-old-root-paths-no-marker" "$TMP/config-cas-mount-mismatch"
  sed -i "s#$TMP/config-old-root-paths#$TMP/config-cas-mount-mismatch#g" \
    "$TMP/config-cas-mount-mismatch/config/.env"
  cp "$TMP/config-old-root-paths/state/migrated-from-root" "$TMP/config-cas-mount-mismatch/state/migrated-from-root"
  sed -i "s#^target_home=.*#target_home=$TMP/config-cas-mount-mismatch#" \
    "$TMP/config-cas-mount-mismatch/state/migrated-from-root"
  set +e
  TEST_MIGRATED_DB_READY=1 TEST_STATE="$TMP/state" \
    TEST_CAS_MOUNT_DIR="$TMP/config-cas-mount-mismatch/data/files" \
    TEST_CAS_MOUNT_MISMATCH=1 PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
    XD_CONFIG_DIR="$TMP/config-cas-mount-mismatch" \
    XD_SHELL_RC_PATH="$TMP/config-cas-mount-mismatch.bashrc" \
    XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
    bash "$INSTALLER" >"$TMP/cas-mismatch.out" 2>"$TMP/cas-mismatch.err"
  cas_mismatch_status=$?
  set -e
  [[ "$cas_mismatch_status" -ne 0 ]]
  grep -Fq 'migrated CAS mount mismatch; refusing permission changes before backup' "$TMP/cas-mismatch.err"
  grep -Fq 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/cas-mismatch.err"

  # A copied .env alone is insufficient authority to rewrite a protected
  # root-owned path: no marker, wrong owner or explicit env overrides fail
  # before attempting mkdir in /root.
  set +e
  TEST_MIGRATED_DB_READY=1 TEST_STATE="$TMP/state" \
    PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
    XD_CONFIG_DIR="$TMP/config-old-root-paths-no-marker" \
    XD_SHELL_RC_PATH="$TMP/config-old-root-paths-no-marker.bashrc" \
    XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
    bash "$INSTALLER" >"$TMP/root-no-marker.out" 2>"$TMP/root-no-marker.err"
  missing_status=$?
  XD_CADDY_ASSET_DIR=/root/.xd/data/caddy/assets \
    TEST_MIGRATED_DB_READY=1 TEST_STATE="$TMP/state" \
    PATH="$TMP/bin-upgrade:/usr/bin:/bin" \
    XD_CONFIG_DIR="$TMP/config-old-root-paths-override" \
    XD_SHELL_RC_PATH="$TMP/config-old-root-paths-override.bashrc" \
    XD_NONINTERACTIVE=1 XD_INSTALL_NO_START=1 \
    bash "$INSTALLER" >"$TMP/root-override.out" 2>"$TMP/root-override.err"
  override_status=$?
  set -e
  [[ "$missing_status" -ne 0 && "$override_status" -ne 0 ]]
  grep -Fq 'XD_CADDY_ASSET_DIR still points to an inaccessible root-owned path' "$TMP/root-no-marker.err"
  grep -Fq 'XD_CADDY_ASSET_DIR still points to an inaccessible root-owned path' "$TMP/root-override.err"
  grep -Fq 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/root-no-marker.err"
  grep -Fq 'UPGRADE FAILED -> ROLLBACK SUCCESS' "$TMP/root-override.err"
fi

echo "server installer bootstrap and stage-reporting tests passed"
