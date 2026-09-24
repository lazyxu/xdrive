#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="$ROOT/scripts/xdrive-server-host.sh"
TMP="$(mktemp -d)"
cleanup() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "host xdrive-server manager test failed (exit $status)" >&2
    for file in update.out update.err doctor.out state/curl-url state/installer-args state/installer-stdin state/doctor-args; do
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

cat > "$TMP/config/server-doctor.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_STATE/doctor-args"
echo "mock doctor"
SH
chmod +x "$TMP/config/server-doctor.sh"

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

echo "host xdrive-server manager tests passed"
