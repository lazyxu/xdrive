#!/usr/bin/env bash
# Turn one exact, already-built CI run into five reusable offline packages.
# All image archives are exported from validated image IDs; no application
# binaries are rebuilt. Only the independent model-free AI runtime is built.
set -euo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  echo "usage: $0 ARTIFACTS_DIR OUTPUT_DIR" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ARTIFACTS="$(realpath "$1")"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
: "${XDRIVE_OFFLINE_COMMIT:?full SHA of exact CI run is required}"
: "${XDRIVE_OFFLINE_CHANNEL:=master}"
: "${XDRIVE_OFFLINE_SOURCE:=github}"
[[ "$XDRIVE_OFFLINE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid offline commit" >&2; exit 2; }
[[ "$XDRIVE_OFFLINE_CHANNEL" == master || "$XDRIVE_OFFLINE_CHANNEL" == stable ]] || exit 2
[[ "$XDRIVE_OFFLINE_SOURCE" == github || "$XDRIVE_OFFLINE_SOURCE" == gitlab ]] || exit 2
command -v docker >/dev/null
command -v python3 >/dev/null
command -v gzip >/dev/null
command -v sha256sum >/dev/null

SHORT="${XDRIVE_OFFLINE_COMMIT:0:12}"
REGISTRY="${XDRIVE_OFFLINE_REGISTRY:-ghcr.io/lazyxu}"
APP_TAG="${XDRIVE_OFFLINE_APP_TAG:-sha-$SHORT}"
POSTGRES_REF="${XDRIVE_OFFLINE_POSTGRES_REF:-postgres:17-alpine}"
[[ "$REGISTRY" =~ ^[a-z0-9._/-]+$ ]] || { echo "invalid registry" >&2; exit 2; }
[[ "$APP_TAG" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 2
[[ "$POSTGRES_REF" =~ ^[a-z0-9._/-]+:[a-zA-Z0-9_.-]+$ ]] || exit 2

work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/xdrive-offline.XXXXXX")"
photo_id=""
cleanup() {
  [[ -z "$photo_id" ]] || docker rm -f "$photo_id" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT INT TERM
prepared="$work/prepared"
mkdir -p "$prepared"/{app/images,app/assets/deploy,app/assets/scripts,postgres/images,media-worker/images,ai-runtime/images,ai-models/models,ai-models/licenses}

load_ci_image() {
  local archive_dir="$1" local_ref="$2" exact_id
  test -s "$ARTIFACTS/$archive_dir/image.tar.gz"
  test -s "$ARTIFACTS/$archive_dir/image.id"
  exact_id="$(cat "$ARTIFACTS/$archive_dir/image.id")"
  [[ "$exact_id" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "bad CI image ID" >&2; exit 1; }
  gzip -t "$ARTIFACTS/$archive_dir/image.tar.gz"
  docker load -i "$ARTIFACTS/$archive_dir/image.tar.gz" >/dev/null
  test "$(docker image inspect --format '{{.Id}}' "$local_ref")" = "$exact_id" || {
    echo "CI image ID mismatch: $local_ref" >&2; exit 1;
  }
}

archive_image() {
  local ref="$1" target="$2"
  docker image inspect "$ref" >/dev/null
  docker save "$ref" | gzip -1 > "$target"
  gzip -t "$target"
}

load_ci_image server-image xdrive/server:test
load_ci_image caddy-image xdrive/caddy:test
load_ci_image media-worker-image xdrive/media-worker:test
load_ci_image photo-face-image xdrive/photo-face:test

SERVER_REF="$REGISTRY/xdrive-server:$APP_TAG"
CADDY_REF="$REGISTRY/xdrive-caddy:$APP_TAG"
MEDIA_REF="$REGISTRY/xdrive-media-worker:$APP_TAG"
docker tag xdrive/server:test "$SERVER_REF"
docker tag xdrive/caddy:test "$CADDY_REF"
docker tag xdrive/media-worker:test "$MEDIA_REF"
archive_image "$SERVER_REF" "$prepared/app/images/server.tar.gz"
archive_image "$CADDY_REF" "$prepared/app/images/caddy.tar.gz"
archive_image "$MEDIA_REF" "$prepared/media-worker/images/media-worker.tar.gz"

# The default Postgres image is one shared dependency, not three copies for
# storage-init/server/worker. Pin its concrete local image ID in the manifest.
docker pull --platform linux/amd64 "$POSTGRES_REF"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$POSTGRES_REF")" = linux/amd64
archive_image "$POSTGRES_REF" "$prepared/postgres/images/postgres.tar.gz"

# Extract model data from the exact CI-validated, existing full image. Never
# re-download model weights from Hugging Face during release packaging.
photo_id="$(docker create xdrive/photo-face:test)"
docker cp "$photo_id:/models/." "$prepared/ai-models/models/"
docker cp "$photo_id:/licenses/." "$prepared/ai-models/licenses/"
python3 services/photo-face-analyzer/fetch_models.py \
  "$prepared/ai-models/models" "$prepared/ai-models/licenses" --verify-only
docker rm "$photo_id" >/dev/null
photo_id=""

# Build model-free Python/OpenCV/ONNX runtime once per input contract. Models
# live exclusively in the fifth package and are layered back with --network none.
RUNTIME_CONTRACT="$(sha256sum services/photo-face-analyzer/Dockerfile \
    services/photo-face-analyzer/requirements.txt \
    services/photo-face-analyzer/analyzer.py \
    services/photo-face-analyzer/creative.py | sha256sum | cut -c1-16)"
RUNTIME_REF="xdrive/offline-ai-runtime:$RUNTIME_CONTRACT"
docker build --target offline-runtime \
  --build-arg "XDRIVE_RUNTIME_VERSION=$RUNTIME_CONTRACT" \
  -f services/photo-face-analyzer/Dockerfile \
  -t "$RUNTIME_REF" services/photo-face-analyzer
archive_image "$RUNTIME_REF" "$prepared/ai-runtime/images/ai-runtime.tar.gz"

# Use the release-rendered, checksum-bound installer, not the unrendered raw
# master bootstrap. Raw deployment assets are from the EXACT CI commit.
test -s "$ARTIFACTS/server-deploy/xdrive-server-install.sh"
if grep -q '@DEPLOY_ASSET_MANIFEST_B64@' "$ARTIFACTS/server-deploy/xdrive-server-install.sh"; then
  echo "refusing unrendered installer" >&2
  exit 1
fi
cp "$ARTIFACTS/server-deploy/xdrive-server-install.sh" "$prepared/app/assets/xdrive-server-install.sh"
cp deploy/docker-compose.yml "$prepared/app/assets/deploy/docker-compose.yml"
for file in \
  server-backup.sh server-backup-scheduled.sh server-restore.sh \
  server-verify.sh server-doctor.sh server-migrate-user.sh \
  server-control.sh caddy-env-config.py caddy-admission.py xdrive-server-host.sh; do
  cp "scripts/$file" "$prepared/app/assets/scripts/$file"
done
bash -n "$prepared/app/assets/xdrive-server-install.sh"

SERVER_REF="$SERVER_REF" CADDY_REF="$CADDY_REF" \
POSTGRES_REF="$POSTGRES_REF" MEDIA_REF="$MEDIA_REF" RUNTIME_REF="$RUNTIME_REF" \
python3 - "$prepared/images.json" <<'PY'
import json, os, subprocess, sys
names = {
    "server": os.environ["SERVER_REF"],
    "caddy": os.environ["CADDY_REF"],
    "postgres": os.environ["POSTGRES_REF"],
    "media-worker": os.environ["MEDIA_REF"],
    "ai-runtime": os.environ["RUNTIME_REF"],
}
def image_id(ref):
    return subprocess.check_output(
        ["docker", "image", "inspect", "--format", "{{.Id}}", ref],
        text=True,
    ).strip()
data = {key: {"ref": ref, "id": image_id(ref)} for key, ref in names.items()}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(data, handle, sort_keys=True)
PY

python3 scripts/offline/xdrive_offline.py build \
  --prepared "$prepared" --output "$OUT" \
  --commit "$XDRIVE_OFFLINE_COMMIT" \
  --channel "$XDRIVE_OFFLINE_CHANNEL" \
  --source "$XDRIVE_OFFLINE_SOURCE"

digest="$(sha256sum "$OUT/manifest.json" | cut -d' ' -f1)"
python3 scripts/offline/xdrive_offline.py verify --dir "$OUT" \
  --trusted-manifest-sha256 "$digest"
printf '%s\n' "$digest" > "$OUT/MANIFEST_SHA256.txt"
echo "[offline] five packages verified; publish manifest digest via authenticated release metadata"
