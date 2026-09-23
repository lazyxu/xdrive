#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/deploy/install-server.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FULL_SHA="abcdef0123456789abcdef0123456789abcdef01"
SHORT_SHA="${FULL_SHA:0:12}"
STABLE_TAG="v1.2.3"

mkdir -p "$TMP/bin" "$TMP/state"

cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
[[ -n "$url" ]]
printf '%s\n' "$url" >> "$XDRIVE_TEST_STATE/urls"

emit() {
  if [[ -n "$output" ]]; then
    printf '%s' "$1" > "$output"
  else
    printf '%s' "$1"
  fi
}

case "$url" in
  */commits/*)
    emit '{
  "sha": "abcdef0123456789abcdef0123456789abcdef01"
}'
    ;;
  */git/ref/tags/snapshot)
    emit '{
  "object": {
    "type": "commit",
    "sha": "abcdef0123456789abcdef0123456789abcdef01"
  }
}'
    ;;
  */releases/tags/snapshot-abcdef012345)
    emit '{"tag_name":"snapshot-abcdef012345"}'
    ;;
  */releases/latest)
    emit '{
  "tag_name": "v1.2.3"
}'
    ;;
  */deploy/docker-compose.yml)
    emit 'name: xdrive
services: {}
'
    ;;
  */deploy/Caddyfile)
    emit 'example.invalid { respond "ok" }
'
    ;;
  */scripts/server-backup.sh|*/scripts/server-backup-scheduled.sh|*/scripts/server-restore.sh|*/scripts/server-verify.sh)
    emit '#!/usr/bin/env bash
exit 0
'
    ;;
  *)
    echo "fake curl: unexpected URL $url" >&2
    exit 1
    ;;
esac
SH
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 2 && "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi
echo "fake docker: unexpected invocation: $*" >&2
exit 1
SH
chmod +x "$TMP/bin/docker"

run_case() {
  local name="$1"
  shift
  local cfg="$TMP/$name"
  mkdir -p "$cfg"
  XDRIVE_TEST_STATE="$TMP/state" \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_CONFIG_DIR="$cfg" \
  XD_NONINTERACTIVE=1 \
  XD_INSTALL_NO_START=1 \
    bash "$INSTALLER" "$@" >"$TMP/$name.out" 2>"$TMP/$name.err"
}

env_value() {
  local cfg="$1" key="$2"
  grep "^$key=" "$cfg/.env" | tail -n1 | cut -d= -f2-
}

run_case stable --channel stable
[[ "$(env_value "$TMP/stable" XD_RELEASE_CHANNEL)" == "stable" ]]
[[ "$(env_value "$TMP/stable" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:$STABLE_TAG" ]]
[[ "$(env_value "$TMP/stable" XD_WEB_IMAGE)" == "ghcr.io/lazyxu/xdrive-web:$STABLE_TAG" ]]
grep -q "Resolved stable release: $STABLE_TAG" "$TMP/stable.out"

run_case master --channel master
[[ "$(env_value "$TMP/master" XD_RELEASE_CHANNEL)" == "master" ]]
[[ "$(env_value "$TMP/master" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:sha-$SHORT_SHA" ]]
[[ "$(env_value "$TMP/master" XD_WEB_IMAGE)" == "ghcr.io/lazyxu/xdrive-web:sha-$SHORT_SHA" ]]
grep -q "Resolved master snapshot: $SHORT_SHA" "$TMP/master.out"

run_case commit --commit abcdef0
[[ "$(env_value "$TMP/commit" XD_RELEASE_CHANNEL)" == "commit" ]]
[[ "$(env_value "$TMP/commit" XD_RELEASE_COMMIT)" == "$FULL_SHA" ]]
[[ "$(env_value "$TMP/commit" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:sha-$SHORT_SHA" ]]
grep -q "Resolved published commit: $SHORT_SHA" "$TMP/commit.out"

mkdir -p "$TMP/persisted"
printf 'XD_RELEASE_CHANNEL=master\n' > "$TMP/persisted/.env"
run_case persisted
[[ "$(env_value "$TMP/persisted" XD_RELEASE_CHANNEL)" == "master" ]]
[[ "$(env_value "$TMP/persisted" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:sha-$SHORT_SHA" ]]

mkdir -p "$TMP/legacy"
printf 'XD_SERVER_IMAGE=ghcr.io/lazyxu/xdrive-server:edge\n' > "$TMP/legacy/.env"
run_case legacy
[[ "$(env_value "$TMP/legacy" XD_RELEASE_CHANNEL)" == "master" ]]
[[ "$(env_value "$TMP/legacy" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:sha-$SHORT_SHA" ]]

if grep -q '/releases/download/.*/xdrive-server-install.sh' "$TMP/state/urls"; then
  echo "channel resolution must not recursively download another installer" >&2
  exit 1
fi

echo "server update channel resolution tests passed"
