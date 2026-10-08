#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

source scripts/ci/build-metadata.sh

artifact_dir="${1:-dist/photo-face-image}"
final_image="xdrive/photo-face:test"
analyzer_dir="$ROOT/services/photo-face-analyzer"
runtime_cache_dir="${XDRIVE_PHOTO_FACE_RUNTIME_CACHE_DIR:-$ROOT/.cache/photo-face-runtime}"
runtime_contract_hash="$(bash scripts/ci/photo-face-runtime-cache-key.sh)"
runtime_image="xdrive/photo-face:test-runtime-$runtime_contract_hash"
runtime_contract_label="io.github.lazyxu.xdrive.photo-face.runtime-contract"
runtime_archive="$runtime_cache_dir/$runtime_contract_hash.tar.gz"
runtime_dependency_probe='import cv2; import numpy; import onnxruntime; import tokenizers'
mkdir -p "$runtime_cache_dir"

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
    --target runtime \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --build-arg "XDRIVE_RUNTIME_CONTRACT_HASH=$runtime_contract_hash" \
    -f services/photo-face-analyzer/Dockerfile \
    -t "$runtime_image" \
    services/photo-face-analyzer
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

runtime_mount="type=bind,src=$analyzer_dir,dst=/workspace,readonly"
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
docker build \
  --cache-from "$runtime_image" \
  --target final \
  --build-arg "XDRIVE_RUNTIME_CONTRACT_HASH=$runtime_contract_hash" \
  --build-arg "VERSION=$XDRIVE_BUILD_VERSION" \
  --build-arg "BUILD_COMMIT=$XDRIVE_BUILD_COMMIT" \
  -f services/photo-face-analyzer/Dockerfile \
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
