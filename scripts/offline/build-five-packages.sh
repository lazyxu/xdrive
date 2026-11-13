#!/usr/bin/env bash
# Assemble ONLY changed offline modules, reuse exact immutable previous modules.
# The plan is derived from component inputs plus the Postgres image identity.
set -euo pipefail
umask 077

[[ $# -eq 2 ]] || { echo "usage: $0 ARTIFACTS_DIR OUTPUT_DIR" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p "$1"
ARTIFACTS="$(cd "$1" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
: "${XDRIVE_OFFLINE_COMMIT:?full commit SHA is required}"
: "${XDRIVE_OFFLINE_PLAN:?validated component plan JSON is required}"
: "${XDRIVE_OFFLINE_CHANNEL:=master}"
: "${XDRIVE_OFFLINE_SOURCE:=github}"
[[ "$XDRIVE_OFFLINE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$XDRIVE_OFFLINE_CHANNEL" == master || "$XDRIVE_OFFLINE_CHANNEL" == stable ]] || exit 2
[[ "$XDRIVE_OFFLINE_SOURCE" == github || "$XDRIVE_OFFLINE_SOURCE" == gitlab ]] || exit 2
command -v docker >/dev/null
command -v python3 >/dev/null
command -v gzip >/dev/null

SHORT="${XDRIVE_OFFLINE_COMMIT:0:12}"
REGISTRY="${XDRIVE_OFFLINE_REGISTRY:-ghcr.io/lazyxu}"
APP_TAG="sha-$SHORT"
POSTGRES_REF="${XDRIVE_OFFLINE_POSTGRES_REF:-postgres:17-alpine}"
[[ "$REGISTRY" =~ ^[a-z0-9._/-]+$ ]] || exit 2
[[ "$POSTGRES_REF" =~ ^[a-z0-9._/-]+:[a-zA-Z0-9_.-]+$ ]] || exit 2

changed_csv="$(python3 - "$XDRIVE_OFFLINE_PLAN" <<'PY'
import json,sys
p=json.load(open(sys.argv[1],encoding="utf-8"))
assert p["schema"]==1 and isinstance(p["changed"],list)
print(",".join(p["changed"]))
PY
)"
has_changed() { [[ ",$changed_csv," == *",$1,"* ]]; }
work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/xdrive-offline.XXXXXX")"
photo_id=""
cleanup() {
  [[ -z "$photo_id" ]] || docker rm -f "$photo_id" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
prepared="$work/prepared"
mkdir -p "$prepared"/{app/images,app/assets/deploy,app/assets/scripts,postgres/images,media-worker/images,ai-runtime/images,ai-models/models,ai-models/licenses}
previous="${XDRIVE_OFFLINE_PREVIOUS_MANIFEST:-}"
python3 - "$prepared/images.json" "$previous" <<'PY'
import json, pathlib,sys
data={}
if sys.argv[2]:
    previous=json.loads(pathlib.Path(sys.argv[2]).read_text("utf-8"))
    data=previous["images"]
pathlib.Path(sys.argv[1]).write_text(json.dumps(data,sort_keys=True), "utf-8")
PY

# Reuse the strict CI image importer on all Docker engines. Docker 29's
# containerd store can report an OCI index from image inspect .Id while the
# source artifact records its platform config digest. The canonical importer
# checks the actual loaded tag's config bytes when the two IDs differ.
load_ci_image() {
  local archive_dir="$1" local_ref="$2"
  bash scripts/ci/import-docker-image.sh "$ARTIFACTS/$archive_dir" "$local_ref" >/dev/null
}

# The signed offline manifest must name the image identity IN the archive,
# not the Docker daemon's OCI index ID. Export each re-tagged reference with
# the same validated CI exporter, keeping the ID sidecar outside the package.
archive_image() {
  local key="$1" ref="$2" target="$3"
  local export_dir="$work/exports/$key"
  mkdir -p "$export_dir"
  bash scripts/ci/export-docker-image.sh "$ref" "$export_dir" >/dev/null
  mv -- "$export_dir/image.tar.gz" "$target"
}

record_image() {
  local key="$1" ref="$2"
  local export_dir="$work/exports/$key"
  [[ -f "$export_dir/image.id" && ! -L "$export_dir/image.id" &&
     -f "$export_dir/image.ref" && ! -L "$export_dir/image.ref" ]] || {
    echo "missing or unsafe verified image identity for $key" >&2; exit 1;
  }
  [[ "$(cat "$export_dir/image.ref")" == "$ref" ]] || {
    echo "verified archive image reference mismatch: $key" >&2; exit 1;
  }
  python3 - "$prepared/images.json" "$key" "$ref" "$export_dir/image.id" <<'PY'
import json
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
image_id = pathlib.Path(sys.argv[4]).read_text(encoding="utf-8").strip()
if re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) is None:
    raise SystemExit("invalid verified exported image config identity")
data[sys.argv[2]] = {"ref": sys.argv[3], "id": image_id}
path.write_text(json.dumps(data, sort_keys=True), encoding="utf-8")
PY
}

if has_changed app; then
  load_ci_image server-image xdrive/server:test
  load_ci_image caddy-image xdrive/caddy:test
  SERVER_REF="$REGISTRY/xdrive-server:$APP_TAG"
  CADDY_REF="$REGISTRY/xdrive-caddy:$APP_TAG"
  docker tag xdrive/server:test "$SERVER_REF"
  docker tag xdrive/caddy:test "$CADDY_REF"
  archive_image server "$SERVER_REF" "$prepared/app/images/server.tar.gz"
  archive_image caddy "$CADDY_REF" "$prepared/app/images/caddy.tar.gz"
  record_image server "$SERVER_REF"
  record_image caddy "$CADDY_REF"

  test -s "$ARTIFACTS/server-deploy/xdrive-server-install.sh"
  if grep -q '@DEPLOY_ASSET_MANIFEST_B64@' "$ARTIFACTS/server-deploy/xdrive-server-install.sh"; then
    echo "refusing unrendered installer" >&2; exit 1
  fi
  cp "$ARTIFACTS/server-deploy/xdrive-server-install.sh" "$prepared/app/assets/xdrive-server-install.sh"
  cp deploy/docker-compose.yml "$prepared/app/assets/deploy/docker-compose.yml"
  for file in server-backup.sh server-backup-scheduled.sh server-restore.sh \
    server-verify.sh server-doctor.sh server-migrate-user.sh server-control.sh \
    caddy-env-config.py caddy-admission.py xdrive-server-host.sh xdrive-share-update.py release_bundle.py; do
    cp "scripts/$file" "$prepared/app/assets/scripts/$file"
  done
  bash -n "$prepared/app/assets/xdrive-server-install.sh"
fi

if has_changed postgres; then
  test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$POSTGRES_REF")" = linux/amd64
  planned_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["postgres_image_id"])' "$XDRIVE_OFFLINE_PLAN")"
  test "$(docker image inspect --format '{{.Id}}' "$POSTGRES_REF")" = "$planned_id" || {
    echo "postgres changed after source planning" >&2; exit 1;
  }
  # Content-pin PostgreSQL so rollback retains the old image even if the
  # floating upstream postgres:17-alpine tag moves between releases.
  PINNED_POSTGRES="xdrive/offline-postgres:sha-${planned_id:7:12}"
  docker tag "$POSTGRES_REF" "$PINNED_POSTGRES"
  archive_image postgres "$PINNED_POSTGRES" "$prepared/postgres/images/postgres.tar.gz"
  record_image postgres "$PINNED_POSTGRES"
