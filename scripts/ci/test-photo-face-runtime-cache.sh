#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# Dependency/source probes must never rewrite the checkout used by another job.
ROOT="$TMP/fixture"
mkdir -p "$ROOT/scripts/ci" "$ROOT/services/photo-face-analyzer/tests"
for script in test-photo-face-image.sh photo-face-runtime-cache-key.sh build-metadata.sh client-artifact-version.sh export-docker-image.sh; do
  cp "$SOURCE_ROOT/scripts/ci/$script" "$ROOT/scripts/ci/$script"
done
for input in Dockerfile Dockerfile.cached requirements.txt fetch_models.py analyzer.py creative.py THIRD_PARTY.md; do
  if [[ -f "$SOURCE_ROOT/services/photo-face-analyzer/$input" ]]; then
    cp "$SOURCE_ROOT/services/photo-face-analyzer/$input" "$ROOT/services/photo-face-analyzer/$input"
  fi
done
export GIT_DIR="$(git -C "$SOURCE_ROOT" rev-parse --absolute-git-dir)"
export GIT_WORK_TREE="$ROOT"
export FAKE_DOCKER_SOURCE="$ROOT"
TARGET="$ROOT/scripts/ci/test-photo-face-image.sh"
KEY_SCRIPT="$ROOT/scripts/ci/photo-face-runtime-cache-key.sh"
REQUIREMENTS="$ROOT/services/photo-face-analyzer/requirements.txt"

mkdir -p "$TMP/bin" "$TMP/state/images" "$TMP/cache"
export FAKE_DOCKER_STATE="$TMP/state"

cat >"$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

state="${FAKE_DOCKER_STATE:?FAKE_DOCKER_STATE is required}"
mkdir -p "$state/images"
events="$state/events"
touch "$events"

image_key() {
  printf '%s' "$1" | sed 's#[/:]#_#g'
}

image_file() {
  printf '%s/images/%s' "$state" "$(image_key "$1")"
}

write_image() {
  local ref="$1" runtime_hash="$2" version="$3" revision="$4"
  local file id
  file="$(image_file "$ref")"
  id="sha256:$(printf '%s|%s|%s|%s' "$ref" "$runtime_hash" "$version" "$revision" | sha256sum | awk '{print $1}')"
  printf '%s|%s|%s|%s|%s\n' "$ref" "$runtime_hash" "$version" "$revision" "$id" >"$file"
}

read_image() {
  local ref="$1" file
  file="$(image_file "$ref")"
  [[ -f "$file" ]] || return 1
  cat "$file"
}

