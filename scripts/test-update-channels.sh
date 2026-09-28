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
    -o|--output) output="$2"; shift 2 ;;
    --retry|--retry-delay|--connect-timeout|-w|--write-out) shift 2 ;;
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
  */api/v4/projects/xuliang%2Fxdrive/repository/commits/snapshot)
    emit '{
  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}'
    ;;
  */api/v4/projects/xuliang%2Fxdrive/repository/commits/*)
    emit '{
  "id": "abcdef0123456789abcdef0123456789abcdef01"
}'
    ;;
  */api/v4/projects/xuliang%2Fxdrive/releases/snapshot)
    emit '{
  "tag_name": "snapshot",
  "description": "Rolling development snapshot. XDRIVE_RELEASE_COMMIT=abcdef0123456789abcdef0123456789abcdef01",
  "commit": {"id":"abcdef0123456789abcdef0123456789abcdef01"}
}'
    ;;
  */api/v4/projects/xuliang%2Fxdrive/releases?*)
    emit '[
  {"tag_name":"snapshot","released_at":"2026-09-27T12:00:00Z"},
  {"tag_name":"v1.2.3","released_at":"2026-09-26T12:00:00Z"}
]'
    ;;
  */api/v4/projects/xuliang%2Fxdrive)
    emit '{
  "container_registry_image_prefix": "registry.gitlab.example/xuliang/xdrive"
}'
    ;;
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
  */releases/tags/snapshot)
    emit '{"tag_name":"snapshot"}'
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
  */scripts/server-backup.sh|*/scripts/server-backup-scheduled.sh|*/scripts/server-restore.sh|*/scripts/server-verify.sh|*/scripts/server-doctor.sh|*/scripts/server-migrate-user.sh|*/scripts/xdrive-server-host.sh)
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
if [[ "$1" == "info" ]]; then
  if [[ "$*" == *"--format"* ]]; then echo '[]'; fi
  exit 0
