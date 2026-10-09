#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source scripts/ci/build-metadata.sh

artifact_dir="${1:-dist/photo-face-image}"
final_image="xdrive/photo-face:test"
analyzer_dir="$ROOT/services/photo-face-analyzer"
runtime_cache_dir="${XDRIVE_PHOTO_FACE_RUNTIME_CACHE_DIR:-$ROOT/.cache/photo-face-runtime}"
model_cache_dir="${XDRIVE_PHOTO_FACE_MODEL_CACHE_DIR:-$ROOT/.cache/photo-face-models}"
runtime_contract_hash="$(bash scripts/ci/photo-face-runtime-cache-key.sh)"
runtime_image="xdrive/photo-face:test-runtime-$runtime_contract_hash"
dependencies_image="xdrive/photo-face:test-dependencies-$runtime_contract_hash"
runtime_contract_label="io.github.lazyxu.xdrive.photo-face.runtime-contract"
runtime_archive="$runtime_cache_dir/$runtime_contract_hash.tar.gz"
runtime_dependency_probe='import cv2; import numpy; import onnxruntime; import tokenizers'
runtime_mount="type=bind,src=$analyzer_dir,dst=/workspace,readonly"
mkdir -p "$runtime_cache_dir"

# Forward only configured values by name. Docker's own proxy configuration still
# applies when the CI job has no override, and proxy credentials stay out of logs.
download_env=()
proxy_build_args=()
for name in HF_ENDPOINT XDRIVE_MODEL_DOWNLOAD_ATTEMPTS XDRIVE_MODEL_DOWNLOAD_TIMEOUT XDRIVE_MODEL_DOWNLOAD_SOURCE_MAX_SECONDS HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy; do
  if [[ -v "$name" ]]; then
    download_env+=(--env "$name")
  fi
done
for name in HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy; do
  if [[ -v "$name" ]]; then
    proxy_build_args+=(--build-arg "$name")
  fi
done