case "${1:-}" in
  image)
    shift
    case "${1:-}" in
      inspect)
        shift
        format=""
        if [[ "${1:-}" == "--format" ]]; then
          format="${2:-}"
          shift 2
        fi
        ref="${1:?image ref required}"
        line="$(read_image "$ref")" || exit 1
        IFS='|' read -r saved_ref runtime_hash version revision id <<<"$line"
        if [[ -n "$format" ]]; then
          case "$format" in
            *photo-face.runtime-contract*) printf '%s\n' "$runtime_hash" ;;
            *org.opencontainers.image.version*) printf '%s\n' "$version" ;;
            *org.opencontainers.image.revision*) printf '%s\n' "$revision" ;;
            *'{{.Id}}'*) printf '%s\n' "$id" ;;
            *) printf '\n' ;;
          esac
        fi
        ;;
      rm)
        shift
        [[ "${1:-}" == "-f" ]] && shift
        ref="${1:?image ref required}"
        rm -f "$(image_file "$ref")"
        ;;
      *)
        echo "unexpected fake docker image command: $*" >&2
        exit 91
        ;;
    esac
    ;;
  build)
    shift
    target=""
    tag=""
    runtime_hash=""
    version=""
    revision=""
    dockerfile=""
    network=""
    context=""
    dependencies_image=""
    while (($#)); do
      case "$1" in
        --target)
          target="$2"
          shift 2
          ;;
        -t)
          tag="$2"
          shift 2
          ;;
        --build-arg)
          arg="$2"
          case "$arg" in
            XDRIVE_RUNTIME_CONTRACT_HASH=*) runtime_hash="${arg#*=}" ;;
            VERSION=*) version="${arg#*=}" ;;
            BUILD_COMMIT=*) revision="${arg#*=}" ;;
            XDRIVE_RUNTIME_DEPENDENCIES_IMAGE=*) dependencies_image="${arg#*=}" ;;
          esac
          shift 2
          ;;
        --cache-from)
          shift 2
          ;;
        -f)
          dockerfile="$2"
          shift 2
          ;;
        --network)
          network="$2"
          shift 2
          ;;
        *)
          context="$1"
          shift
          ;;
      esac
    done
    [[ -n "$target" && -n "$tag" ]] || {
      echo "fake docker build missing target/tag" >&2
      exit 92
    }
    if [[ "$dockerfile" == Dockerfile.cached ]]; then
      [[ "$network" == none && "$context" == - ]] || {
        echo "cached runtime build must use an offline streamed context" >&2
        exit 95
      }
      read_image "$dependencies_image" >/dev/null
      context_dir="$(mktemp -d "$state/context.XXXXXX")"
      tar -xf - -C "$context_dir"
      test -s "$context_dir/models/model.onnx"
      test -s "$context_dir/licenses/LICENSE"
      test -s "$context_dir/fetch_models.py"
      test -s "$context_dir/Dockerfile.cached"
      if find "$context_dir" -name '*.part' -print -quit | grep -q .; then
        echo "partial model bytes must not enter the runtime build context" >&2
        exit 96
      fi
      printf 'offline-runtime|%s\n' "$tag" >>"$events"
    fi
    if [[ "$target" == final && "$dockerfile" != services/photo-face-analyzer/Dockerfile ]]; then
      [[ "$network" == none ]] || {
        echo "final image build must not need a download network" >&2
        exit 97
      }
      read -r from base alias stage <"$dockerfile"
      [[ "$from" == FROM && "$base" == xdrive/photo-face:test-runtime-* && "$alias" == AS && "$stage" == runtime ]]
      line="$(read_image "$base")"
      IFS='|' read -r saved_ref runtime_hash saved_version saved_revision saved_id <<<"$line"
      diff -u <(sed -n '/^FROM runtime AS final$/,$p' "$FAKE_DOCKER_SOURCE/services/photo-face-analyzer/Dockerfile") <(tail -n +2 "$dockerfile")
      printf 'final-base|%s\n' "$base" >>"$events"
    fi
    write_image "$tag" "$runtime_hash" "$version" "$revision"
    printf 'build|%s|%s|%s\n' "$target" "$tag" "$runtime_hash" >>"$events"
    ;;
  run)
    shift
    ref=""
    source_mount=""
    model_mount=""
    env_names="|"
    while (($#)); do
      case "$1" in
        --mount)
          case "$2" in
            *,dst=/workspace,readonly) source_mount="$2" ;;
            *,dst=/model-cache) model_mount="$2" ;;
          esac
          shift 2
          ;;
        --env|-e)
          [[ "$2" != *=* ]] || {
            echo "prefetch environment must pass names without logging values" >&2
            exit 98
          }
          env_names+="$2|"
          shift 2
          ;;
        --workdir|--network)
          shift 2
          ;;
        xdrive/photo-face:*)
          ref="$1"
          shift
          break
          ;;
        *) shift ;;
      esac
    done
    [[ -n "$ref" ]] || {
      echo "fake docker run missing image ref" >&2
      exit 93
    }
    read_image "$ref" >/dev/null || exit 1
    if [[ "$*" == *fetch_models.py* ]]; then
      [[ "$source_mount" == "type=bind,src=$FAKE_DOCKER_SOURCE/services/photo-face-analyzer,dst=/workspace,readonly" ]]
      [[ "$model_mount" == "type=bind,src=$XDRIVE_PHOTO_FACE_MODEL_CACHE_DIR,dst=/model-cache" ]]
      [[ "$*" == 'python /workspace/fetch_models.py /model-cache/models /model-cache/licenses' ]]
      for name in HF_ENDPOINT XDRIVE_MODEL_DOWNLOAD_ATTEMPTS XDRIVE_MODEL_DOWNLOAD_TIMEOUT HTTP_PROXY http_proxy HTTPS_PROXY https_proxy NO_PROXY no_proxy; do
        [[ "$env_names" == *"|$name|"* ]] || {
          echo "prefetch must forward configured $name by name" >&2
          exit 99
        }
      done
      model_cache="$XDRIVE_PHOTO_FACE_MODEL_CACHE_DIR"
      mkdir -p "$model_cache/models" "$model_cache/licenses"
      printf 'prefetch|%s\n' "$model_cache" >>"$events"
      if [[ -f "$state/fail-prefetch-once" ]]; then
        rm -f "$state/fail-prefetch-once"
        printf 'partial model bytes' >"$model_cache/models/model.onnx.part"
        echo "fake model download interrupted" >&2
        exit 12
      fi
      if [[ -f "$model_cache/models/model.onnx.part" ]]; then
        printf 'resume|%s\n' "$model_cache" >>"$events"
      fi
      printf 'verified model bytes' >"$model_cache/models/model.onnx"
      printf 'verified license text' >"$model_cache/licenses/LICENSE"
      rm -f "$model_cache/models/model.onnx.part"
      # A cache may also retain a partial file from an older model contract.
      printf 'obsolete partial bytes' >"$model_cache/models/obsolete.onnx.part"
    elif [[ "$*" == python* ]]; then
      if [[ "$*" != *'import cv2;'* ]]; then
        [[ "$source_mount" == "type=bind,src=$FAKE_DOCKER_SOURCE/services/photo-face-analyzer,dst=/workspace,readonly" ]]
      fi
    else
      [[ -z "$source_mount" && -z "$model_mount" ]] || {
        echo "exact final image tests must not mount source or cached models" >&2
        exit 100
      }
    fi
    printf 'run|%s\n' "$ref" >>"$events"
    ;;
  save)
    shift
    ref="${1:?image ref required}"
    read_image "$ref"
    printf 'save|%s\n' "$ref" >>"$events"
    ;;
  load)
    line="$(cat)"
    IFS='|' read -r ref runtime_hash version revision id <<<"$line"
    [[ -n "$ref" ]] || {
      echo "fake docker load missing image record" >&2
      exit 94
    }
    write_image "$ref" "$runtime_hash" "$version" "$revision"
    printf 'load|%s|%s\n' "$ref" "$runtime_hash" >>"$events"
    ;;
  __fake_create)
    shift
    ref="${1:?image ref required}"
    runtime_hash="${2:-}"
    version="${3:-}"
    revision="${4:-}"
    write_image "$ref" "$runtime_hash" "$version" "$revision"
    ;;
  *)
    echo "unexpected fake docker command: $*" >&2
    exit 90
    ;;
