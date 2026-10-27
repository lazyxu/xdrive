#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCTOR="$ROOT/scripts/server-doctor.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home/config" "$TMP/home/bin" "$TMP/home/data/files" "$TMP/home/data/postgres" "$TMP/home/data/caddy/data" "$TMP/home/data/caddy/config" "$TMP/home/backups" "$TMP/home/state" "$TMP/state"
cp "$ROOT/scripts/xdrive-server-host.sh" "$TMP/home/bin/xdrive-server"
chmod +x "$TMP/home/bin/xdrive-server"

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
if [[ -n "${TEST_STATE:-}" ]]; then printf '%s\n' "$args" >> "$TEST_STATE/docker-args"; fi
if [[ "$1" == "--version" ]]; then echo "Docker version test"; exit 0; fi
if [[ "$1" == "compose" && "$2" == "version" ]]; then echo "Docker Compose version v2.test"; exit 0; fi
if [[ "$1" == "info" ]]; then
  if [[ "$args" == *"--format"* ]]; then echo '[]'; else echo "/"; fi
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  if [[ "$args" == *'eq .Destination "/host-control"'* ]]; then
    case "${XD_TEST_CADDY_MOUNT:-matched}" in
      matched) echo "bind|$HOME/state/control|true" ;;
      mismatch) echo "bind|$HOME/state/other|true" ;;
      absent) : ;;
      readonly) echo "bind|$HOME/state/control|false" ;;
      poison) echo 'bind|/tmp/ALIYUN_ACCESS_KEY_SECRET=poison-must-not-leak|true' ;;
      *) exit 2 ;;
    esac
    exit 0
  fi
  if [[ "$args" == *".State.Running"* ]]; then
    echo "${XD_TEST_SERVER_RUNNING:-true}"
    exit 0
  fi
  if [[ "$args" == *".Image"* && "$args" != *".Config.Image"* ]]; then
    printf 'sha256:%064d\n' 0
    exit 0
  fi
  if [[ "$args" == *".State.Status"* ]]; then echo "running"; exit 0; fi
  if [[ "$args" == *".State.Health"* ]]; then echo "healthy"; exit 0; fi
  if [[ "$args" == *".Config.Image"* ]]; then echo "ghcr.io/lazyxu/test:sha-test"; exit 0; fi
  if [[ "$args" == *".Mounts"* ]]; then echo "volume=xdrive_test-data"; exit 0; fi
fi
if [[ "$1" == "run" ]]; then
  [[ "$args" == *"--pull never"* ]] || exit 9
  [[ "$args" == *"--network container:server-id"* ]] || exit 9
  [[ "$args" == *"--entrypoint psql"* ]] || exit 9
  [[ "$args" == *"-e PGPASSWORD"* && "$args" == *"-e PGCONNECT_TIMEOUT=5"* ]] || exit 9
  [[ "${PGPASSWORD:-}" == "super-secret-db-password" ]] || exit 9
  [[ "$args" != *"PGPASSWORD=super-secret-db-password"* ]] || exit 9
  [[ "${XD_TEST_DB_AUTH_FAIL:-0}" != "1" ]]
  exit $?
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
        worker) echo "worker-id" ;;
        caddy) echo "caddy-id" ;;
      esac
      exit 0
      ;;
    exec)
      if [[ "$*" == *"server xdrive-server version"* ]]; then
        case "${XD_TEST_SERVER_COMMIT:-matched}" in
          matched) echo 'server version: test'; echo 'commit: 0123456789abcdef0123456789abcdef01234567'; exit 0 ;;
          mismatch) echo 'server version: test'; echo 'commit: ffffffffffffffffffffffffffffffffffffffff'; exit 0 ;;
          poison) echo 'ALIYUN_ACCESS_KEY_SECRET=poison-must-not-leak'; exit 0 ;;
          unavailable) exit 2 ;;
          hang) sleep 30; exit 0 ;;
        esac
      fi
      if [[ "$*" == *"caddy-host witness-check"* ]]; then
        case "${XD_TEST_CADDY_WITNESS:-missing}" in
          observed) echo 'Caddy local observation: local-https-observed'; exit 0 ;;
          leaked) echo 'Caddy local observation: ALIYUN_ACCESS_KEY_SECRET=poison-must-not-leak'; exit 1 ;;
          hang) sleep 30; exit 0 ;;
          *) echo 'Caddy local observation: snapshot-missing'; exit 1 ;;
        esac
      fi
      if [[ "${XD_TEST_CAS_HANG:-0}" == "1" && "$*" == *"storage health"* ]]; then
        sleep 30
        exit 0
      fi
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
grep -q '^profile: fast ' "$TMP/report"
grep -q '\[SKIP\] public HTTPS' "$TMP/report"
grep -q '\[SKIP\] external network' "$TMP/report"
grep -q '\[SKIP\] container logs' "$TMP/report"
# Default doctor must not contact update hosts or read Blob bytes.
if grep -Eq 'storage verify|storage scrub|storage fsck' "$TMP/state/docker-args"; then
  echo "fast doctor unexpectedly started full storage verification" >&2
  exit 1
