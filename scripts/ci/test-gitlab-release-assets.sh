#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

# Run the real release generator in an isolated checkout-shaped directory.
# Never modify the caller's release directory or use real provider credentials.
sources=(
  scripts/ci/gitlab-release-assets.sh
  scripts/ci/gitlab-release-version.sh
  deploy/install-server.sh
  deploy/docker-compose.yml
  deploy/.env.example
  scripts/server-backup.sh
  scripts/server-backup-scheduled.sh
  scripts/server-restore.sh
  scripts/server-verify.sh
  scripts/server-doctor.sh
  scripts/server-migrate-user.sh
  scripts/server-control.sh
  scripts/caddy-env-config.py
  scripts/caddy-admission.py
  scripts/xdrive-server-host.sh
)
for source in "${sources[@]}"; do
  mkdir -p "$fixture/$(dirname "$source")"
  cp "$ROOT/$source" "$fixture/$source"
done

mkdir -p "$fixture/release/source-agent"
for arch in amd64 arm64; do
  printf '#!/bin/sh\nexit 0\n' > "$fixture/release/source-agent/xdrive-source-agent-linux-$arch"
done

sha="0123456789abcdef0123456789abcdef01234567"
(
  cd "$fixture"
  env CI_COMMIT_SHA="$sha" CI_COMMIT_BRANCH=master CI_COMMIT_TAG= CI_REGISTRY_IMAGE="registry.example.test/xuliang/xdrive" bash scripts/ci/gitlab-release-assets.sh
)
installer="$fixture/release/xdrive-server-install.sh"
test -s "$installer"
bash -n "$installer"
grep -Fq 'BUILT_SOURCE="${XD_BUILT_SOURCE:-gitlab}"' "$installer"
grep -Fq 'BUILT_CHANNEL="${XD_BUILT_CHANNEL:-master}"' "$installer"

encoded="$(sed -n 's/^EMBEDDED_DEPLOY_ASSET_MANIFEST_B64="\([^"]*\)"$/\1/p' "$installer")"
[[ -n "$encoded" && "$encoded" != '@DEPLOY_ASSET_MANIFEST_B64@' ]] || {
  echo "GitLab installer missing embedded hashes" >&2
  exit 1
}
printf '%s' "$encoded" | base64 --decode > "$fixture/embedded.sha256"

expected="$fixture/expected.sha256"
(
  cd "$fixture"
  sha256sum \
    deploy/docker-compose.yml \
    scripts/server-backup.sh \
    scripts/server-backup-scheduled.sh \
    scripts/server-restore.sh \
    scripts/server-verify.sh \
    scripts/server-doctor.sh \
    scripts/server-migrate-user.sh \
    scripts/server-control.sh \
    scripts/caddy-env-config.py \
    scripts/caddy-admission.py \
    scripts/xdrive-server-host.sh > "$expected"
  sha256sum --check --status "$fixture/embedded.sha256"
)
cmp -s "$fixture/embedded.sha256" "$expected" || {
  echo "GitLab embedded hashes differ from exact source assets" >&2
  exit 1
}

printf '\n# tamper\n' >> "$fixture/scripts/server-control.sh"
if (cd "$fixture"; sha256sum --check --status "$fixture/embedded.sha256"); then
  echo "Tampered GitLab deployment asset unexpectedly passed verification" >&2
  exit 1
fi
echo "GitLab release installer SHA-256 and tamper rejection passed"