esac
SH
chmod +x "$TMP/bin/docker"

runtime_build_count() {
  grep -c '^build|runtime|' "$TMP/state/events" || true
}

assert_exact_artifact() {
  local artifact_dir="$1" expected_hash="$2" record
  local ref runtime_hash version revision image_id
  record="$(gzip -dc "$artifact_dir/image.tar.gz")"
  IFS='|' read -r ref runtime_hash version revision image_id <<<"$record"
  [[ "$ref" == xdrive/photo-face:test && "$runtime_hash" == "$expected_hash" ]]
  [[ "$(cat "$artifact_dir/image.ref")" == "$ref" && "$(cat "$artifact_dir/image.id")" == "$image_id" ]] || {
    echo "exported artifact must preserve the exact validated final image identity" >&2
    exit 1
  }
}

run_photo_face() {
  local name="$1"
  rm -rf "$TMP/artifact-$name"
  : >"$TMP/$name.outputs"
  PATH="$TMP/bin:$PATH" \
    XDRIVE_PHOTO_FACE_RUNTIME_CACHE_DIR="$TMP/cache" \
    XDRIVE_PHOTO_FACE_MODEL_CACHE_DIR="$TMP/model-cache" \
    GITHUB_OUTPUT="$TMP/$name.outputs" \
    HF_ENDPOINT=https://models.example.invalid \
    XDRIVE_MODEL_DOWNLOAD_ATTEMPTS=2 XDRIVE_MODEL_DOWNLOAD_TIMEOUT=3 \
    HTTP_PROXY=http://proxy.example.invalid http_proxy=http://proxy.example.invalid \
    HTTPS_PROXY=http://proxy.example.invalid https_proxy=http://proxy.example.invalid \
    NO_PROXY=localhost no_proxy=localhost \
    bash "$TARGET" "$TMP/artifact-$name" >"$TMP/$name.out" 2>"$TMP/$name.err"
}

hash1="$(bash "$KEY_SCRIPT")"
tag1="xdrive/photo-face:test-runtime-$hash1"
archive1="$TMP/cache/$hash1.tar.gz"

touch "$TMP/state/fail-prefetch-once"
if run_photo_face interrupted; then
  echo "failed prefetch must stop before runtime or final image export" >&2
  exit 1
fi
grep -Fq 'fake model download interrupted' "$TMP/interrupted.err"
test -s "$TMP/model-cache/models/model.onnx.part" || {
  echo "failed prefetch must preserve partial model downloads" >&2
  exit 1
}
[[ "$(runtime_build_count)" == 0 ]]
! grep -q '^build|final|' "$TMP/state/events"
test ! -e "$archive1"
test ! -e "$TMP/artifact-interrupted/image.tar.gz"
grep -Fxq 'model_cache_attempted=true' "$TMP/interrupted.outputs"

