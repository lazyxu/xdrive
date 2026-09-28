#!/bin/sh
set -eu

: "${CI_COMMIT_SHA:?CI_COMMIT_SHA is required}"
: "${CI_PROJECT_PATH:?CI_PROJECT_PATH is required}"

short_sha="$(printf '%s' "$CI_COMMIT_SHA" | cut -c1-12)"
if [ -n "${CI_COMMIT_TAG:-}" ]; then
  release_tag="$CI_COMMIT_TAG"
  release_name="xDrive $CI_COMMIT_TAG"
  release_notes="Formal xDrive release $CI_COMMIT_TAG built from $CI_COMMIT_SHA."
else
  release_tag="snapshot"
  release_name="xDrive snapshot $short_sha"
  release_notes="Rolling development snapshot from master at $CI_COMMIT_SHA. XDRIVE_RELEASE_COMMIT=$CI_COMMIT_SHA"
fi

files="
xdrive-linux-amd64.deb
xDriveSetup-amd64.exe
xdrive-source-agent-linux-amd64
xdrive-source-agent-linux-arm64
xdrive-server-install.sh
server-backup.sh
server-backup-scheduled.sh
server-restore.sh
server-verify.sh
server-doctor.sh
server-migrate-user.sh
xdrive-server
docker-compose.yml
xdrive.env.example
"

for name in $files; do
  if [ ! -f "release/$name" ]; then
    echo "release asset missing: release/$name" >&2
    exit 1
  fi
done

(
  cd release
  sha256sum $files > SHA256SUMS.txt
)

if find release -maxdepth 1 -type f \( -name '*.zip' -o -name '*.tar.gz' -o -name '*.tgz' \) | grep -q .; then
  echo "single-file installers/scripts must be published directly, not archive-wrapped" >&2
  exit 1
fi

unset GITLAB_TOKEN GITLAB_ACCESS_TOKEN OAUTH_TOKEN || true
export GLAB_ENABLE_CI_AUTOLOGIN=true

if [ "$release_tag" = "snapshot" ]; then
  # GitLab 17.x job tokens can manage releases but cannot mutate repository
  # tags. The release commit marker above is therefore the authoritative
  # rolling snapshot commit; the original snapshot tag is only its identity.
  glab api --method DELETE "projects/$CI_PROJECT_ID/releases/snapshot" >/dev/null 2>&1 || true

  legacy_tags="$(glab api --paginate "projects/$CI_PROJECT_ID/releases?per_page=100"     --jq '.[] | .tag_name' 2>/dev/null | grep -E '^snapshot-[0-9a-fA-F]{7,40}$' || true)"
  for legacy_tag in $legacy_tags; do
    glab api --method DELETE "projects/$CI_PROJECT_ID/releases/$legacy_tag" >/dev/null 2>&1 || true
  done

  package_ids="$(glab api --paginate "projects/$CI_PROJECT_ID/packages?package_type=generic&per_page=100"     --jq '.[] | select(.name == "xdrive-build-packages") | "\(.id)|\(.version)"' 2>/dev/null     | grep -E '\|snapshot(-[0-9a-fA-F]{7,40})?$'     | cut -d'|' -f1 || true)"
  for package_id in $package_ids; do
    glab api --method DELETE "projects/$CI_PROJECT_ID/packages/$package_id" >/dev/null 2>&1 || true
  done
fi

glab release create "$release_tag" release/* \
  --ref "$CI_COMMIT_SHA" \
  --name "$release_name" \
  --notes "$release_notes" \
  --use-package-registry \
  --package-name xdrive-build-packages

echo "Published GitLab release $release_tag with Generic Package Registry assets."