fi
if grep -Fq 'https://api.github.com/' "$TMP/state/curl-args"; then
  echo "fast doctor unexpectedly checked external update hosts" >&2
  exit 1
fi
grep -q '^---- installation environment ----$' "$TMP/report"
grep -q '^xDrive installation environment$' "$TMP/report"
grep -Eq 'Docker mode[[:space:]]+rootful$' "$TMP/report"
grep -q '^Persistent paths$' "$TMP/report"
grep -Eq 'Volumes[[:space:]]+none$' "$TMP/report"
grep -q '\[PASS\] Docker' "$TMP/report"
grep -q '\[PASS\] Docker access' "$TMP/report"
grep -q 'mode=rootful; usable without sudo' "$TMP/report"
grep -q '\[PASS\] host layout' "$TMP/report"
grep -q '\[PASS\] PostgreSQL auth' "$TMP/report"
grep -Fq 'from the live Server network' "$TMP/report"
# A 503 from the application does not invalidate a separately authenticated
# PostgreSQL client, and failed auth must not be mislabeled as success.
XD_TEST_DB_AUTH_FAIL=1 TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" \
  HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-db-failed" 2>"$TMP/err-db-failed"
grep -q '\[FAIL\] PostgreSQL auth' "$TMP/report-db-failed"
grep -Fq 'Server-network login probe failed' "$TMP/report-db-failed"
XD_TEST_SERVER_RUNNING=false TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" \
  HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-server-stopped" 2>"$TMP/err-server-stopped"
grep -q '\[WARN\] PostgreSQL auth' "$TMP/report-server-stopped"
grep -Fq 'cannot verify its actual database connection path' "$TMP/report-server-stopped"
! grep -Fq 'super-secret-db-password' "$TMP/report-db-failed" "$TMP/err-db-failed" "$TMP/report-server-stopped" "$TMP/err-server-stopped"
grep -q '\[PASS\] CAS metadata health' "$TMP/report"
grep -q 'Caddy Host witness.*reason=snapshot-missing' "$TMP/report"
grep -q 'Caddy Host producer.*snapshot=directory-unavailable' "$TMP/report"
grep -q 'Caddy Host correlation.*host-snapshot-not-produced' "$TMP/report"

# Host snapshot freshness is metadata-only: file bytes may contain a poison
# credential, and must never be read into or echoed by the diagnostic report.
mkdir -p "$TMP/home/state/control"
printf 'alive\n' > "$TMP/home/state/control/heartbeat"
printf 'ALIYUN_ACCESS_KEY_SECRET=poison-must-not-leak\n' > "$TMP/home/state/control/caddy-runtime-status.json"
TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-host-snapshot" 2>"$TMP/err-host-snapshot"
grep -q 'Caddy Host producer.*heartbeat=fresh snapshot=fresh' "$TMP/report-host-snapshot"
grep -q 'Caddy Host correlation.*host-snapshot-present-server-unreadable' "$TMP/report-host-snapshot"

grep -q '\[PASS\] Caddy Server mount.*fixed host bridge bind source' "$TMP/report-host-snapshot" ||
  grep -q '\[PASS\] Caddy Server mount.*fixed host bridge bind matches' "$TMP/report-host-snapshot"
grep -q '\[PASS\] Caddy Server revision.*matches pinned deployment commit' "$TMP/report-host-snapshot"
XD_TEST_CADDY_MOUNT=mismatch TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-mount-mismatch" 2>"$TMP/err-mount-mismatch"
grep -q 'Caddy Server mount.*reason=mount-source-mismatch' "$TMP/report-mount-mismatch"
XD_TEST_CADDY_MOUNT=absent TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-mount-missing" 2>"$TMP/err-mount-missing"
grep -q 'Caddy Server mount.*reason=mount-missing' "$TMP/report-mount-missing"
XD_TEST_SERVER_COMMIT=mismatch TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-binary-mismatch" 2>"$TMP/err-binary-mismatch"
grep -q 'Caddy Server revision.*reason=running-commit-mismatch' "$TMP/report-binary-mismatch"
XD_TEST_SERVER_COMMIT=poison XD_TEST_CADDY_MOUNT=poison TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-binary-poison" 2>"$TMP/err-binary-poison"
grep -q 'Caddy Server revision.*reason=running-commit-unavailable' "$TMP/report-binary-poison"
! grep -Fq 'poison-must-not-leak' "$TMP/report-binary-poison" "$TMP/err-binary-poison"