fi

if has_changed media-worker; then
  load_ci_image media-worker-image xdrive/media-worker:test
  MEDIA_REF="$REGISTRY/xdrive-media-worker:$APP_TAG"
  docker tag xdrive/media-worker:test "$MEDIA_REF"
  archive_image media-worker "$MEDIA_REF" "$prepared/media-worker/images/media-worker.tar.gz"
  record_image media-worker "$MEDIA_REF"
fi

if has_changed ai-runtime; then
  RUNTIME_CONTRACT="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["fingerprints"]["ai-runtime"][:16])' "$XDRIVE_OFFLINE_PLAN")"
  RUNTIME_REF="xdrive/offline-ai-runtime:$RUNTIME_CONTRACT"
  docker build --target offline-runtime \
    --build-arg "XDRIVE_RUNTIME_VERSION=$RUNTIME_CONTRACT" \
    -f services/photo-face-analyzer/Dockerfile \
    -t "$RUNTIME_REF" services/photo-face-analyzer
  archive_image ai-runtime "$RUNTIME_REF" "$prepared/ai-runtime/images/ai-runtime.tar.gz"
  record_image ai-runtime "$RUNTIME_REF"
fi

if has_changed ai-models; then
  load_ci_image photo-face-image xdrive/photo-face:test
  photo_id="$(docker create xdrive/photo-face:test)"
  docker cp "$photo_id:/models/." "$prepared/ai-models/models/"
  docker cp "$photo_id:/licenses/." "$prepared/ai-models/licenses/"
  python3 services/photo-face-analyzer/fetch_models.py \
    "$prepared/ai-models/models" "$prepared/ai-models/licenses" --verify-only
  docker rm "$photo_id" >/dev/null
  photo_id=""
fi

build_args=(
  --prepared "$prepared" --output "$OUT"
  --commit "$XDRIVE_OFFLINE_COMMIT" --channel "$XDRIVE_OFFLINE_CHANNEL"
  --source "$XDRIVE_OFFLINE_SOURCE" --plan "$XDRIVE_OFFLINE_PLAN"
)
[[ -z "$previous" ]] || build_args+=(--reuse-manifest "$previous")
python3 scripts/offline/xdrive_offline.py build "${build_args[@]}"

if [[ -n "$changed_csv" ]]; then
  digest="$(sha256sum "$OUT/manifest.json" | cut -d' ' -f1)"
  python3 scripts/offline/xdrive_offline.py verify --dir "$OUT" \
    --components "$changed_csv" --trusted-manifest-sha256 "$digest"
fi
sha256sum "$OUT/manifest.json" | cut -d' ' -f1 > "$OUT/MANIFEST_SHA256.txt"
echo "[offline] new components: ${changed_csv:-none}; all five components referenced by manifest"
