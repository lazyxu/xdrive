#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="$ROOT/scripts/xdrive-server-host.sh"
TMP="$(mktemp -d)"
cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "host xdrive-server manager test failed (exit $status)" >&2
    for file in update.out update.err doctor.out admin-list.out admin-reset.out admin-reset.err admin-enable.out admin-disable.out password-arg.err state/curl-url state/installer-args state/installer-stdin state/doctor-args state/docker-args state/admin-list-stdin state/admin-reset-stdin state/admin-enable-stdin state/admin-disable-stdin; do
      if [[ -f "$TMP/$file" ]]; then
        echo "===== $file =====" >&2
        cat "$TMP/$file" >&2 || true
      fi
    done
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/bin" "$TMP/config" "$TMP/state"

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
cat > "$out" <<'INSTALL'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/installer-args"
readlink /proc/$$/fd/0 > "$TEST_STATE/installer-stdin" || true
INSTALL
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/docker-args"
case "$*" in
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

cat > "$TMP/config/server-doctor.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/doctor-args"
echo "mock doctor"
SH
chmod +x "$TMP/config/server-doctor.sh"
printf 'XD_DOMAIN=\n' > "$TMP/config/.env"
printf 'name: xdrive\nservices: {}\n' > "$TMP/config/docker-compose.yml"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
XD_INSTALLER_URL="https://example.invalid/install-server.sh" \
bash "$HOST" update --channel master --commit 0123456789ab >"$TMP/update.out" 2>"$TMP/update.err"

grep -q '^https://example.invalid/install-server.sh$' "$TMP/state/curl-url"
grep -q '^--channel master --commit 0123456789ab$' "$TMP/state/installer-args"
if grep -q '^pipe:' "$TMP/state/installer-stdin"; then
  echo "host updater passed a pipe as installer stdin" >&2
  cat "$TMP/state/installer-stdin" >&2
  exit 1
fi
grep -q 'installer downloaded and syntax-checked' "$TMP/update.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
bash "$HOST" doctor --strict >"$TMP/doctor.out"
grep -q '^--strict$' "$TMP/state/doctor-args"
grep -q 'mock doctor' "$TMP/doctor.out"

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
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
  XD_CONFIG_DIR="$TMP/config" \
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
XD_CONFIG_DIR="$TMP/config" \
bash "$HOST" admin disable user-a >"$TMP/admin-disable.out"
grep -q 'disabled user-a' "$TMP/admin-disable.out"
grep -q -- 'admin disable user-a' "$TMP/state/docker-args"
if grep -q '^pipe:' "$TMP/state/admin-disable-stdin"; then
  echo "admin disable inherited caller stdin" >&2
  exit 1
fi

TEST_STATE="$TMP/state" \
PATH="$TMP/bin:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config" \
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
  XD_CONFIG_DIR="$TMP/config" \
  bash "$HOST" admin reset-password admin --password exposed-secret > /dev/null 2>"$TMP/password-arg.err"; then
  echo "--password unexpectedly accepted" >&2
  exit 1
fi
grep -q -- '--password is not supported' "$TMP/password-arg.err"
after="$(wc -l < "$TMP/state/docker-args")"
if [[ "$before" != "$after" ]]; then
  echo "rejected --password invocation reached Docker" >&2
  exit 1
fi

echo "host xdrive-server manager tests passed"
