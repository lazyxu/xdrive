#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="$ROOT/scripts/xdrive-server-host.sh"
TMP="$(mktemp -d)"
CONTROL_TEST_PID=""
cleanup() {
  local status=$?
  if [[ -n "${CONTROL_TEST_PID:-}" ]] && kill -0 "$CONTROL_TEST_PID" 2>/dev/null; then
    kill -TERM "$CONTROL_TEST_PID" 2>/dev/null || true
    wait "$CONTROL_TEST_PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "host xdrive-server manager test failed (exit $status)" >&2
    for file in \
      update.out update.err version.out backup.out backup-create.out backup-list.out backup-verify.out backup-verify-latest.out backup-sources.out restore.out backup-fail.err doctor.out \
      admin-list.out admin-reset.out admin-reset.err admin-enable.out admin-disable.out password-arg.err \
      state/curl-url state/installer-args state/installer-stdin state/doctor-args state/docker-args \
      state/admin-list-stdin state/admin-reset-stdin state/admin-enable-stdin state/admin-disable-stdin \
      state/audit-calls state/restore-args state/verify-args \
      control-run.out control-run.err home/state/control/status.json home/logs/host-control-update.log; do
      if [[ -f "$TMP/$file" ]]; then
        echo "===== $file =====" >&2
        cat "$TMP/$file" >&2 || true
      fi
    done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/home/config" "$TMP/home/bin" "$TMP/state"

cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) out="$2"; shift 2 ;;
    --retry|--retry-delay|--connect-timeout) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ -n "$out" && -n "$url" ]]
printf '%s\n' "$url" > "$TEST_STATE/curl-url"
printf '%s\n' "$url" >> "$TEST_STATE/curl-urls"
if [[ "${TEST_CURL_FAIL_GITLAB_DOMAIN:-0}" == "1" && "$url" == http://gitlab.t-fluid.com:1080/* ]]; then
  exit "${TEST_CURL_FAIL_STATUS:-28}"
fi
cat > "$out" <<'INSTALL'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/installer-args"
printf '%s\n' "${XD_GITLAB_BASE_URL:-}" > "$TEST_STATE/installer-gitlab-base"
readlink /proc/$$/fd/0 > "$TEST_STATE/installer-stdin" || true
INSTALL
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/docker-args"
case "$*" in
  *"exec -T server xdrive-server version"*)
    cat <<'EOF'
server version: snapshot
channel: master
commit: 0123456789abcdef0123456789abcdef01234567
commit message: feat: server build metadata
commit time: 2026-09-27T13:00:00Z
build time: 2026-09-27T13:05:00Z
EOF
    ;;
  *"audit record"*)
    printf '%s\n' "$*" >> "$TEST_STATE/audit-calls"
    ;;
  *"exec -T postgres pg_restore --data-only --table=public.xd_sources --file=-"*)
    cat >/dev/null
    cat <<'EOF'
COPY public.xd_sources (id, owner_id, name, kind, direction, sync_mode, run_mode, status, schedule_type, schedule_expression, schedule_timezone, revision, target_node_id, ignore_rules, checkpoint, last_run_at, last_success_at, last_error, run_requested_at, created_at, updated_at) FROM stdin;
1	1	一刻相册	yike_photos	pull	backup	scan	active	interval	6h	\N	3	10			2026-09-30 08:00:00+00	2026-09-30 08:00:00+00			2026-09-29 00:00:00+00	2026-09-30 08:00:00+00
2	1	群晖 Photos	synology_photos	pull	backup	sync	active	manual		\N	2	11						2026-09-29 01:00:00+00	2026-09-30 07:30:00+00
\.
EOF
    ;;
  *"source verify"*)
    readlink /proc/$$/fd/0 > "$TEST_STATE/source-verify-stdin" 2>/dev/null || true
    printf '{"sources":3,"items":42,"bound_items":40,"issues":[]}\n'
    ;;
  *"media verify"*)
    readlink /proc/$$/fd/0 > "$TEST_STATE/media-verify-stdin" 2>/dev/null || true
    printf '{"metadata":10,"groups":2,"group_items":4,"derived_resources":2,"issues":[]}\n'
    ;;
  *"admin list"*)
    readlink /proc/$$/fd/0 > "$TEST_STATE/admin-list-stdin" 2>/dev/null || true
    if [[ "$(cat "$TEST_STATE/admin-list-stdin" 2>/dev/null || true)" == pipe:* ]]; then
      echo "admin list inherited a pipe" >&2
      exit 98
    fi
    printf 'ID  USERNAME  ROLE  STATUS  MUST_CHANGE  QUOTA_BYTES  LAST_LOGIN\n'
    printf '1   admin     admin active  false        0            -\n'
    ;;
  *"admin reset-password"*)
    cat > "$TEST_STATE/admin-reset-stdin"
    printf 'reset password for admin (id=1); existing sessions revoked; must_change_password=true\n'
    ;;
  *"admin enable"*)
    readlink /proc/$$/fd/0 > "$TEST_STATE/admin-enable-stdin" 2>/dev/null || true
    printf 'enabled admin (id=1)\n'
    ;;
  *"admin disable"*)
    readlink /proc/$$/fd/0 > "$TEST_STATE/admin-disable-stdin" 2>/dev/null || true
    printf 'disabled user-a (id=2); existing sessions revoked\n'
    ;;
  *)
    echo "unexpected docker invocation: $*" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/home/bin/server-backup.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${TEST_BACKUP_FAIL:-0}" == "1" ]]; then
  echo "mock backup failed" >&2
  exit 7
