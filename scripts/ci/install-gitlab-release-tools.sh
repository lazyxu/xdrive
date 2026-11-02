#!/usr/bin/env sh
set -eu
# The official glab image is Alpine and does not contain Bash. Keep the
# existing exact-SPK verifier intact, including GNU SHA256 and XZ TAR checks.
# glab api emits JSON; parsing belongs to jq (glab has no --jq flag).
mirror="${1:-${XDRIVE_CI_ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}}"
series="${2:-$(cut -d. -f1,2 /etc/alpine-release)}"
printf '%s\n' "$mirror" | grep -Eq '^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._/-]+)?$' || {
  echo 'Release tool APK mirror must be an HTTPS repository base URL' >&2; exit 2
}
printf '%s\n' "$series" | grep -Eq '^3\.[0-9]+$' || exit 2
umask 077
repos="$(mktemp)"
trap 'rm -f "$repos"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
install_from() {
  printf '%s/v%s/main\n%s/v%s/community\n' "${1%/}" "$series" "${1%/}" "$series" > "$repos"
  # Preserve signature verification and the image's original repository file.
  apk --repositories-file "$repos" --timeout 20 --no-cache add bash coreutils tar xz jq
}
if install_from "$mirror"; then exit 0; fi
official=https://dl-cdn.alpinelinux.org/alpine
[ "${mirror%/}" != "$official" ] || exit 1
echo '[ci-apk] release tool mirror unavailable; retrying official signed repositories' >&2
install_from "$official"