! grep -Fq 'poison-must-not-leak' "$TMP/report-host-snapshot" "$TMP/err-host-snapshot"
touch -d '2 minutes ago' "$TMP/home/state/control/caddy-runtime-status.json"
TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-host-stale" 2>"$TMP/err-host-stale"
grep -q 'Caddy Host producer.*snapshot=stale' "$TMP/report-host-stale"

# Group mismatch stays WARN without proof, clears only with matching bind + live witness.
host_group="$(stat -c %g "$TMP/home/state/control")"
printf 'XD_SERVER_GID=%s\n' "$((host_group + 1))" >> "$TMP/home/config/.env"
TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-group-unverified" 2>"$TMP/err-group-unverified"
grep -q '\[WARN\] Caddy bridge access.*reason=group-mismatch' "$TMP/report-group-unverified"

XD_TEST_CADDY_WITNESS=observed TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-caddy-observed" 2>"$TMP/err-caddy-observed"
grep -q '\[PASS\] Caddy Host witness' "$TMP/report-caddy-observed"
grep -q 'fresh local HTTPS evidence' "$TMP/report-caddy-observed"

grep -q '\[PASS\] Caddy bridge access.*running Server verified fixed Host Control' "$TMP/report-caddy-observed"
XD_TEST_CADDY_WITNESS=observed XD_TEST_CADDY_MOUNT=mismatch TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-group-wrong-mount" 2>"$TMP/err-group-wrong-mount"
grep -q '\[WARN\] Caddy bridge access.*reason=group-mismatch' "$TMP/report-group-wrong-mount"
grep -q 'fresh local HTTPS evidence' "$TMP/report-caddy-observed"

XD_TEST_CADDY_WITNESS=leaked TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" >"$TMP/report-caddy-leak" 2>"$TMP/err-caddy-leak"
grep -q 'unsupported-or-unavailable-server-witness' "$TMP/report-caddy-leak"
! grep -Fq 'poison-must-not-leak' "$TMP/report-caddy-leak" "$TMP/err-caddy-leak"
grep -q '\[PASS\] TLS/local HTTPS' "$TMP/report"
grep -q '/api/v1/readyz' "$TMP/state/curl-args"
: > "$TMP/state/curl-args"
TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" --deep >"$TMP/report-deep" 2>"$TMP/err-deep"
grep -q '^profile: deep ' "$TMP/report-deep"
grep -q 'https://api.github.com/' "$TMP/state/curl-args"
grep -q 'https://github.com/' "$TMP/state/curl-args"
grep -q 'https://release-assets.githubusercontent.com/' "$TMP/state/curl-args"
grep -q 'https://ghcr.io/v2/' "$TMP/state/curl-args"
grep -q 'https://pkg-containers.githubusercontent.com/' "$TMP/state/curl-args"
grep -Fq -- '---- recent container logs' "$TMP/report-deep"
grep -q '<redacted>' "$TMP/report-deep"
grep -q 'summary:' "$TMP/report"

cat >> "$TMP/home/config/.env" <<'EOF'
XD_UPDATE_SOURCE=gitlab
XD_IMAGE_REGISTRY=registry.gitlab.example/xuliang/xdrive
EOF
: > "$TMP/state/curl-args"
TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  bash "$DOCTOR" --deep >"$TMP/report-gitlab" 2>"$TMP/err-gitlab"
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
grep -q '<redacted>' "$TMP/report-deep"

# Slow Docker Exec operations must time out without hanging, reading Blob
# files, leaking stdout/stderr, or incorrectly reporting success.
XD_TEST_CAS_HANG=1 XD_TEST_CADDY_WITNESS=hang XD_TEST_SERVER_COMMIT=hang \
  TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  timeout --kill-after=2s 25s bash "$DOCTOR" >"$TMP/report-timeouts" 2>"$TMP/err-timeouts"
grep -q 'CAS metadata health.*timed out after 4s' "$TMP/report-timeouts"
grep -q 'Caddy Server revision.*reason=running-version-unavailable' "$TMP/report-timeouts"
grep -q 'Caddy Host witness.*reason=witness-timeout' "$TMP/report-timeouts"
grep -q 'summary:' "$TMP/report-timeouts"
! grep -Fq 'poison-must-not-leak' "$TMP/report-timeouts" "$TMP/err-timeouts"

# A series of individually bounded operations must still obey the whole-report
# watchdog. Shorten the budget *only in a disposable copy* to avoid a slow CI.
sed 's/^  FAST_BUDGET_SECONDS=30$/  FAST_BUDGET_SECONDS=2/' "$DOCTOR" > "$TMP/server-doctor-budget2.sh"
budget_status=0
XD_TEST_CAS_HANG=1 TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" \
  HOME="$TMP/home" XD_CONFIG_DIR="$TMP/home" \
  timeout --kill-after=2s 10s bash "$TMP/server-doctor-budget2.sh" \
  >"$TMP/report-total-budget" 2>"$TMP/err-total-budget" || budget_status=$?