fi
echo "/tmp/mock-xdrive-backup"
SH
chmod +x "$TMP/home/bin/server-backup.sh"

cat > "$TMP/home/bin/server-restore.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/restore-args"
echo "mock restore complete"
SH
chmod +x "$TMP/home/bin/server-restore.sh"

cat > "$TMP/home/bin/server-doctor.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/doctor-args"
echo "mock doctor"
SH
chmod +x "$TMP/home/bin/server-doctor.sh"

cat > "$TMP/home/bin/server-verify.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/verify-args"
echo "mock verify"
SH
chmod +x "$TMP/home/bin/server-verify.sh"

cat > "$TMP/home/config/.env" <<'EOF'
XD_DOMAIN=
XD_RELEASE_CHANNEL=master
XD_RELEASE_COMMIT=0123456789abcdef0123456789abcdef01234567
XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:sha-0123456789ab
EOF
printf 'name: xdrive\nservices: {}\n' > "$TMP/home/config/docker-compose.yml"

SNAPSHOT="$TMP/home/backups/snapshots/xdrive-backup-20260928T120000Z"
mkdir -p "$SNAPSHOT"
printf 'db-dump\n' > "$SNAPSHOT/database.dump"
printf 'blob-tar\n' > "$SNAPSHOT/blobs.tar"
printf '{"ok":true}\n' > "$SNAPSHOT/verify.json"
cat > "$SNAPSHOT/manifest.json" <<'EOF'
{
  "format_version": 1,
  "created_at_utc": "2026-09-28T12:00:00Z",
  "consistency_verified": true,
  "release_channel": "master",
  "release_commit": "0123456789abcdef0123456789abcdef01234567"
}
EOF
(
  cd "$SNAPSHOT"
  sha256sum database.dump blobs.tar verify.json manifest.json > SHA256SUMS.txt
)

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
XD_INSTALLER_URL="https://example.invalid/install-server.sh" \
bash "$HOST" update --channel master >"$TMP/update.out" 2>"$TMP/update.err"

grep -q '^https://example.invalid/install-server.sh$' "$TMP/state/curl-url"
grep -q '^--channel master$' "$TMP/state/installer-args"
if grep -q '^pipe:' "$TMP/state/installer-stdin"; then
  echo "host updater passed a pipe as installer stdin" >&2
  cat "$TMP/state/installer-stdin" >&2
  exit 1
fi
grep -q 'installer downloaded and syntax-checked' "$TMP/update.out"
grep -q -- 'audit record --action system.update --result success' "$TMP/state/audit-calls"

rm -f "$TMP/state/curl-url"
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" update --source github --channel master >"$TMP/update-github-master.out" 2>"$TMP/update-github-master.err"
grep -q '^https://github.com/lazyxu/xdrive/releases/download/snapshot/xdrive-server-install.sh$' "$TMP/state/curl-url"

rm -f "$TMP/state/curl-url"
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" update --source github --channel stable >"$TMP/update-github-stable.out" 2>"$TMP/update-github-stable.err"
grep -q '^https://github.com/lazyxu/xdrive/releases/latest/download/xdrive-server-install.sh$' "$TMP/state/curl-url"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" update --source gitlab --channel master >"$TMP/update-gitlab.out" 2>"$TMP/update-gitlab.err"

grep -q '^http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/raw/master/deploy/install-server.sh$' "$TMP/state/curl-url"
grep -q '^--source gitlab --channel master$' "$TMP/state/installer-args"
grep -q 'downloading master host installer from gitlab' "$TMP/update-gitlab.out"