runtime_image_valid() {
  docker image inspect "$runtime_image" >/dev/null 2>&1 || return 1

  local actual_hash
  actual_hash="$(docker image inspect --format "{{ index .Config.Labels \"$runtime_contract_label\" }}" "$runtime_image" 2>/dev/null || true)"
  if [[ "$actual_hash" != "$runtime_contract_hash" ]]; then
    echo "[photo-face] runtime image contract mismatch: image=$runtime_image got=${actual_hash:-<missing>} want=$runtime_contract_hash" >&2
    return 1
  fi

  if ! docker run --rm "$runtime_image" python -c "$runtime_dependency_probe" >/dev/null 2>&1; then
    echo "[photo-face] runtime image dependency probe failed: $runtime_image" >&2
    return 1
  fi
}

# The runtime image contains only stable interpreter/native/dependency/model
# inputs. Current xDrive business code and tests are mounted read-only below.
if [[ -f "$runtime_archive" ]]; then
  # Validate the archive itself, not a same-tag image left behind in a persistent
  # Runner Docker daemon from an earlier job.
  docker image rm -f "$runtime_image" >/dev/null 2>&1 || true
  if gzip -t "$runtime_archive" && gzip -dc "$runtime_archive" | docker load >/dev/null; then
    if runtime_image_valid; then
      echo "[photo-face] restored reusable runtime image $runtime_image ($runtime_contract_hash)"
    else
      echo "[photo-face] cached runtime image does not match its archive key; rebuilding only $runtime_archive" >&2
      rm -f "$runtime_archive"
    fi
  else
    echo "[photo-face] cached runtime archive is invalid; rebuilding only $runtime_archive" >&2
    rm -f "$runtime_archive"
  fi
fi

if ! runtime_image_valid; then
  docker image rm -f "$runtime_image" >/dev/null 2>&1 || true
  echo "[photo-face] building reusable runtime image $runtime_image ($runtime_contract_hash)"
  docker build \
    "${proxy_build_args[@]}" \
    --target dependencies \
    -f services/photo-face-analyzer/Dockerfile \
    -t "$dependencies_image" \
    services/photo-face-analyzer

  # Downloads run outside docker build so a failed transfer remains in the
  # workspace cache, including when a later job starts with a fresh daemon.
  mkdir -p "$model_cache_dir/models" "$model_cache_dir/licenses"
  model_cache_dir="$(cd "$model_cache_dir" && pwd)"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'model_cache_attempted=true\n' >>"$GITHUB_OUTPUT"
  fi
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    "${download_env[@]}" \
    --mount "$runtime_mount" \
    --mount "type=bind,src=$model_cache_dir,dst=/model-cache" \
    "$dependencies_image" \
    python /workspace/fetch_models.py /model-cache/models /model-cache/licenses

  # Stream completed inputs directly to Docker without a second host-side copy.
  # Verification runs with networking disabled before the runtime is accepted.
  tar --exclude='*.part*' --exclude='*.tmp' \
    -C "$model_cache_dir" -cf - models licenses \
    -C "$analyzer_dir" Dockerfile.cached fetch_models.py | \
    docker build \
    --network none \
    --target runtime \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --build-arg "XDRIVE_RUNTIME_CONTRACT_HASH=$runtime_contract_hash" \
    --build-arg "XDRIVE_RUNTIME_DEPENDENCIES_IMAGE=$dependencies_image" \
    -f Dockerfile.cached \
    -t "$runtime_image" \
    -
  runtime_image_valid || {
    echo "[photo-face] freshly built runtime image failed contract validation: $runtime_image" >&2
    exit 1
  }
fi

if [[ ! -f "$runtime_archive" ]]; then
  tmp_archive="$runtime_archive.tmp"
  rm -f "$tmp_archive"
  docker save "$runtime_image" | gzip -1 >"$tmp_archive"
  gzip -t "$tmp_archive"
  mv "$tmp_archive" "$runtime_archive"
fi

# GitLab uses a mutable cache namespace; retain only the current environment.
find "$runtime_cache_dir" -maxdepth 1 -type f -name '*.tar.gz' ! -name "$runtime_contract_hash.tar.gz" -delete

docker run --rm \
  --mount "$runtime_mount" \
  --workdir /workspace \
  "$runtime_image" \
  python -m unittest discover -s tests -v

docker run --rm \
  --mount "$runtime_mount" \
  --workdir /workspace \
  "$runtime_image" \
  python analyzer.py --self-test

docker run --rm \
  --mount "$runtime_mount" \
  --workdir /workspace \
  "$runtime_image" \
  python analyzer.py --benchmark --iterations 1

# The final image is the release artifact. Build and validate it separately so
# bind mounts never mask the packaged business code that will be published.
# Use the validated runtime directly: a hot runtime archive needs no raw model
# cache, and the final build cannot fall back to downloading models again.
final_dockerfile="$(mktemp)"
trap 'rm -f "$final_dockerfile"' EXIT
{
  printf 'FROM %s AS runtime\n' "$runtime_image"
  sed -n '/^FROM runtime AS final$/,$p' "$analyzer_dir/Dockerfile"
} >"$final_dockerfile"
docker build \
  --network none \
  --target final \
  --build-arg "VERSION=$XDRIVE_BUILD_VERSION" \
  --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT" \
  -f "$final_dockerfile" \
  -t "$final_image" \
  services/photo-face-analyzer

version_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$final_image")"
revision_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$final_image")"
[[ "$version_label" == "$XDRIVE_BUILD_VERSION" ]] || {
  echo "photo-face image version label mismatch: got $version_label want=$XDRIVE_BUILD_VERSION" >&2
  exit 1
}
[[ "$revision_label" == "$XDRIVE_BUILD_COMMIT" ]] || {
  echo "photo-face image revision label mismatch: got $revision_label want=$XDRIVE_BUILD_COMMIT" >&2
  exit 1
}

docker run --rm "$final_image" --self-test
docker run --rm "$final_image" --benchmark --iterations 1

rm -rf "$artifact_dir"
bash scripts/ci/export-docker-image.sh "$final_image" "$artifact_dir"