fi
if [[ "$#" -ge 2 && "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi
echo "fake docker: unexpected invocation: $*" >&2
exit 1
SH
chmod +x "$TMP/bin/docker"

cat > "$TMP/bin/flock" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/flock"

run_case() {
  local name="$1"
  shift
  local cfg="$TMP/$name"
  local installer="${XDRIVE_TEST_INSTALLER:-$INSTALLER}"
  mkdir -p "$cfg"
  if ! XDRIVE_TEST_STATE="$TMP/state" \
    PATH="$TMP/bin:/usr/bin:/bin" \
    XD_CONFIG_DIR="$cfg" \
    XD_SHELL_RC_PATH="$cfg.bashrc" \
    XD_NONINTERACTIVE=1 \
    XD_INSTALL_NO_START=1 \
      bash "$installer" "$@" >"$TMP/$name.out" 2>"$TMP/$name.err"; then
    echo "update-channel case failed: $name" >&2
    cat "$TMP/$name.out" >&2 || true
    cat "$TMP/$name.err" >&2 || true
    exit 1
  fi
}

env_value() {
  local cfg="$1" key="$2"
  grep "^$key=" "$cfg/config/.env" | tail -n1 | cut -d= -f2-
}

run_case stable --channel stable
[[ "$(env_value "$TMP/stable" XD_RELEASE_CHANNEL)" == "stable" ]]
[[ "$(env_value "$TMP/stable" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:$STABLE_TAG" ]]
[[ "$(env_value "$TMP/stable" XD_CADDY_IMAGE)" == "ghcr.io/lazyxu/xdrive-caddy:$STABLE_TAG" ]]
grep -q "Resolved stable release: $STABLE_TAG" "$TMP/stable.out"

run_case master --channel master
[[ "$(env_value "$TMP/master" XD_RELEASE_CHANNEL)" == "master" ]]
[[ "$(env_value "$TMP/master" XD_SERVER_IMAGE)" == "ghcr.io/lazyxu/xdrive-server:sha-$SHORT_SHA" ]]
[[ "$(env_value "$TMP/master" XD_CADDY_IMAGE)" == "ghcr.io/lazyxu/xdrive-caddy:sha-$SHORT_SHA" ]]
if grep -q '^XD_WEB_IMAGE=' "$TMP/master/config/.env"; then
  echo "master channel must not persist XD_WEB_IMAGE" >&2
  exit 1
fi
[[ "$(env_value "$TMP/master" XD_RELEASE_COMMIT)" == "$FULL_SHA" ]]
grep -q "Resolved latest fully published master snapshot: $SHORT_SHA" "$TMP/master.out"


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

mkdir -p "$TMP/mirror"
export XD_IMAGE_REGISTRY=registry.example.test/team
run_case mirror --channel master
unset XD_IMAGE_REGISTRY
[[ "$(env_value "$TMP/mirror" XD_IMAGE_REGISTRY)" == "registry.example.test/team" ]]
[[ "$(env_value "$TMP/mirror" XD_SERVER_IMAGE)" == "registry.example.test/team/xdrive-server:sha-$SHORT_SHA" ]]
[[ "$(env_value "$TMP/mirror" XD_CADDY_IMAGE)" == "registry.example.test/team/xdrive-caddy:sha-$SHORT_SHA" ]]

run_case gitlab-master --source gitlab --channel master
[[ "$(env_value "$TMP/gitlab-master" XD_UPDATE_SOURCE)" == "gitlab" ]]
[[ "$(env_value "$TMP/gitlab-master" XD_RELEASE_CHANNEL)" == "master" ]]
[[ "$(env_value "$TMP/gitlab-master" XD_IMAGE_REGISTRY)" == "registry.gitlab.example/xuliang/xdrive" ]]
[[ "$(env_value "$TMP/gitlab-master" XD_SERVER_IMAGE)" == "registry.gitlab.example/xuliang/xdrive/xdrive-server:sha-$SHORT_SHA" ]]
[[ "$(env_value "$TMP/gitlab-master" XD_RELEASE_COMMIT)" == "$FULL_SHA" ]]
grep -q "Resolved latest fully published GitLab master snapshot: $SHORT_SHA" "$TMP/gitlab-master.out"

run_case gitlab-stable --source gitlab --channel stable
[[ "$(env_value "$TMP/gitlab-stable" XD_UPDATE_SOURCE)" == "gitlab" ]]
[[ "$(env_value "$TMP/gitlab-stable" XD_RELEASE_CHANNEL)" == "stable" ]]
[[ "$(env_value "$TMP/gitlab-stable" XD_SERVER_IMAGE)" == "registry.gitlab.example/xuliang/xdrive/xdrive-server:$STABLE_TAG" ]]
grep -q "Resolved stable release: $STABLE_TAG" "$TMP/gitlab-stable.out"

BAKED_GITLAB_INSTALLER="$TMP/xdrive-server-install-gitlab.sh"
sed \
  -e "s|@SOURCE_REF@|$FULL_SHA|g" \
  -e "s|@IMAGE_TAG@|sha-$SHORT_SHA|g" \
  -e 's|@IMAGE_REGISTRY@|registry.gitlab.example/xuliang/xdrive|g' \
  -e 's|@RELEASE_CHANNEL@|master|g' \
  -e "s|@RELEASE_COMMIT@|$FULL_SHA|g" \
  -e 's|@UPDATE_SOURCE@|gitlab|g' \
  "$INSTALLER" > "$BAKED_GITLAB_INSTALLER"
chmod +x "$BAKED_GITLAB_INSTALLER"

XDRIVE_TEST_INSTALLER="$BAKED_GITLAB_INSTALLER" run_case gitlab-baked
[[ "$(env_value "$TMP/gitlab-baked" XD_UPDATE_SOURCE)" == "gitlab" ]]
[[ "$(env_value "$TMP/gitlab-baked" XD_RELEASE_CHANNEL)" == "master" ]]
[[ "$(env_value "$TMP/gitlab-baked" XD_RELEASE_COMMIT)" == "$FULL_SHA" ]]
[[ "$(env_value "$TMP/gitlab-baked" XD_IMAGE_REGISTRY)" == "registry.gitlab.example/xuliang/xdrive" ]]
[[ "$(env_value "$TMP/gitlab-baked" XD_SERVER_IMAGE)" == "registry.gitlab.example/xuliang/xdrive/xdrive-server:sha-$SHORT_SHA" ]]
grep -q "Using packaged release source: $FULL_SHA" "$TMP/gitlab-baked.out"
if grep -q 'Resolved latest fully published' "$TMP/gitlab-baked.out"; then
  echo "baked GitLab installer must use its packaged release without re-resolving the channel" >&2
  exit 1
fi



set +e
XD_IMAGE_REGISTRY=https://registry.example.test/team \
  XDRIVE_TEST_STATE="$TMP/state" \
  PATH="$TMP/bin:/usr/bin:/bin" \
  XD_CONFIG_DIR="$TMP/invalid-registry" \
  XD_SHELL_RC_PATH="$TMP/invalid-registry.bashrc" \
  XD_NONINTERACTIVE=1 \
  XD_INSTALL_NO_START=1 \
  bash "$INSTALLER" --channel master >"$TMP/invalid-registry.out" 2>"$TMP/invalid-registry.err"
invalid_registry_status=$?
set -e
[[ "$invalid_registry_status" -ne 0 ]]
grep -q 'XD_IMAGE_REGISTRY must be a registry namespace without a URL scheme' "$TMP/invalid-registry.err"

echo "server update channel resolution tests passed"