rm -f "$TMP/state/curl-urls" "$TMP/state/installer-gitlab-base"
TEST_CURL_FAIL_GITLAB_DOMAIN=1 \
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" update --source gitlab --channel master >"$TMP/update-gitlab-fallback.out" 2>"$TMP/update-gitlab-fallback.err"

grep -q '^http://gitlab.t-fluid.com:1080/xuliang/xdrive/-/raw/master/deploy/install-server.sh$' "$TMP/state/curl-urls"
grep -q '^http://127.0.0.1:1080/xuliang/xdrive/-/raw/master/deploy/install-server.sh$' "$TMP/state/curl-urls"
grep -q '^http://127.0.0.1:1080$' "$TMP/state/installer-gitlab-base"
grep -q 'retrying via local fallback http://127.0.0.1:1080' "$TMP/update-gitlab-fallback.err"

rm -f "$TMP/state/curl-urls" "$TMP/state/installer-gitlab-base"
set +e
TEST_CURL_FAIL_GITLAB_DOMAIN=1 \
TEST_CURL_FAIL_STATUS=22 \
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" update --source gitlab --channel master >"$TMP/update-gitlab-http-error.out" 2>"$TMP/update-gitlab-http-error.err"
gitlab_http_status=$?
set -e
[[ "$gitlab_http_status" -eq 22 ]]
if grep -q '^http://127.0.0.1:1080/' "$TMP/state/curl-urls"; then
  echo "GitLab HTTP errors must not fall back to localhost" >&2
  exit 1
fi

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" version >"$TMP/version.out"

grep -q '^server version: snapshot$' "$TMP/version.out"
grep -q '^channel: master$' "$TMP/version.out"
grep -q '^commit: 0123456789abcdef0123456789abcdef01234567$' "$TMP/version.out"
grep -q '^commit message: feat: server build metadata$' "$TMP/version.out"
grep -q '^commit time: 2026-09-27T13:00:00Z$' "$TMP/version.out"
grep -q '^build time: 2026-09-27T13:05:00Z$' "$TMP/version.out"
grep -q '^server image: ghcr.io/lazyxu/xdrive-server:sha-0123456789ab$' "$TMP/version.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup >"$TMP/backup.out"
grep -q '/tmp/mock-xdrive-backup' "$TMP/backup.out"
grep -q -- 'audit record --action system.backup --result success' "$TMP/state/audit-calls"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup create --output-dir "$TMP/created-backups" >"$TMP/backup-create.out"
grep -q '/tmp/mock-xdrive-backup' "$TMP/backup-create.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup list >"$TMP/backup-list.out"
grep -q 'xdrive-backup-20260928T120000Z' "$TMP/backup-list.out"
grep -q '2026-09-28T12:00:00Z' "$TMP/backup-list.out"
grep -q 'master' "$TMP/backup-list.out"
grep -q '0123456789ab' "$TMP/backup-list.out"
grep -q 'complete' "$TMP/backup-list.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup verify "$SNAPSHOT" >"$TMP/backup-verify.out"
grep -q "Backup verified: $SNAPSHOT" "$TMP/backup-verify.out"
grep -q 'release: master / 0123456789ab' "$TMP/backup-verify.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup verify >"$TMP/backup-verify-latest.out"
grep -q "Backup verified: $SNAPSHOT" "$TMP/backup-verify-latest.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup sources "$SNAPSHOT" >"$TMP/backup-sources.out"
grep -Fq $'ID\tOWNER_ID\tNAME\tKIND\tDIRECTION\tRUN_MODE\tSTATUS\tUPDATED_AT' "$TMP/backup-sources.out"
grep -Fq $'1\t1\t一刻相册\tyike_photos\tpull\tscan\tactive' "$TMP/backup-sources.out"
grep -Fq $'2\t1\t群晖 Photos\tsynology_photos\tpull\tsync\tactive' "$TMP/backup-sources.out"
grep -q "Backup: $SNAPSHOT" "$TMP/backup-sources.out"
grep -q -- 'exec -T postgres pg_restore --data-only --table=public.xd_sources --file=-' "$TMP/state/docker-args"

CORRUPT="$TMP/home/backups/snapshots/xdrive-backup-20260928T110000Z"
cp -a "$SNAPSHOT" "$CORRUPT"
printf 'corrupt\n' >> "$CORRUPT/database.dump"
set +e
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup verify "$CORRUPT" >"$TMP/backup-corrupt.out" 2>"$TMP/backup-corrupt.err"
corrupt_status=$?
set -e
[[ "$corrupt_status" -ne 0 ]]
grep -Eq 'FAILED|did NOT match' "$TMP/backup-corrupt.out" "$TMP/backup-corrupt.err"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" restore /tmp/backup --yes >"$TMP/restore.out"
grep -q '^/tmp/backup --yes$' "$TMP/state/restore-args"
grep -q -- 'audit record --action system.restore --result success' "$TMP/state/audit-calls"

