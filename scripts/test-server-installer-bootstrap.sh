#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin-ok" "$TMP/bin-fail" "$TMP/state" "$TMP/result"

cat > "$TMP/bin-ok/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ -n "$url" && -n "$out" ]]
printf '%s\n' "$url" >> "$TEST_STATE/urls"
case "$url" in
  */xdrive-server-install.sh)
    cat > "$out" <<'CHILD'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${XD_INSTALL_CHANNEL:-}" > "$TEST_RESULT_DIR/channel"
printf '%s\n' "${XD_INSTALL_RESOLVED:-}" > "$TEST_RESULT_DIR/resolved"
exit 0
CHILD
    sha256sum "$out" | awk '{print $1}' > "$TEST_STATE/checksum"
    ;;
  */SHA256SUMS.txt)
    printf '%s  xdrive-server-install.sh\n' "$(cat "$TEST_STATE/checksum")" > "$out"
    ;;
  *)
    echo "unexpected URL: $url" >&2
    exit 9
    ;;
esac
SH
chmod +x "$TMP/bin-ok/curl"

TEST_STATE="$TMP/state" TEST_RESULT_DIR="$TMP/result" \
PATH="$TMP/bin-ok:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-ok" XD_NONINTERACTIVE=1 \
bash "$INSTALLER" >"$TMP/ok.out" 2>"$TMP/ok.err"

grep -qx 'master' "$TMP/result/channel"
grep -qx '1' "$TMP/result/resolved"
grep -q '/releases/download/snapshot/xdrive-server-install.sh$' "$TMP/state/urls"
grep -q '/releases/download/snapshot/SHA256SUMS.txt$' "$TMP/state/urls"

cat > "$TMP/bin-fail/curl" <<'SH'
#!/usr/bin/env bash
exit 22
SH
chmod +x "$TMP/bin-fail/curl"

set +e
PATH="$TMP/bin-fail:/usr/bin:/bin" \
XD_CONFIG_DIR="$TMP/config-fail" XD_NONINTERACTIVE=1 \
bash "$INSTALLER" >"$TMP/fail.out" 2>"$TMP/fail.err"
status=$?
set -e

[[ "$status" -ne 0 ]]
grep -q 'no successful published build is available for master' "$TMP/fail.err"
if grep -q 'cannot stat' "$TMP/fail.err"; then
  echo "fetch failure leaked a secondary mv/cannot stat error" >&2
  cat "$TMP/fail.err" >&2
  exit 1
fi

echo "server installer bootstrap tests passed"
