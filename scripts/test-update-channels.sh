#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FULL_SHA="abcdef0123456789abcdef0123456789abcdef01"
FIXTURE="$TMP/published-installer.sh"
cat > "$FIXTURE" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s\n' "${XD_INSTALL_CHANNEL:-}" "${XD_INSTALL_COMMIT:-}" "${XD_CONFIG_DIR:-}" > "$XDRIVE_TEST_OUT"
SH
chmod +x "$FIXTURE"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      output="$2"; shift 2 ;;
    -*)
      shift ;;
    *)
      url="$1"; shift ;;
  esac
done

if [[ "$url" == *"/commits/"* ]]; then
  printf '{\n  "sha": "%s"\n}\n' "$XDRIVE_TEST_FULL_SHA"
  exit 0
fi

if [[ -z "$output" ]]; then
  echo "fake curl: output path required for $url" >&2
  exit 1
fi

case "$url" in
  */xdrive-server-install.sh)
    cp "$XDRIVE_TEST_FIXTURE" "$output"
    ;;
  */SHA256SUMS.txt)
    hash="$(sha256sum "$XDRIVE_TEST_FIXTURE" | awk '{print $1}')"
    printf '%s  xdrive-server-install.sh\n' "$hash" > "$output"
    ;;
  *)
    echo "fake curl: unexpected URL $url" >&2
    exit 1
    ;;
esac
SH
chmod +x "$TMP/bin/curl"

run_case() {
  local name="$1"
  shift
  local cfg="$TMP/$name"
  local out="$TMP/$name.out"
  mkdir -p "$cfg"
  PATH="$TMP/bin:$PATH" \
  XDRIVE_TEST_FULL_SHA="$FULL_SHA" \
  XDRIVE_TEST_FIXTURE="$FIXTURE" \
  XDRIVE_TEST_OUT="$out" \
  XD_CONFIG_DIR="$cfg" \
    bash "$INSTALLER" "$@"
  cat "$out"
}

stable="$(run_case stable --channel stable)"
[[ "$stable" == "stable||$TMP/stable" ]] || {
  echo "stable bootstrap mismatch: $stable" >&2
  exit 1
}

master="$(run_case master --channel master)"
[[ "$master" == "master||$TMP/master" ]] || {
  echo "master bootstrap mismatch: $master" >&2
  exit 1
}

commit="$(run_case commit --commit abcdef0)"
[[ "$commit" == "commit|$FULL_SHA|$TMP/commit" ]] || {
  echo "commit bootstrap mismatch: $commit" >&2
  exit 1
}

mkdir -p "$TMP/persisted"
printf 'XD_RELEASE_CHANNEL=master\n' > "$TMP/persisted/.env"
persisted="$(
  PATH="$TMP/bin:$PATH" \
  XDRIVE_TEST_FULL_SHA="$FULL_SHA" \
  XDRIVE_TEST_FIXTURE="$FIXTURE" \
  XDRIVE_TEST_OUT="$TMP/persisted.out" \
  XD_CONFIG_DIR="$TMP/persisted" \
    bash "$INSTALLER"
  cat "$TMP/persisted.out"
)"
[[ "$persisted" == "master||$TMP/persisted" ]] || {
  echo "persisted channel mismatch: $persisted" >&2
  exit 1
}

mkdir -p "$TMP/legacy"
printf 'XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:edge\n' > "$TMP/legacy/.env"
legacy="$(
  PATH="$TMP/bin:$PATH" \
  XDRIVE_TEST_FULL_SHA="$FULL_SHA" \
  XDRIVE_TEST_FIXTURE="$FIXTURE" \
  XDRIVE_TEST_OUT="$TMP/legacy.out" \
  XD_CONFIG_DIR="$TMP/legacy" \
    bash "$INSTALLER"
  cat "$TMP/legacy.out"
)"
[[ "$legacy" == "master||$TMP/legacy" ]] || {
  echo "legacy edge channel inference mismatch: $legacy" >&2
  exit 1
}

echo "server update channel bootstrap tests passed"