set +e
TEST_BACKUP_FAIL=1 \
TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" backup >/dev/null 2>"$TMP/backup-fail.err"
backup_fail_status=$?
set -e
[[ "$backup_fail_status" -eq 7 ]]
grep -q 'mock backup failed' "$TMP/backup-fail.err"
grep -q -- 'audit record --action system.backup --result failure' "$TMP/state/audit-calls"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" doctor --strict >"$TMP/doctor.out"
grep -q '^--strict$' "$TMP/state/doctor-args"
grep -q 'mock doctor' "$TMP/doctor.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" verify --repair --dry-run >"$TMP/verify.out"
grep -q '^--repair --dry-run$' "$TMP/state/verify-args"
grep -q 'mock verify' "$TMP/verify.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" verify --repair >"$TMP/verify-repair.out"
grep -q '^--repair$' "$TMP/state/verify-args"
grep -q -- 'audit record --action system.storage_repair --result success' "$TMP/state/audit-calls"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" source verify --json >"$TMP/source-verify.out"
grep -q '"issues":\[\]' "$TMP/source-verify.out"
grep -q -- 'exec -T server xdrive-server source verify --json' "$TMP/state/docker-args"
if grep -q '^pipe:' "$TMP/state/source-verify-stdin"; then
  echo "source verify inherited caller stdin" >&2
  exit 1
fi

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" media verify --json >"$TMP/media-verify.out"
grep -q '"issues":\[\]' "$TMP/media-verify.out"
grep -q -- 'exec -T server xdrive-server media verify --json' "$TMP/state/docker-args"
if grep -q '^pipe:' "$TMP/state/media-verify-stdin"; then
  echo "media verify inherited caller stdin" >&2
  exit 1
fi

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" admin list >"$TMP/admin-list.out"
grep -q 'USERNAME' "$TMP/admin-list.out"
grep -q 'LAST_LOGIN' "$TMP/admin-list.out"
grep -q 'admin' "$TMP/admin-list.out"
if grep -q '^pipe:' "$TMP/state/admin-list-stdin"; then
  echo "admin list inherited caller stdin" >&2
  exit 1
fi

printf '%s\n' 'super-secret-new-password' | \
  TEST_STATE="$TMP/state" \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_CONFIG_DIR="$TMP/home" \
  bash "$HOST" admin reset-password admin --password-stdin \
    >"$TMP/admin-reset.out" 2>"$TMP/admin-reset.err"

grep -q '^super-secret-new-password$' "$TMP/state/admin-reset-stdin"
grep -q 'must_change_password=true' "$TMP/admin-reset.out"
grep -q -- 'admin reset-password admin --password-stdin' "$TMP/state/docker-args"
if grep -q 'super-secret-new-password' "$TMP/state/docker-args"; then
  echo "password leaked into docker argv" >&2
  exit 1
fi

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" admin disable user-a >"$TMP/admin-disable.out"
grep -q 'disabled user-a' "$TMP/admin-disable.out"
grep -q -- 'admin disable user-a' "$TMP/state/docker-args"
if grep -q '^pipe:' "$TMP/state/admin-disable-stdin"; then
  echo "admin disable inherited caller stdin" >&2
  exit 1
fi

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" admin enable admin >"$TMP/admin-enable.out"
grep -q 'enabled admin' "$TMP/admin-enable.out"
grep -q -- 'admin enable admin' "$TMP/state/docker-args"
if grep -q '^pipe:' "$TMP/state/admin-enable-stdin"; then
  echo "admin enable inherited caller stdin" >&2
  exit 1
fi

before="$(wc -l < "$TMP/state/docker-args")"
if TEST_STATE="$TMP/state" \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_CONFIG_DIR="$TMP/home" \
  bash "$HOST" admin reset-password admin --password exposed-secret >/dev/null 2>"$TMP/password-arg.err"; then
  echo "--password unexpectedly accepted" >&2
  exit 1
fi
grep -q -- '--password is not supported' "$TMP/password-arg.err"
after="$(wc -l < "$TMP/state/docker-args")"
if [[ "$before" != "$after" ]]; then
  echo "rejected --password invocation reached Docker" >&2
  exit 1
fi

