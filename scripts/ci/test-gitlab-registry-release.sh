#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/scripts/ci" "$TMP/bin" "$TMP/dist/media-worker-image"
for name in gitlab-release-version.sh gitlab-registry-utils.sh gitlab-stable-prestage-gate.sh \
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
    if [[ -n "${MOCK_PULL_ERROR_FILE:-}" && ( "$ref" == *:sha-* || "$ref" == *:edge || "$ref" == *:contract-* ) ]]; then
      cat "$MOCK_PULL_ERROR_FILE" >&2; exit 1
    fi
    if [[ "${MOCK_EDGE_STATE:-}" == outage && "$ref" == *:edge ]]; then
      echo 'dial tcp: connect timeout' >&2; exit 1
    fi
    if [[ "${MOCK_EDGE_STATE:-}" == missing && "$ref" == *:edge ]] && ! grep -Fxq "push $ref" "$MOCK_DOCKER_EVENTS"; then
      if [[ "${MOCK_MISSING_FORMAT:-}" == containerd ]]; then
        printf 'Error response from daemon: failed to resolve reference "%s": %s: not found\n' "$ref" "$ref" >&2
      else
        echo 'manifest unknown: manifest unknown' >&2
      fi
      exit 1
    fi
    if [[ "${MOCK_RELEASE_EXISTS:-0}" != 1 && "$ref" == *:sha-* ]]; then
      if [[ "${MOCK_MISSING_FORMAT:-}" == containerd ]]; then
        printf 'Error response from daemon: failed to resolve reference "%s": %s: not found\n' "$ref" "$ref" >&2
      else
        echo 'manifest unknown: manifest unknown' >&2
      fi
      exit 1
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
          if [[ "$ref" == *xdrive-caddy:* && "${MOCK_LEGACY_CADDY:-0}" == 1 ]] && ! grep -Fxq "push $ref" "$MOCK_DOCKER_EVENTS"; then
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

# Pipeline 3821: containerd reports the exact unresolved reference as not found.
# The real publisher must still verify staged bytes before creating the tag.
export MOCK_MISSING_FORMAT=containerd
: > "$MOCK_DOCKER_EVENTS"
bash scripts/ci/gitlab-server-images.sh xdrive-media-worker dist/media-worker-image xdrive/media-worker:test
grep -Fxq "push $CI_REGISTRY_IMAGE/xdrive-media-worker:sha-${CI_COMMIT_SHA:0:12}" "$MOCK_DOCKER_EVENTS"
unset MOCK_MISSING_FORMAT

# Exercise the shared helper used by immutable, mutable and runtime tags.
source scripts/ci/gitlab-registry-utils.sh
export MOCK_PULL_ERROR_FILE="$TMP/pull-error"
for suffix in sha-0123456789ab edge contract-0123456789ab; do
  ref="$CI_REGISTRY_IMAGE/xdrive-photo-face-runtime:$suffix"
  printf 'Error response from daemon: failed to resolve reference "%s": %s: not found\n' "$ref" "$ref" > "$MOCK_PULL_ERROR_FILE"
  status=0
  xdrive_pull_or_absent "$ref" || status=$?
  [[ "$status" == 10 ]] || { echo 'exact containerd missing manifest was not recognized' >&2; exit 1; }
done

# Similar text is not proof of absence: unrelated references, HTTP routes,
# credential helpers, authorization, transport errors and mixed output all fail.
ref="$CI_REGISTRY_IMAGE/xdrive-media-worker:sha-${CI_COMMIT_SHA:0:12}"
other="$CI_REGISTRY_IMAGE/unrelated:edge"
for diagnostic in \
  "Error response from daemon: failed to resolve reference \"$other\": $other: not found" \
  "Error response from daemon: failed to resolve reference \"$ref\": $other: not found" \
  "Error response from daemon: failed to resolve reference \"$ref\": unexpected status from HEAD request: 404 Not Found" \
  "Error response from daemon: failed to resolve reference \"$ref\": 401 Unauthorized" \
  'denied: access forbidden (403)' \
  'dial tcp: lookup registry.test.invalid: no such host' \
  'net/http: TLS handshake timeout' \
  'x509: certificate signed by unknown authority' \
  'unexpected status: 503 Service Unavailable' \
  'error getting credentials: executable docker-credential-test not found' \
  'blob sha256:1234: not found' \
  "$(printf 'Error response from daemon: failed to resolve reference "%s": %s: not found\nunauthorized: authentication required' "$ref" "$ref")"; do
  printf '%s\n' "$diagnostic" > "$MOCK_PULL_ERROR_FILE"
  status=0
  xdrive_pull_or_absent "$ref" > "$TMP/unknown.log" 2>&1 || status=$?
  [[ "$status" == 1 ]] || { echo 'unknown pull error treated as absence' >&2; exit 1; }
  for publisher in gitlab-server-images.sh gitlab-promote-images.sh; do
    : > "$MOCK_DOCKER_EVENTS"
    args=()
    if [[ "$publisher" == gitlab-server-images.sh ]]; then
      args=(xdrive-media-worker dist/media-worker-image xdrive/media-worker:test)
    fi
    if bash "scripts/ci/$publisher" "${args[@]}" > "$TMP/unknown-publisher.log" 2>&1; then
      echo 'unknown registry failure allowed publication' >&2; exit 1
    fi
    ! grep -q '^push ' "$MOCK_DOCKER_EVENTS"
  done
done
unset MOCK_PULL_ERROR_FILE

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
export MOCK_MISSING_FORMAT=containerd
: > "$MOCK_DOCKER_EVENTS"
bash scripts/ci/gitlab-promote-images.sh > "$TMP/bootstrap-containerd.log" 2>&1
grep -Fxq "push $CI_REGISTRY_IMAGE/xdrive-server:edge" "$MOCK_DOCKER_EVENTS"
unset MOCK_MISSING_FORMAT
unset MOCK_EDGE_STATE

echo 'GitLab Registry staging, immutable conflict, stale edge, outage and legacy Caddy regressions passed'
