#!/usr/bin/env bash
set -euo pipefail

ROOT="${CI_PROJECT_DIR:-$PWD}"
cache="$ROOT/.cache/ci-tools/docker"
mkdir -p "$cache"

install_compose=true
if [[ "${1:-}" == "--docker-only" ]]; then
  install_compose=false
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "usage: install-docker-cli.sh [--docker-only]" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64) docker_arch="x86_64"; compose_arch="x86_64" ;;
  *) echo "unsupported GitLab Linux CI architecture: $(uname -m)" >&2; exit 1 ;;
esac

docker_version="${XDRIVE_CI_DOCKER_VERSION:?XDRIVE_CI_DOCKER_VERSION is required}"
docker_file="docker-${docker_version}.tgz"
docker_archive="$cache/$docker_file"
docker_mirror="${XDRIVE_CI_DOCKER_MIRROR:-https://mirrors.aliyun.com/docker-ce}"

if [[ -f "$docker_archive" ]] && ! tar -tzf "$docker_archive" >/dev/null 2>&1; then
  echo "[ci-docker] cached Docker archive is corrupt; redownloading" >&2
  rm -f "$docker_archive"
fi
if [[ ! -f "$docker_archive" ]]; then
  bash scripts/ci/download-with-fallback.sh "$docker_archive" \
    "${docker_mirror%/}/linux/static/stable/${docker_arch}/${docker_file}" \
    "https://download.docker.com/linux/static/stable/${docker_arch}/${docker_file}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$docker_archive" -C "$tmp"
install -m 0755 "$tmp/docker/docker" /usr/local/bin/docker

docker --version

if [[ "$install_compose" != true ]]; then
  exit 0
fi

compose_version="${XDRIVE_CI_COMPOSE_VERSION:?XDRIVE_CI_COMPOSE_VERSION is required}"
compose_cache="$cache/docker-compose-linux-${compose_arch}-${compose_version}"
compose_package_version="${XDRIVE_CI_COMPOSE_PACKAGE_VERSION:?XDRIVE_CI_COMPOSE_PACKAGE_VERSION is required}"
compose_package_file="docker-compose-plugin_${compose_package_version}_amd64.deb"
compose_package="$cache/$compose_package_file"

if [[ -f "$compose_cache" ]]; then
  chmod 0755 "$compose_cache"
  if ! "$compose_cache" version >/dev/null 2>&1; then
    echo "[ci-docker] cached Compose binary is invalid; redownloading" >&2
    rm -f "$compose_cache"
  fi
fi
if [[ ! -f "$compose_cache" ]]; then
  if [[ -f "$compose_package" ]] && ! dpkg-deb --info "$compose_package" >/dev/null 2>&1; then
    echo "[ci-docker] cached Compose package is corrupt; redownloading" >&2
    rm -f "$compose_package"
  fi
  if [[ ! -f "$compose_package" ]]; then
    compose_path="linux/debian/dists/bookworm/pool/stable/amd64/$compose_package_file"
    bash scripts/ci/download-with-fallback.sh "$compose_package" \
      "${docker_mirror%/}/$compose_path" \
      "https://mirrors.huaweicloud.com/docker-ce/$compose_path" \
      "https://download.docker.com/$compose_path"
  fi

  compose_root="$tmp/compose"
  mkdir -p "$compose_root"
  dpkg-deb -x "$compose_package" "$compose_root"
  compose_binary="$(find "$compose_root" -type f -name docker-compose -print -quit)"
  if [[ -z "$compose_binary" ]]; then
    echo "Compose package does not contain the docker-compose CLI plugin" >&2
    exit 1
  fi
  install -m 0755 "$compose_binary" "$compose_cache"
fi
install -d /usr/local/lib/docker/cli-plugins
install -m 0755 "$compose_cache" /usr/local/lib/docker/cli-plugins/docker-compose

docker compose version