# A new Docker daemon must resume using only the workspace cache files.
rm -rf "$TMP/state/images"
mkdir -p "$TMP/state/images"
run_photo_face cold
[[ "$(runtime_build_count)" == "1" ]] || {
  echo "cold cache must build runtime exactly once" >&2
  exit 1
}
grep -Fq "build|runtime|$tag1|$hash1" "$TMP/state/events"
test -s "$archive1"
grep -Fq "resume|$TMP/model-cache" "$TMP/state/events"
grep -Fq "offline-runtime|$tag1" "$TMP/state/events"
grep -Fq "final-base|$tag1" "$TMP/state/events"
test ! -e "$TMP/model-cache/models/model.onnx.part"
test -s "$TMP/model-cache/models/obsolete.onnx.part"
assert_exact_artifact "$TMP/artifact-cold" "$hash1"

rm -rf "$TMP/state/images"
mkdir -p "$TMP/state/images"
rm -rf "$TMP/model-cache"
prefetch_before="$(grep -c '^prefetch|' "$TMP/state/events")"
run_photo_face hot
[[ "$(runtime_build_count)" == "1" ]] || {
  echo "hot cache must restore without rebuilding runtime" >&2
  exit 1
}
grep -Fq "load|$tag1|$hash1" "$TMP/state/events"
[[ "$(grep -c '^prefetch|' "$TMP/state/events")" == "$prefetch_before" && ! -e "$TMP/model-cache" ]] || {
  echo "hot runtime cache must not require raw model downloads" >&2
  exit 1
}
test ! -s "$TMP/hot.outputs"
assert_exact_artifact "$TMP/artifact-hot" "$hash1"

# Source/test/final-image-only edits must keep the same runtime identity.
printf '\n# source-only regression probe\n' >>"$ROOT/services/photo-face-analyzer/analyzer.py"
printf '# test-only regression probe\n' >"$ROOT/services/photo-face-analyzer/tests/probe.py"
printf '\n# final-only regression probe\n' >>"$ROOT/services/photo-face-analyzer/Dockerfile"
[[ "$(bash "$KEY_SCRIPT")" == "$hash1" ]] || {
  echo "business source, tests, and final stage must not change the runtime hash" >&2
  exit 1
}

# Reproduce the old poisoned-cache shape: the current hash archive contains a
# legacy fixed-tag image that does not carry the expected content identity.
PATH="$TMP/bin:$PATH" "$TMP/bin/docker" __fake_create xdrive/photo-face:test-runtime stale-contract
PATH="$TMP/bin:$PATH" "$TMP/bin/docker" save xdrive/photo-face:test-runtime | gzip -1 >"$archive1"
rm -rf "$TMP/state/images"
mkdir -p "$TMP/state/images"
run_photo_face poisoned
[[ "$(runtime_build_count)" == "2" ]] || {
  echo "poisoned current-hash archive must be evicted and rebuilt" >&2
  exit 1
}
grep -Fq "cached runtime image does not match its archive key" "$TMP/poisoned.err"
grep -Fq "build|runtime|$tag1|$hash1" "$TMP/state/events"

printf '\n# runtime cache dependency-change regression probe\n' >>"$REQUIREMENTS"
hash2="$(bash "$KEY_SCRIPT")"
[[ "$hash2" != "$hash1" ]] || {
  echo "runtime dependency change must change the runtime contract hash" >&2
  exit 1
}
tag2="xdrive/photo-face:test-runtime-$hash2"
rm -rf "$TMP/state/images"
mkdir -p "$TMP/state/images"
run_photo_face dependency-change
[[ "$(runtime_build_count)" == "3" ]] || {
  echo "dependency hash change must build a distinct runtime image" >&2
  exit 1
}
grep -Fq "build|runtime|$tag2|$hash2" "$TMP/state/events"
test -s "$TMP/cache/$hash2.tar.gz"

cached_hash="$(bash "$KEY_SCRIPT")"
printf '\n# cached runtime contract regression probe\n' >>"$ROOT/services/photo-face-analyzer/Dockerfile.cached"
[[ "$(bash "$KEY_SCRIPT")" != "$cached_hash" ]] || {
  echo "offline runtime Dockerfile must participate in the runtime hash" >&2
  exit 1
}

echo "Photo Face runtime cache interrupted/resume/cold/hot/poison/dependency-change tests passed"
