#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/scripts/ci/test-photo-face-image.sh"
KEY_SCRIPT="$ROOT/scripts/ci/photo-face-runtime-cache-key.sh"
REQUIREMENTS="$ROOT/services/photo-face-analyzer/requirements.txt"

TMP="$(mktemp -d)"
REQUIREMENTS_BACKUP="$TMP/requirements.txt"
cp "$REQUIREMENTS" "$REQUIREMENTS_BACKUP"

cleanup() {
  cp "$REQUIREMENTS_BACKUP" "$REQUIREMENTS"
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

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
          esac
          shift 2
          ;;
        --cache-from|-f)
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    [[ -n "$target" && -n "$tag" ]] || {
      echo "fake docker build missing target/tag" >&2
      exit 92
    }
    write_image "$tag" "$runtime_hash" "$version" "$revision"
    printf 'build|%s|%s|%s\n' "$target" "$tag" "$runtime_hash" >>"$events"
    ;;
  run)
    shift
    ref=""
    for arg in "$@"; do
      if [[ "$arg" == xdrive/photo-face:* ]]; then
        ref="$arg"
        break
      fi
    done
    [[ -n "$ref" ]] || {
      echo "fake docker run missing image ref" >&2
      exit 93
    }
    read_image "$ref" >/dev/null || exit 1
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

run_photo_face() {
  local name="$1"
  rm -rf "$TMP/artifact-$name"
  PATH="$TMP/bin:$PATH" \
    XDRIVE_PHOTO_FACE_RUNTIME_CACHE_DIR="$TMP/cache" \
    bash "$TARGET" "$TMP/artifact-$name" >"$TMP/$name.out" 2>"$TMP/$name.err"
}

hash1="$(bash "$KEY_SCRIPT")"
tag1="xdrive/photo-face:test-runtime-$hash1"
archive1="$TMP/cache/$hash1.tar.gz"

run_photo_face cold
[[ "$(runtime_build_count)" == "1" ]] || {
  echo "cold cache must build runtime exactly once" >&2
  exit 1
}
grep -Fq "build|runtime|$tag1|$hash1" "$TMP/state/events"
test -s "$archive1"

rm -rf "$TMP/state/images"
mkdir -p "$TMP/state/images"
run_photo_face hot
[[ "$(runtime_build_count)" == "1" ]] || {
  echo "hot cache must restore without rebuilding runtime" >&2
  exit 1
}
grep -Fq "load|$tag1|$hash1" "$TMP/state/events"

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

echo "Photo Face runtime cache cold/hot/poison/dependency-change tests passed"
