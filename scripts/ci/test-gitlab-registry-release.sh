#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/scripts/ci" "$TMP/bin" "$TMP/dist/media-worker-image"
for name in gitlab-release-version.sh gitlab-registry-utils.sh \
            gitlab-stage-image.sh gitlab-fetch-staged-image.sh \
            gitlab-server-images.sh gitlab-promote-images.sh; do
  cp "$ROOT/scripts/ci/$name" "$TMP/scripts/ci/$name"
done
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_EVENTS"
op="$1"
shift
case "$op" in
  login) cat >/dev/null ;;
  info) ;;
  pull)
    ref="$1"
    if [[ "${MOCK_EDGE_STATE:-}" == outage && "$ref" == *:edge ]]; then
      echo 'dial tcp: connect timeout' >&2; exit 1
    fi
    if [[ "${MOCK_EDGE_STATE:-}" == missing && "$ref" == *:edge ]]; then
      echo 'manifest unknown: manifest unknown' >&2; exit 1
    fi
    if [[ "${MOCK_RELEASE_EXISTS:-0}" != 1 && "$ref" == *:sha-* ]]; then
      echo 'manifest unknown: manifest unknown' >&2; exit 1
    fi
    ;;
  image)
    [[ "$1" == inspect ]] || exit 41
    shift
    [[ "$1" == --format ]] || exit 41
    format="$2"
    ref="$3"
    case "$format" in
      *org.opencontainers.image.version*) printf '%s\n' snapshot ;;
      *org.opencontainers.image.revision*)
        if [[ "$ref" == *:edge ]]; then
          if [[ "$ref" == *xdrive-caddy:* && "${MOCK_LEGACY_CADDY:-0}" == 1 ]]; then
            printf '<no value>\n'
          elif [[ "${MOCK_SERVER_NO_REV:-0}" == 1 && "$ref" == *xdrive-server:* ]]; then
            printf '<no value>\n'
          else
            printf '%s\n' "${MOCK_REMOTE_SHA:-$CI_COMMIT_SHA}"
          fi
        else
          printf '%s\n' "$CI_COMMIT_SHA"
        fi
        ;;
      *'{{.Id}}'*)
        if [[ "${MOCK_RELEASE_EXISTS:-0}" == 1 && "${MOCK_CONFLICT:-0}" == 1 && "$ref" == *:sha-* ]]; then
          printf 'sha256:%064d\n' 2
        else
          printf 'sha256:%064d\n' 1
        fi
        ;;
      *) echo "bad format $format" >&2; exit 42 ;;
    esac
    ;;
  tag) ;;
  push) printf 'tag: digest: sha256:%064d size: 42\n' 0 ;;
  *) echo "unexpected Docker operation: $op" >&2; exit 44 ;;
esac
DOCKER
cat > "$TMP/bin/git" <<'GIT'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  cat-file) exit 0 ;;
  merge-base)
    [[ "$2" == --is-ancestor ]] || exit 2
    [[ "${MOCK_STALE:-0}" != 1 ]]
    ;;
  *) echo "unexpected git: $*" >&2; exit 45 ;;
esac
GIT
chmod +x "$TMP/bin/docker" "$TMP/bin/git"
export PATH="$TMP/bin:$PATH"
export MOCK_DOCKER_EVENTS="$TMP/events"
export CI_COMMIT_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export CI_COMMIT_BRANCH=master CI_COMMIT_TAG=""
export CI_PIPELINE_ID=100 CI_JOB_ID=200
export CI_REGISTRY=registry.test.invalid
export CI_REGISTRY_IMAGE=registry.test.invalid/xdrive
export CI_REGISTRY_USER=fake CI_REGISTRY_PASSWORD=synthetic
cd "$TMP"

bash scripts/ci/gitlab-stage-image.sh xdrive-media-worker dist/media-worker-image xdrive/media-worker:test
grep -Fxq "$CI_COMMIT_SHA" dist/media-worker-image/image.commit
grep -Fxq "registry.test.invalid/xdrive/xdrive-media-worker:ci-100-200" dist/media-worker-image/image.ref
grep -Eq '^sha256:[0-9a-f]{64}$' dist/media-worker-image/image.digest
bash scripts/ci/gitlab-server-images.sh xdrive-media-worker dist/media-worker-image xdrive/media-worker:test

# Existing immutable tag with different bytes must be refused.
export MOCK_RELEASE_EXISTS=1 MOCK_CONFLICT=1
if bash scripts/ci/gitlab-server-images.sh xdrive-media-worker dist/media-worker-image xdrive/media-worker:test > "$TMP/conflict.log" 2>&1; then
  echo 'immutable tag conflict was not rejected' >&2; exit 1
fi
grep -Fq 'DIFFERENT bytes' "$TMP/conflict.log"
unset MOCK_CONFLICT
export MOCK_RELEASE_EXISTS=1

# A newer (non-ancestor) edge cannot be overwritten, not even partially.
export MOCK_REMOTE_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb MOCK_STALE=1
: > "$MOCK_DOCKER_EVENTS"
if bash scripts/ci/gitlab-promote-images.sh > "$TMP/stale.log" 2>&1; then
  echo 'stale edge promotion was not rejected' >&2; exit 1
fi
grep -Fq 'stale/divergent promotion refused' "$TMP/stale.log"
! grep -q '^push ' "$MOCK_DOCKER_EVENTS"
unset MOCK_REMOTE_SHA MOCK_STALE

# Registry errors cannot be treated as nonexisting tags.
export MOCK_EDGE_STATE=outage
: > "$MOCK_DOCKER_EVENTS"
if bash scripts/ci/gitlab-promote-images.sh > "$TMP/outage.log" 2>&1; then
  echo 'registry outage incorrectly allowed promotion' >&2; exit 1
fi
grep -Fq 'registry state unknown' "$TMP/outage.log"
! grep -q '^push ' "$MOCK_DOCKER_EVENTS"
unset MOCK_EDGE_STATE

# Legacy Caddy without a revision is permitted only with a verified Server edge.
export MOCK_LEGACY_CADDY=1
bash scripts/ci/gitlab-promote-images.sh > "$TMP/legacy.log" 2>&1
grep -Fq 'pre-revision Caddy edge' "$TMP/legacy.log"
: > "$MOCK_DOCKER_EVENTS"
export MOCK_SERVER_NO_REV=1
if bash scripts/ci/gitlab-promote-images.sh > "$TMP/missing-server-revision.log" 2>&1; then
  echo 'missing Server ancestry was not rejected' >&2; exit 1
fi
grep -Fq 'no verified commit label' "$TMP/missing-server-revision.log"
! grep -q '^push ' "$MOCK_DOCKER_EVENTS"
unset MOCK_LEGACY_CADDY MOCK_SERVER_NO_REV

# A fresh Registry supports safe first promotion after all source labels pass.
export MOCK_EDGE_STATE=missing
bash scripts/ci/gitlab-promote-images.sh > "$TMP/bootstrap.log" 2>&1
unset MOCK_EDGE_STATE

echo 'GitLab Registry staging, immutable conflict, stale edge, outage and legacy Caddy regressions passed'