test "$budget_status" -eq 124
grep -q 'doctor total timeout: diagnostic incomplete after 2s' "$TMP/err-total-budget"
! grep -Fq 'poison-must-not-leak' "$TMP/report-total-budget" "$TMP/err-total-budget"


# Exercise fixed Host Control group repair without mutating test-host ownership.
mkdir -p "$TMP/group/state/control"
printf 'alive\n' > "$TMP/group/state/control/heartbeat"
printf 'fake\n' > "$TMP/group/state/control/caddy-runtime-status.json"
printf 'fake\n' > "$TMP/group/state/control/caddy-env-observed.json"
awk '/^prepare_caddy_host_bridge_group_access\(\) \{/{copy=1}copy{print}copy&&/^}/{exit}' \
  "$ROOT/deploy/install-server.sh" > "$TMP/caddy-bridge-function.sh"
test -s "$TMP/caddy-bridge-function.sh"
(
  source "$TMP/caddy-bridge-function.sh"
  STATE_DIR="$TMP/group/state"
  SERVER_GID=65532
  DOCKER_MODE=rootful
  docker_security_options='[]'
  GROUP_LOG="$TMP/state/chgrp-log"
  : > "$GROUP_LOG"
  ACTOR_UID=0
  DIR_GID_MATCH=0
  id() {
    if [[ "${1:-}" == -u ]]; then printf '%s\n' "$ACTOR_UID"
    else command id "$@"; fi
  }
  stat() {
    if [[ "${1:-}" == -c && "${2:-}" == '%g' ]]; then
      if { [[ "${@: -1}" == "$STATE_DIR/control" && "$DIR_GID_MATCH" == 1 ]]; } ||
          grep -Fxq "${@: -1}" "$GROUP_LOG"; then
        echo "$SERVER_GID"
      else echo 1000; fi
    elif [[ "${1:-}" == -c && "${2:-}" == '%a' ]]; then echo 660
    else command stat "$@"; fi
  }
  chgrp() {
    [[ "$#" == 4 && "$1" == -h && "$2" == "$SERVER_GID" && "$3" == -- ]] || return 2
    printf '%s\n' "$4" >> "$GROUP_LOG"
  }
  prepare_caddy_host_bridge_group_access > "$TMP/state/root-group-success"
  test "$(wc -l < "$GROUP_LOG")" -eq 4
  for target in "$STATE_DIR/control" "$STATE_DIR/control/heartbeat" "$STATE_DIR/control/caddy-runtime-status.json" "$STATE_DIR/control/caddy-env-observed.json"; do
    grep -Fxq "$target" "$GROUP_LOG"
  done
  grep -q 'standard Unix permissions' "$TMP/state/root-group-success"

  : > "$GROUP_LOG"
  ACTOR_UID=1000
  prepare_caddy_host_bridge_group_access >/dev/null 2> "$TMP/state/unprivileged.err"
  test ! -s "$GROUP_LOG"
  grep -q 'one-time root group/mode repair' "$TMP/state/unprivileged.err"

  ACTOR_UID=0
  DOCKER_MODE=rootless
  prepare_caddy_host_bridge_group_access >/dev/null 2>&1
  test ! -s "$GROUP_LOG"
  DOCKER_MODE=rootful
  for sec in '["name=userns"]' '' null '[malformed]'; do
    docker_security_options="$sec"
    prepare_caddy_host_bridge_group_access >/dev/null 2>&1
    test ! -s "$GROUP_LOG"
  done

  # Directory group matches; only pre-existing fixed observations need repair.
  docker_security_options='["name=seccomp,profile=builtin","name=cgroupns"]'
  DIR_GID_MATCH=1
  prepare_caddy_host_bridge_group_access >/dev/null
  test "$(wc -l < "$GROUP_LOG")" -eq 3
  ! grep -Fxq "$STATE_DIR/control" "$GROUP_LOG"

  : > "$GROUP_LOG"
  mv "$STATE_DIR/control/caddy-env-observed.json" "$STATE_DIR/control/caddy-env-observed.json.saved"
  ln -s "$TMP/state/outside" "$STATE_DIR/control/caddy-env-observed.json"
  prepare_caddy_host_bridge_group_access >/dev/null 2>"$TMP/state/symlink.err"
  test ! -s "$GROUP_LOG"
  grep -q 'unexpected Host Control observation file type' "$TMP/state/symlink.err"
)

# No shell runtime references to external filesystem ACL binaries.
! grep -Eq 'setfacl|getfacl' "$ROOT/deploy/install-server.sh" "$ROOT/scripts/server-doctor.sh"
echo "server doctor tests passed"
