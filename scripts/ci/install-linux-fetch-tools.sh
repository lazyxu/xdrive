#!/usr/bin/env bash
set -euo pipefail

# CI's Debian Bookworm images need XZ for both Node and DSM package.tgz.
# Use signed HTTPS Debian mirrors without changing the container's sources;
# an unavailable mirror or package falls back to the original APT settings.
# Optional package arguments (e.g. postgresql-client) use the same policy.
extra_packages=("$@")
source /etc/os-release
[[ "$ID" == debian && "$VERSION_CODENAME" == bookworm ]] || {
  echo 'Linux CI fetch tools require the configured Debian Bookworm image' >&2
  exit 1
}
umask 077
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/sources.list" <<'SOURCES'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://mirrors.huaweicloud.com/debian bookworm main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://mirrors.huaweicloud.com/debian bookworm-updates main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://mirrors.huaweicloud.com/debian-security bookworm-security main
SOURCES
export DEBIAN_FRONTEND=noninteractive
options=(-o Acquire::Retries=2 -o Acquire::http::Timeout=20
  -o Acquire::https::Timeout=20 -o APT::Update::Error-Mode=any)
install_tools() {
  apt-get "${options[@]}" "$@" update &&
    apt-get "${options[@]}" "$@" install -y --no-install-recommends ca-certificates curl jq xz-utils "${extra_packages[@]}"
}
if install_tools -o "Dir::Etc::sourcelist=$tmp/sources.list" -o Dir::Etc::sourceparts=-; then
  exit 0
fi
echo '[ci-apt] mirror failed; retrying original signed APT repositories' >&2
install_tools
