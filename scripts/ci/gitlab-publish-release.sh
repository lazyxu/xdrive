#!/bin/sh
set -eu

: "${CI_COMMIT_SHA:?CI_COMMIT_SHA is required}"
: "${CI_PROJECT_ID:?CI_PROJECT_ID is required}"
: "${CI_PROJECT_PATH:?CI_PROJECT_PATH is required}"
: "${CI_API_V4_URL:?CI_API_V4_URL is required}"
printf '%s' "$CI_COMMIT_SHA" | grep -Eq '^[a-f0-9]{40}$' || { echo "GitLab release requires a full commit SHA" >&2; exit 2; }

set -- \
  xdrive-linux-amd64.deb xDriveSetup-amd64.exe \
  xdrive-source-agent-linux-amd64 xdrive-source-agent-linux-arm64 \
  xdrive-backup-linux-amd64.tar.gz xdrive-backup-windows-amd64.zip \
  xdrive-server-install.sh server-backup.sh server-backup-scheduled.sh \
  server-restore.sh server-verify.sh server-doctor.sh server-migrate-user.sh \
  xdrive-server docker-compose.yml xdrive.env.example
for name in "$@"; do
  [ -s "release/$name" ] || { echo "missing release asset: $name" >&2; exit 1; }
done
( cd release; sha256sum "$@" > SHA256SUMS.txt )
set -- "$@" SHA256SUMS.txt
# Only the two source-exact, byte-verified Backup-only archives are allowed.
# Reject unrelated archives rather than disabling the release-asset whitelist.
for archive in release/*.zip release/*.tar.gz release/*.tgz; do
  [ -e "$archive" ] || continue
  case "$archive" in
    release/xdrive-backup-linux-amd64.tar.gz|release/xdrive-backup-windows-amd64.zip) ;;
    *) echo "unexpected GitLab release archive: $archive" >&2; exit 1 ;;
  esac
done

unset GITLAB_TOKEN GITLAB_ACCESS_TOKEN OAUTH_TOKEN || true
export GLAB_ENABLE_CI_AUTOLOGIN=true
short_sha="$(printf '%s' "$CI_COMMIT_SHA" | cut -c1-12)"
if [ -n "${CI_COMMIT_TAG:-}" ]; then
  # Stable v* tags remain immutable and require the separate full CI gate.
  printf '%s' "$CI_COMMIT_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$' || {
    echo "invalid stable release tag: $CI_COMMIT_TAG" >&2; exit 2;
  }
  glab release create "$CI_COMMIT_TAG" release/* \
    --ref "$CI_COMMIT_SHA" --no-update \
    --name "xDrive $CI_COMMIT_TAG" \
    --notes "Formal xDrive release $CI_COMMIT_TAG built from $CI_COMMIT_SHA." \
    --use-package-registry --package-name xdrive-build-packages
  echo "Published immutable GitLab stable release $CI_COMMIT_TAG."
  exit 0
fi
[ "${CI_COMMIT_BRANCH:-}" = master ] || { echo "rolling GitLab release requires master" >&2; exit 2; }

# Upload to an immutable per-commit package FIRST. Existing releases and their
# packages remain available when any upload, verification or promotion fails.
project_api="projects/$CI_PROJECT_ID"
package_name="xdrive-build-packages"
package_version="sha-$CI_COMMIT_SHA"
package_endpoint="$project_api/packages/generic/$package_name/$package_version"
release_endpoint="$project_api/releases/snapshot"
release_name="xDrive snapshot $short_sha"
release_notes="Rolling development snapshot from master at $CI_COMMIT_SHA. XDRIVE_RELEASE_COMMIT=$CI_COMMIT_SHA"

old_release_exists=0
old_description=""
if glab api "$release_endpoint" >/dev/null 2>&1; then
  old_release_exists=1
  old_description="$(glab api "$release_endpoint" --jq '.description')"
  old_commit="$(printf '%s' "$old_description" | grep -oE 'XDRIVE_RELEASE_COMMIT=[0-9a-fA-F]{40}' | head -n1 | cut -d= -f2 || true)"
  if [ -n "$old_commit" ]; then
    # GitLab's snapshot tag may be immovable with CI_JOB_TOKEN; the verified
    # description is the actual rolling identity. Never publish a stale runner.
    git merge-base --is-ancestor "$old_commit" "$CI_COMMIT_SHA" || {
      echo "refusing stale/divergent GitLab snapshot: published $old_commit, candidate $CI_COMMIT_SHA" >&2
      exit 1
    }
  fi
fi

# Query remote package file digests; never accept duplicate or changed files
# under a nominally immutable commit-version key (including retry attempts).
remote_package_id() {
  glab api "$project_api/packages?package_type=generic&package_name=$package_name&package_version=$package_version&per_page=100" \
    --jq ".[] | select(.name == \"$package_name\" and .version == \"$package_version\") | .id"
}
remote_package_files() {
  glab api "$project_api/packages/$1/package_files?per_page=100" \
    --jq '.[] | "\(.file_name)\t\(.file_sha256)"'
}
file_state() {
  local rows="$1" name="$2" digest="$3" count good
  count="$(printf '%s\n' "$rows" | awk -F '\t' -v n="$name" '$1==n {c++} END {print c+0}')"
  good="$(printf '%s\n' "$rows" | awk -F '\t' -v n="$name" -v h="$digest" '$1==n && $2==h {c++} END {print c+0}')"
  if [ "$count" = 0 ]; then printf 'missing\n'
  elif [ "$count" = 1 ] && [ "$good" = 1 ]; then printf 'verified\n'
  else printf 'invalid\n'; fi
}
package_id="$(remote_package_id)"
! [ -n "$package_id" ] || printf '%s' "$package_id" | grep -Eq '^[0-9]+$' || { echo "ambiguous GitLab package ID" >&2; exit 1; }
prior_rows=""
if [ -n "$package_id" ]; then prior_rows="$(remote_package_files "$package_id")"; fi
for name in "$@"; do
  digest="$(sha256sum "release/$name" | cut -d' ' -f1)"
  state="$(file_state "$prior_rows" "$name" "$digest")"
  case "$state" in
    verified) echo "[xDrive] reuse verified GitLab package file: $name" ;;
    invalid) echo "GitLab immutable package has duplicate or mismatched file: $name" >&2; exit 1 ;;
    missing)
      echo "[xDrive] stage GitLab package file: $name"
      glab api --method PUT --header 'Content-Type: application/octet-stream' \
        --input "release/$name" "$package_endpoint/$name" >/dev/null
      ;;
  esac
done

# GitLab's Packages API exposes the stored SHA-256. Verify *every* staged
# file before changing even one user-visible Release link or commit marker.
verified=0
for attempt in 1 2 3 4 5; do
  package_id="$(remote_package_id)"
  if printf '%s' "$package_id" | grep -Eq '^[0-9]+$'; then
    remote_rows="$(remote_package_files "$package_id")"
    verified=1
    for name in "$@"; do
      digest="$(sha256sum "release/$name" | cut -d' ' -f1)"
      state="$(file_state "$remote_rows" "$name" "$digest")"
      if [ "$state" = invalid ]; then
        echo "GitLab remote package digest mismatch or duplicate: $name; refusing promotion" >&2
        exit 1
      fi
      if [ "$state" != verified ]; then
        verified=0; break
      fi
    done
    [ "$verified" = 1 ] && break
  fi
  [ "$attempt" = 5 ] || sleep 2
done
[ "$verified" = 1 ] || { echo "GitLab remote package verification incomplete; snapshot unchanged" >&2; exit 1; }
echo "[xDrive] all 17 GitLab package files SHA-256 verified"

# Create the initial floating Release only after complete package verification.
# Subsequent runs keep the old Release and update each existing asset link.
if [ "$old_release_exists" = 0 ]; then
  glab release create snapshot --ref "$CI_COMMIT_SHA" \
    --name "$release_name (publishing)" --notes 'Publication pending: no verified snapshot commit yet.'
  old_description="$(glab api "$release_endpoint" --jq '.description')"
fi
if [ "$(glab api "$release_endpoint" --jq '.description')" != "$old_description" ]; then
  echo "GitLab snapshot changed during staging; refusing stale promotion" >&2
  exit 1
fi

# GitLab Release Links are updated individually (not an atomic API). Preserve
# old URLs and best-effort restore them if a link operation fails. Old packages
# are never deleted, so rollback still points at available bytes.
rollback_file="$(mktemp)"
committed=0
rollback_links() {
  [ -s "$rollback_file" ] || return 0
  while IFS="$(printf '\t')" read -r kind id old_url; do
    case "$kind" in
      restore) glab api --method PUT "$release_endpoint/assets/links/$id" -f "url=$old_url" >/dev/null 2>&1 || true ;;
      delete) glab api --method DELETE "$release_endpoint/assets/links/$id" >/dev/null 2>&1 || true ;;
    esac
  done < "$rollback_file"
}
on_exit() {
  local rc=$?
  trap - 0
  if [ "$committed" != 1 ] && [ "$rc" -ne 0 ]; then
    rollback_links
  fi
  rm -f "$rollback_file"
  exit "$rc"
}
trap on_exit 0

existing_links="$(glab api "$release_endpoint/assets/links" --jq '.[] | "\(.name)\t\(.id)\t\(.url)"')"
for name in "$@"; do
  url="${CI_API_V4_URL%/}/$package_endpoint/$name"
  links="$(printf '%s\n' "$existing_links" | awk -F '\t' -v n="$name" '$1==n {print $0}')"
  link_count="$(printf '%s\n' "$links" | awk 'NF {n++} END {print n+0}')"
  if [ "$link_count" -gt 1 ]; then
    echo "duplicate GitLab Release links for $name; refusing promotion" >&2; exit 1
  fi
  if [ "$link_count" = 1 ]; then
    link_id="$(printf '%s\n' "$links" | awk -F '\t' '{print $2}')"
    old_url="$(printf '%s\n' "$links" | awk -F '\t' '{print $3}')"
    printf '%s' "$link_id" | grep -Eq '^[0-9]+$' && { case "$old_url" in http://*|https://*) true ;; *) false ;; esac; } || { echo "invalid old release link" >&2; exit 1; }
    if [ "$old_url" != "$url" ]; then
      # Record rollback BEFORE altering the existing link; the restore remains
      # safe if GitLab rejects the update after the request is sent.
      printf 'restore\t%s\t%s\n' "$link_id" "$old_url" >> "$rollback_file"
      glab api --method PUT "$release_endpoint/assets/links/$link_id" -f "url=$url" >/dev/null
    fi
  else
    link_id="$(glab api --method POST "$release_endpoint/assets/links" -f "name=$name" \
      -f "url=$url" -f 'link_type=package' --jq '.id')"
    printf '%s' "$link_id" | grep -Eq '^[0-9]+$' || { echo "could not confirm new GitLab Release link" >&2; exit 1; }
    printf 'delete\t%s\t-\n' "$link_id" >> "$rollback_file"
  fi
done

active_links="$(glab api "$release_endpoint/assets/links" --jq '.[] | "\(.name)\t\(.id)\t\(.url)"')"
for name in "$@"; do
  expected_url="${CI_API_V4_URL%/}/$package_endpoint/$name"
  count="$(printf '%s\n' "$active_links" | awk -F '\t' -v n="$name" -v u="$expected_url" '$1==n && $3==u {c++} END {print c+0}')"
  [ "$count" = 1 ] || { echo "GitLab Release link verification failed: $name" >&2; exit 1; }
done
if [ "$(glab api "$release_endpoint" --jq '.description')" != "$old_description" ]; then
  echo "GitLab Release changed during link update; refusing promotion" >&2
  exit 1
fi
# Publish the verified commit marker LAST, after all Package SHA-256s and URLs.
glab api --method PUT "$release_endpoint" -f "name=$release_name" -f "description=$release_notes" >/dev/null
committed=1
[ "$(glab api "$release_endpoint" --jq '.description')" = "$release_notes" ] || {
  echo "GitLab Release commit-marker read-back disagrees; inspect publication" >&2
  exit 1
}
echo "Published GitLab snapshot $CI_COMMIT_SHA (verified assets, release links, commit marker)."
