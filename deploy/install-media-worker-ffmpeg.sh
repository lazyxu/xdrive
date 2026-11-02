#!/usr/bin/env sh
set -eu
mirror="${1:-https://dl-cdn.alpinelinux.org/alpine}"
series="${2:?Alpine major.minor series is required}"
printf '%s\n' "$mirror" | grep -Eq '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._/-]+)?$' || {
  echo 'FFmpeg APK mirror must be an HTTPS repository base URL' >&2; exit 2
}
printf '%s\n' "$series" | grep -Eq '^3\.[0-9]+$' || exit 2
umask 077
repos="$(mktemp)"
trap 'rm -f "$repos"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
install_from() {
  printf '%s/v%s/main\n%s/v%s/community\n' "${1%/}" "$series" "${1%/}" "$series" > "$repos"
  # Keep APK's normal repository/package signature checks. An isolated file
  # prevents an unreachable ambient CDN from delaying the mirror attempt.
  apk --repositories-file "$repos" --timeout 20 --no-cache add ffmpeg
}
if install_from "$mirror"; then exit 0; fi
official=https://dl-cdn.alpinelinux.org/alpine
[ "${mirror%/}" != "$official" ] || exit 1
echo '[ci-apk] mirror unavailable; retrying official signed Alpine repositories' >&2
install_from "$official"
