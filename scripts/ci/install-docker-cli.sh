#!/usr/bin/env bash
set -euo pipefail

ROOT="${CI_PROJECT_DIR:-$PWD}"
cache="$ROOT/.cache/ci-tools/docker"
mkdir -p "$cache"

case "$(uname -m)" in
  x86_64) docker_arch="x86_64"; compose_arch="x86_64" ;;
  *) echo "unsupported GitLab Linux CI architecture: $(uname -m)" >&2; exit 1 ;;
esac

docker_version="${XDRIVE_CI_DOCKER_VERSION:?XDRIVE_CI_DOCKER_VERSION is required}"
compose_version="${XDRIVE_CI_COMPOSE_VERSION:?XDRIVE_CI_COMPOSE_VERSION is required}"
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

install -d /usr/local/lib/docker/cli-plugins
compose_cache="$cache/docker-compose-linux-${compose_arch}-${compose_version}"
compose_url="https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-linux-${compose_arch}"
proxy_prefix="${XDRIVE_CI_GITHUB_RELEASE_PROXY:-}"
compose_sources=()
if [[ -n "$proxy_prefix" ]]; then
  compose_sources+=("${proxy_prefix%/}/$compose_url")
fi
compose_sources+=("$compose_url")

if [[ -f "$compose_cache" ]]; then
  chmod 0755 "$compose_cache"
  if ! "$compose_cache" version >/dev/null 2>&1; then
    echo "[ci-docker] cached Compose binary is invalid; redownloading" >&2
    rm -f "$compose_cache"
  fi
fi
if [[ ! -f "$compose_cache" ]]; then
  bash scripts/ci/download-with-fallback.sh "$compose_cache" "${compose_sources[@]}"
fi
install -m 0755 "$compose_cache" /usr/local/lib/docker/cli-plugins/docker-compose

docker --version
docker compose version