# Host update control: one long-lived runner transitions idle -> running -> success.
cp "$HOST" "$TMP/home/bin/xdrive-server"
cp "$ROOT/scripts/server-control.sh" "$TMP/home/bin/server-control.sh"
chmod 700 "$TMP/home/bin/xdrive-server" "$TMP/home/bin/server-control.sh"
printf '\nXD_UPDATE_SOURCE=github\nXD_HOST_CONTROL_HOST_DIR=%s\n' "$TMP/home/state/control" >> "$TMP/home/config/.env"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
XD_INSTALLER_URL="https://example.invalid/install-server.sh" \
bash "$TMP/home/bin/server-control.sh" serve >"$TMP/control-run.out" 2>"$TMP/control-run.err" &
CONTROL_TEST_PID=$!

for _ in $(seq 1 50); do
  if grep -q '"state":"idle"' "$TMP/home/state/control/status.json" 2>/dev/null; then
    break
  fi
  kill -0 "$CONTROL_TEST_PID" 2>/dev/null || {
    echo "host control runner exited before idle state" >&2
    exit 1
  }
  sleep 0.1
done
grep -q '"state":"idle"' "$TMP/home/state/control/status.json"
[[ -f "$TMP/home/state/control/heartbeat" ]]
grep -Eq '^[0-9]+$' "$TMP/home/state/control/runner.pid"

request_tmp="$TMP/home/state/control/.request-test.tmp"
cat > "$request_tmp" <<EOF
{"request_id":"test-request-1","source":"github","channel":"master","requested_by":"admin","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
chmod 660 "$request_tmp"
ln "$request_tmp" "$TMP/home/state/control/request.json"
rm -f "$request_tmp"
[[ "$(stat -c '%a' "$TMP/home/state/control")" == "2770" ]]

for _ in $(seq 1 100); do
  if grep -q '"state":"success"' "$TMP/home/state/control/status.json" 2>/dev/null &&
     grep -q '"request_id":"test-request-1"' "$TMP/home/state/control/status.json" 2>/dev/null; then
    break
  fi
  kill -0 "$CONTROL_TEST_PID" 2>/dev/null || {
    echo "host control runner exited before completing update" >&2
    exit 1
  }
  sleep 0.1
done
grep -q '"state":"success"' "$TMP/home/state/control/status.json"
grep -q '"request_id":"test-request-1"' "$TMP/home/state/control/status.json"
grep -q '^--source github --channel master$' "$TMP/state/installer-args"
[[ ! -f "$TMP/home/state/control/request.json" ]]
[[ ! -f "$TMP/home/state/control/active.json" ]]

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$TMP/home/bin/server-control.sh" stop
wait "$CONTROL_TEST_PID" || true
CONTROL_TEST_PID=""

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/home" \
bash "$HOST" control status >"$TMP/control-status.out"
grep -q '"state":"success"' "$TMP/control-status.out"

# Restart recovery: an orphaned active request must become failed, never stay running forever.
cat > "$TMP/home/state/control/active.json" <<EOF
{"request_id":"interrupted-1","source":"gitlab","channel":"stable","requested_by":"admin","created_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
XD_CONFIG_DIR="$TMP/home" XD_CONTROL_ONCE=1 \
  bash "$TMP/home/bin/server-control.sh" serve >"$TMP/control-recovery.out" 2>"$TMP/control-recovery.err"
grep -q '"state":"failed"' "$TMP/home/state/control/status.json"
grep -q '"request_id":"interrupted-1"' "$TMP/home/state/control/status.json"
grep -q 'host update interrupted before completion' "$TMP/home/state/control/status.json"
[[ ! -f "$TMP/home/state/control/active.json" ]]

# Stale queued requests are rejected by the host even if someone writes the bridge directly.
cat > "$TMP/home/state/control/request.json" <<'EOF'
{"request_id":"stale-1","source":"github","channel":"master","requested_by":"admin","created_at":"2020-01-01T00:00:00Z"}
EOF
XD_CONFIG_DIR="$TMP/home" XD_CONTROL_ONCE=1 \
  bash "$TMP/home/bin/server-control.sh" serve >"$TMP/control-stale.out" 2>"$TMP/control-stale.err"
grep -q '"state":"failed"' "$TMP/home/state/control/status.json"
grep -q '"request_id":"stale-1"' "$TMP/home/state/control/status.json"
grep -q 'invalid or stale host-control request' "$TMP/home/state/control/status.json"
[[ ! -f "$TMP/home/state/control/request.json" ]]

echo "host xdrive-server manager tests passed"
