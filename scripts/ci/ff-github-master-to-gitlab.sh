#!/usr/bin/env bash
set -euo pipefail
umask 077

# Manual, fail-closed GitHub -> GitLab fast-forward. No credentials or GitLab
# remote are embedded in source. The invoking workflow must checkout *trusted*
# GitHub master, with full history and persist-credentials: false.
: "${XDRIVE_EXPECTED_GITHUB_SHA:?pass the reviewed, full GitHub master SHA}"
: "${XDRIVE_GITLAB_MIRROR_URL:?configure a GitLab project HTTPS URL in repository variables}"
: "${XDRIVE_GITLAB_MIRROR_PUSH_TOKEN:?configure a write_repository token in Actions secrets}"
: "${GITHUB_SHA:?GitHub Actions event SHA is required}"

if [[ ! "$XDRIVE_EXPECTED_GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo '[xDrive] GitLab mirror refused invalid expected GitHub SHA' >&2
  exit 2
fi
if [[ ! "$XDRIVE_GITLAB_MIRROR_URL" =~ ^https://gitlab\.com/([A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+(\.git)?$ ]]; then
  echo '[xDrive] GitLab mirror URL must be a plain HTTPS project URL under gitlab.com (no credentials/query)' >&2
  exit 2
fi
if [[ "${XDRIVE_GITLAB_MIRROR_APPLY:-false}" != true && "${XDRIVE_GITLAB_MIRROR_APPLY:-false}" != false ]]; then
  echo '[xDrive] apply must be exactly true or false' >&2
  exit 2
fi
if [[ "$GITHUB_SHA" != "$XDRIVE_EXPECTED_GITHUB_SHA" ]]; then
  echo "[xDrive] stale workflow dispatch SHA: event=$GITHUB_SHA reviewed=$XDRIVE_EXPECTED_GITHUB_SHA" >&2
  exit 1
fi
if [[ "$(git rev-parse --is-inside-work-tree)" != true ]]; then
  echo '[xDrive] not a checked-out Git repository' >&2
  exit 2
fi
if [[ "$(git rev-parse --verify HEAD)" != "$XDRIVE_EXPECTED_GITHUB_SHA" ]]; then
  echo '[xDrive] checked-out HEAD is not reviewed master SHA' >&2
  exit 1
fi
origin_url="$(git config --get remote.origin.url)"
if [[ ! "$origin_url" =~ ^https://github\.com/lazyxu/xdrive(\.git)?$ ]]; then
  echo '[xDrive] checkout origin is not the canonical lazyxu/xdrive GitHub remote' >&2
  exit 2
fi

askpass="$(mktemp)"
cleanup() {
  if [[ "${added_remote:-0}" = 1 ]]; then
    git remote remove xdrive-gitlab-mirror >/dev/null 2>&1 || true
  fi
  rm -f "$askpass"
}
trap cleanup EXIT
cat > "$askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *[Uu]sername*) printf 'oauth2\n' ;;
  *[Pp]assword*) printf '%s\n' "${XDRIVE_GITLAB_MIRROR_PUSH_TOKEN:?}" ;;
  *) exit 1 ;;
esac
ASKPASS
chmod 700 "$askpass"
export GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0

# Do not inherit a credential helper that may silently select another identity.
git -c credential.helper= fetch --quiet --no-tags origin \
  +refs/heads/master:refs/remotes/origin/master
source_sha="$(git rev-parse --verify refs/remotes/origin/master)"
if [[ "$source_sha" != "$XDRIVE_EXPECTED_GITHUB_SHA" ]]; then
  echo "[xDrive] GitHub master moved: now=$source_sha reviewed=$XDRIVE_EXPECTED_GITHUB_SHA" >&2
  exit 1
fi
# A mirror project can contain unique commits. Never destroy, hide, or force
# overwrite those commits. Fetch its exact remote master head before pushing.
if git remote get-url xdrive-gitlab-mirror >/dev/null 2>&1; then
  echo "[xDrive] temporary GitLab mirror remote name already exists; refusing to overwrite it" >&2
  exit 2
fi
git remote add xdrive-gitlab-mirror "$XDRIVE_GITLAB_MIRROR_URL"
added_remote=1
git -c credential.helper= fetch --quiet --no-tags xdrive-gitlab-mirror \
  +refs/heads/master:refs/remotes/xdrive-gitlab-mirror/master
mirror_sha="$(git rev-parse --verify refs/remotes/xdrive-gitlab-mirror/master)"
if ! git merge-base --is-ancestor "$mirror_sha" "$source_sha"; then
  echo "[xDrive] GitLab master is NOT an ancestor of reviewed GitHub master: GitLab=$mirror_sha GitHub=$source_sha; refusing non-FF push" >&2
  exit 1
fi

echo "[xDrive] verified GitLab master=$mirror_sha is ancestor of GitHub master=$source_sha"
if [[ "$mirror_sha" == "$source_sha" ]]; then
  echo '[xDrive] GitLab mirror already at the reviewed GitHub master SHA; nothing to push'
  exit 0
fi
if [[ "${XDRIVE_GITLAB_MIRROR_APPLY:-false}" != true ]]; then
  echo '[xDrive] DRY RUN: fast-forward is possible, but no remote branch was modified'
  exit 0
fi

# Confirm that the source did not change while we examined the mirror.
live_source="$(git -c credential.helper= ls-remote --exit-code origin refs/heads/master | awk '{print $1}')"
if [[ "$live_source" != "$source_sha" ]]; then
  echo "[xDrive] GitHub master advanced before push ($live_source); refusing stale sync" >&2
  exit 1
fi
# Plain push is non-force and will reject a competing update or divergence.
git -c credential.helper= push --porcelain xdrive-gitlab-mirror \
  "$source_sha:refs/heads/master"
remote_after="$(git -c credential.helper= ls-remote --exit-code xdrive-gitlab-mirror refs/heads/master | awk '{print $1}')"
if [[ "$remote_after" != "$source_sha" ]]; then
  echo "[xDrive] GitLab remote read-back mismatch: expected=$source_sha actual=$remote_after" >&2
  exit 1
fi
echo "[xDrive] GitLab master safely fast-forwarded and verified at $source_sha"
