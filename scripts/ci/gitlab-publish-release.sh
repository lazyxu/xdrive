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
  release_tag="snapshot-$short_sha"
  release_name="xDrive snapshot $short_sha"
  release_notes="Immutable successful master snapshot at $CI_COMMIT_SHA."
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
xdrive-server
docker-compose.yml
Caddyfile
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

glab release create "$release_tag" release/* \
  --ref "$CI_COMMIT_SHA" \
  --name "$release_name" \
  --notes "$release_notes" \
  --use-package-registry \
  --package-name xdrive-build-packages

echo "Published GitLab release $release_tag with Generic Package Registry assets."
