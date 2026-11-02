#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Exact official image from the failed publisher, not a substitute mock CLI.
image="${XDRIVE_CI_GLAB_IMAGE:-registry.gitlab.com/gitlab-org/cli@sha256:79223ad3fa6e3c3226119ac5d0b73e55f1b909e6d5bbf8469726480723b63ba8}"
container=""
cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Prevent Git Bash from rewriting container paths and command arguments.
export MSYS_NO_PATHCONV=1
container="$(docker create --label com.xdrive.ci-fixture=gitlab-publisher-cli \
  --entrypoint sh -e TEMP=/tmp -e TMP=/tmp -e TMPDIR=/tmp \
  -e "XDRIVE_CI_ALPINE_MIRROR=${XDRIVE_CI_ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}" \
  -w /work "$image" -c 'sleep 900')"
docker start "$container" >/dev/null
docker exec "$container" mkdir -p /work/scripts/ci
for name in gitlab-publish-release.sh verify-synology-spk-release.sh \
  install-gitlab-release-tools.sh test-gitlab-snapshot-publish.py; do
  source_file="$ROOT/scripts/ci/$name"
  if command -v cygpath >/dev/null 2>&1; then source_file="$(cygpath -w "$source_file")"; fi
  docker cp "$source_file" "$container:/work/scripts/ci/$name"
done
docker exec "$container" timeout 180 sh -eu -c '
  sh scripts/ci/install-gitlab-release-tools.sh
  # Python is only a test dependency. Keep the same signed, bounded repositories
  # and never change the original image repository configuration.
  series=$(cut -d. -f1,2 /etc/alpine-release)
  repos=$(mktemp)
  trap '\''rm -f "$repos"'\'' EXIT
  install_python() {
    printf "%s/v%s/main\n%s/v%s/community\n" "${1%/}" "$series" "${1%/}" "$series" > "$repos"
    apk --repositories-file "$repos" --timeout 20 --no-cache add python3
  }
  if ! install_python "$XDRIVE_CI_ALPINE_MIRROR"; then
    install_python https://dl-cdn.alpinelinux.org/alpine
  fi
  glab --version
'
# All API requests must now be loopback fixture requests. No credentials or
# production GitLab are available, even if CLI host resolution regresses.
docker network disconnect bridge "$container"
docker exec "$container" timeout 180 sh -eu -c '
  export XDRIVE_TEST_REAL_GLAB=$(command -v glab)
  python3 scripts/ci/test-gitlab-snapshot-publish.py
'
