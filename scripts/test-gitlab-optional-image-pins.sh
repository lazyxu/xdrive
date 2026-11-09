#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installer="$ROOT/deploy/install-server.sh"

# Exercise the REAL installer function in isolation without Docker, credentials
# or mutating a user's deployment. Keep every call fail-closed.
function_body="$(sed -n '/^retain_gitlab_optional_image() {/,/^}/p' "$installer")"
[[ "$function_body" == *'retain_gitlab_optional_image() {'* ]] || {
  echo 'missing real GitLab optional-image selection function' >&2; exit 1
}
eval "$function_body"
compose_profile_enabled() {
  case "$1" in
    photo-intelligence) [[ "${MOCK_PHOTO_PROFILE:-0}" == 1 ]] ;;
    media-worker) [[ "${MOCK_MEDIA_PROFILE:-0}" == 1 ]] ;;
    *) return 1 ;;
  esac
}
export MOCK_PHOTO_PROFILE=1 MOCK_MEDIA_PROFILE=1
existing_env_value() { [[ "$1" == "XD_PHOTO_FACE_IMAGE" || "$1" == "XD_MEDIA_WORKER_IMAGE" ]] || exit 2; printf '%s\n' "${MOCK_EXISTING:-}"; }

requested_source=gitlab
requested_channel=master
UPGRADE_EXISTING=1
OFFLINE_ASSET_DIR=""
target="registry.example.invalid/xdrive/xdrive-photo-face:sha-aaaaaaaaaaaa"
old="registry.example.invalid/xdrive/xdrive-photo-face:sha-bbbbbbbbbbbb"
MOCK_EXISTING="$old"
[[ "$(retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence)" == "$old" ]] || {
  echo 'GitLab master must retain existing independently built optional image' >&2; exit 1;
}
MOCK_EXISTING="registry.example.invalid/xdrive/xdrive-photo-face@sha256:$(printf '%064d' 2)"
[[ "$(retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence)" == "$MOCK_EXISTING" ]] || {
  echo 'immutable digest optional-image pin not retained' >&2; exit 1;
}

MOCK_EXISTING="$old"
for scenario in source channel upgrade offline; do
  requested_source=gitlab
  requested_channel=master
  UPGRADE_EXISTING=1
  OFFLINE_ASSET_DIR=""
  case "$scenario" in
    source) requested_source=github ;;
    channel) requested_channel=stable ;;
    upgrade) UPGRADE_EXISTING=0 ;;
    offline) OFFLINE_ASSET_DIR="/tmp/fixture" ;;
  esac
  [[ "$(retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence)" == "$target" ]] || {
    echo "optional image changed outside GitLab master upgrades: $scenario" >&2; exit 1
  }
done

requested_source=gitlab
requested_channel=master
UPGRADE_EXISTING=1
OFFLINE_ASSET_DIR=""
MOCK_EXISTING=""
[[ "$(retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence)" == "$target" ]] || {
  echo 'fresh installs must not silently substitute a different-Commit optional image' >&2; exit 1
}

MOCK_EXISTING="registry.example.invalid/xdrive/xdrive-photo-face:edge"
if retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence > /dev/null 2>&1; then
  echo 'mutable image alias was not rejected' >&2; exit 1
fi
MOCK_EXISTING="registry.example.invalid/xdrive/xdrive-photo-face:sha-broken"
if retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence > /dev/null 2>&1; then
  echo 'malformed immutable tag was not rejected' >&2; exit 1
fi
MOCK_EXISTING="registry.example.invalid/xdrive/xdrive-photo-face@sha256:wrong"
if retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence > /dev/null 2>&1; then
  echo 'malformed digest was not rejected' >&2; exit 1
fi
MOCK_EXISTING="registry.example.invalid/image:sha-bbbbbbbbbbbb user:latest"
if retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence > /dev/null 2>&1; then
  echo 'unsafe whitespace in image reference was not rejected' >&2; exit 1
fi

# Disabled optional profiles must NEVER block a core upgrade merely because
# a previous install recorded an old mutable :latest reference.
MOCK_PHOTO_PROFILE=0
MOCK_EXISTING="ghcr.io/lazyxu/xdrive-photo-face:latest"
[[ "$(retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence)" == "$target" ]] || {
  echo 'disabled Photo Face profile must not block GitLab Server/Caddy upgrades' >&2; exit 1
}
MOCK_PHOTO_PROFILE=1

# An active optional profile must still reject the same mutable image.
if retain_gitlab_optional_image XD_PHOTO_FACE_IMAGE "$target" photo-intelligence > /dev/null 2>&1; then
  echo 'active Photo Face profile accepted a mutable legacy image' >&2; exit 1
fi

# Media Worker uses exactly the same protection.
MOCK_EXISTING="registry.example.invalid/xdrive/xdrive-media-worker:sha-cccccccccccc"
media_target="registry.example.invalid/xdrive/xdrive-media-worker:sha-aaaaaaaaaaaa"
[[ "$(retain_gitlab_optional_image XD_MEDIA_WORKER_IMAGE "$media_target" media-worker)" == "$MOCK_EXISTING" ]] || {
  echo 'Media Worker image pin not retained' >&2; exit 1
}

MOCK_MEDIA_PROFILE=0
MOCK_EXISTING="ghcr.io/lazyxu/xdrive-media-worker:latest"
[[ "$(retain_gitlab_optional_image XD_MEDIA_WORKER_IMAGE "$media_target" media-worker)" == "$media_target" ]] || {
  echo 'disabled Media Worker profile must not block GitLab core upgrades' >&2; exit 1
}
MOCK_MEDIA_PROFILE=1
if retain_gitlab_optional_image XD_MEDIA_WORKER_IMAGE "$media_target" media-worker > /dev/null 2>&1; then
  echo 'active Media Worker profile accepted a mutable legacy image' >&2; exit 1
fi

echo 'GitLab optional image upgrade protection: inactive profiles, immutable retention, exact core selection and fail-closed alias checks passed'
