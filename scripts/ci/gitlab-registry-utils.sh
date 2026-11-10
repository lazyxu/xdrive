#!/usr/bin/env bash
# Shared fail-closed registry helpers. Source from Bash scripts, not sh.
set -euo pipefail

xdrive_registry_login() {
  : "${CI_REGISTRY:?GitLab Container Registry must be enabled}"
  : "${CI_REGISTRY_IMAGE:?CI_REGISTRY_IMAGE must be set}"
  : "${CI_REGISTRY_USER:?CI_REGISTRY_USER must be set}"
  : "${CI_REGISTRY_PASSWORD:?CI_REGISTRY_PASSWORD must be set}"
  printf '%s' "$CI_REGISTRY_PASSWORD" |
    docker login "$CI_REGISTRY" --username "$CI_REGISTRY_USER" --password-stdin
}

# Return 0=exists, 10=authoritatively missing manifest, 1=unknown failure.
# Never treat authentication, DNS, timeouts or registry 5xx as an absent tag.
xdrive_pull_or_absent() {
  local ref="${1:?image reference required}" error
  error="$(mktemp)"
  if docker pull "$ref" >/dev/null 2>"$error"; then
    rm -f "$error"
    return 0
  fi
  # The containerd image store reports a missing manifest differently. Match
  # the complete diagnostic and both exact references, never generic "not found"
  # (which can also describe a missing credential helper, blob or proxy route).
  if [[ "$(cat "$error")" == "Error response from daemon: failed to resolve reference \"$ref\": $ref: not found" ]] ||
     grep -Eiq 'manifest unknown|manifest for .+ not found|manifest does not exist|unknown manifest' "$error"; then
    rm -f "$error"
    return 10
  fi
  cat "$error" >&2
  echo "[xDrive] registry state unknown for $ref; refusing to mutate a tag" >&2
  rm -f "$error"
  return 1
}

xdrive_assert_image_identity() {
  local ref="${1:?image reference required}" expected_version="${2:?version required}"
  local expected_commit="${3:?commit required}" version revision
  [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid expected commit" >&2; return 1; }
  version="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$ref")"
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$ref")"
  [[ "$version" == "$expected_version" && "$revision" == "$expected_commit" ]] || {
    echo "[xDrive] image identity mismatch: $ref version=$version revision=$revision expected=$expected_version/$expected_commit" >&2
    return 1
  }
}

# A remote mutable tag can be moved only to a descendant (or same Commit).
# Caddy images predating the introduction of the revision label are allowed
# ONCE only if the matching Server edge was already verified in this pass.
xdrive_assert_promotion_ancestry() {
  local name="${1:?image name required}" candidate="${2:?commit required}"
  local tag="${3:?remote mutable tag required}" status=0 revision
  if xdrive_pull_or_absent "$tag"; then
    revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$tag")"
    if [[ "$revision" == "<no value>" || -z "$revision" ]]; then
      if [[ "$name" == "xdrive-caddy" && "${XDRIVE_VERIFIED_SERVER_EDGE:-0}" == 1 ]]; then
        echo "[xDrive] upgrading pre-revision Caddy edge under verified Server edge ancestry" >&2
        return 0
      fi
      echo "[xDrive] remote $name tag has no verified commit label; refusing promotion" >&2
      return 1
    fi
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || {
      echo "[xDrive] invalid remote revision label: $revision" >&2; return 1;
    }
    if ! git cat-file -e "$revision^{commit}" 2>/dev/null ||
       ! git merge-base --is-ancestor "$revision" "$candidate"; then
      echo "[xDrive] stale/divergent promotion refused: $name remote=$revision candidate=$candidate" >&2
      return 1
    fi
    if [[ "$name" == "xdrive-server" ]]; then
      XDRIVE_VERIFIED_SERVER_EDGE=1
    fi
    return 0
  else
    status=$?
    [[ "$status" == 10 ]] || return 1
    return 0
  fi
}
