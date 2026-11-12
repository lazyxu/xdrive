#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMPORT="$ROOT/scripts/ci/import-docker-image.sh"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/artifact"
export XD_TEST_DOCKER_RECORD="$TMP/docker-calls" XD_TEST_DOCKER_STREAM="$TMP/docker-stream"
export XD_TEST_IMAGE_ID="sha256:$(printf 'a%.0s' {1..64})"
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_TEST_DOCKER_RECORD"
case "$1" in
  load)
    case "${XD_TEST_LOAD_MODE:-success}" in
      hang) sleep 60 ;;
      fail) cat > /dev/null; exit 42 ;;
      *) cat > "$XD_TEST_DOCKER_STREAM" ;;
    esac
    ;;
  save)
    [[ "$2" == xdrive/server:test ]] || exit 3
    cat "$XD_TEST_DOCKER_SAVE_TAR"
    ;;
  image)
    [[ "${2:-}" == inspect && "${3:-}" == --format && "${4:-}" == '{{.Id}}' && "${5:-}" == xdrive/server:test ]] || exit 3
    printf '%s\n' "$XD_TEST_IMAGE_ID"
    ;;
  *) exit 3 ;;
esac
MOCK
chmod 700 "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
printf 'this is a tiny CI test docker archive\n' > "$TMP/payload"
gzip -c "$TMP/payload" > "$TMP/artifact/image.tar.gz"
printf '%s\n' "$XD_TEST_IMAGE_ID" > "$TMP/artifact/image.id"
bash -n "$IMPORT"

bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/pass.log" 2>&1
grep -Fq 'Loaded exact Docker image xdrive/server:test' "$TMP/pass.log"
cmp "$TMP/payload" "$XD_TEST_DOCKER_STREAM"
grep -Fxq 'load' "$XD_TEST_DOCKER_RECORD"

# Fail if the expected digest is not the digest of the actual loaded image.
printf 'sha256:%064d\n' 0 > "$TMP/artifact/image.id"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/mismatch.log" 2>&1; then
  echo 'mismatched image ID was accepted' >&2; exit 1
fi
grep -Fq 'loaded Docker image ID mismatch' "$TMP/mismatch.log"
printf '%s\n' "$XD_TEST_IMAGE_ID" > "$TMP/artifact/image.id"

# An invalid gzip member or late CRC corruption must never be considered a
# successful import, even if a stub Docker returns exit 0 for the stream.
printf 'not a gzip' > "$TMP/artifact/image.tar.gz"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/bad-gzip.log" 2>&1; then
  echo 'invalid gzip stream was accepted' >&2; exit 1
fi
grep -Fq 'Docker image import failed' "$TMP/bad-gzip.log"
gzip -c "$TMP/payload" > "$TMP/artifact/image.tar.gz"
python3 - "$TMP/artifact/image.tar.gz" <<'PY'
import sys
p=sys.argv[1]
with open(p,'r+b') as f:
    f.seek(-8,2)
    original=f.read(1)
    f.seek(-8,2)
    f.write(bytes([original[0]^1]))
PY
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/bad-crc.log" 2>&1; then
  echo 'invalid gzip CRC was accepted by pipeline' >&2; exit 1
fi
# Restore for subsequent checks.
gzip -c "$TMP/payload" > "$TMP/artifact/image.tar.gz"

# The upper bound is enforced at the only blocking read; no registry tag is
# touched if a mock docker load hangs. Test uses a 1-second timeout.
if XD_IMPORT_DOCKER_TIMEOUT_SECONDS=1 XD_TEST_LOAD_MODE=hang \
    bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/timeout.log" 2>&1; then
  echo 'hung docker load was accepted' >&2; exit 1
fi
grep -Fq 'Docker image import timed out' "$TMP/timeout.log"

if XD_IMPORT_DOCKER_TIMEOUT_SECONDS=0 bash "$IMPORT" "$TMP/artifact" xdrive/server:test >/dev/null 2>&1; then
  echo 'invalid timeout override was accepted' >&2; exit 1
fi
printf 'malformed\n' > "$TMP/artifact/image.id"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test >/dev/null 2>&1; then
  echo 'invalid image ID was accepted' >&2; exit 1
fi
printf '%s\n' "$XD_TEST_IMAGE_ID" > "$TMP/artifact/image.id"
mv "$TMP/artifact/image.tar.gz" "$TMP/artifact/original.tar.gz"
ln -s "$TMP/artifact/original.tar.gz" "$TMP/artifact/image.tar.gz"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test >/dev/null 2>&1; then
  echo 'symlinked CI archive was accepted' >&2; exit 1
fi
if grep -E '^(tag|push|build|save)' "$XD_TEST_DOCKER_RECORD"; then
  echo 'import attempted unrelated Docker mutation' >&2; exit 1
fi

# Docker 29 may inspect an index digest while Rootless Docker loads config.
# Test that the exporter records the archive config ID, not an index ID.
mkdir -p "$TMP/bin-export"
python3 - "$TMP" <<'PY'
import hashlib, io, json, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
config = b'{"architecture":"amd64","config":{"Env":["XDRIVE_TEST=1"]},"os":"linux"}'
digest = hashlib.sha256(config).hexdigest()
(root / "expected-config-id").write_text("sha256:" + digest + "\n")
for tag, output in [
    ("xdrive/caddy:test", "docker-image-fixture.tar"),
    ("xdrive/server:test", "docker-import-verify.tar"),
    ("other/image:test", "wrong-tag-fixture.tar"),
]:
    manifest = json.dumps([{
        "Config": digest + ".json",
        "RepoTags": [tag],
        "Layers": [],
    }], separators=(",", ":")).encode()
    with tarfile.open(root / output, "w") as tf:
        for name, body in [(digest + ".json", config), ("manifest.json", manifest)]:
            info = tarfile.TarInfo(name)
            info.size = len(body)
            tf.addfile(info, io.BytesIO(body))
PY
cat > "$TMP/bin-export/docker" <<'MOCK_EXPORT'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == image && "$2" == inspect ]]; then
  [[ "$3" == xdrive/caddy:test ]] || exit 3
  printf 'sha256:%064d\n' 5
elif [[ "$1" == save && "$2" == xdrive/caddy:test ]]; then
  cat "$XD_TEST_DOCKER_SAVE_TAR"
else
  exit 3
fi
MOCK_EXPORT
chmod 700 "$TMP/bin-export/docker"
export XD_TEST_DOCKER_SAVE_TAR="$TMP/docker-image-fixture.tar"
PATH="$TMP/bin-export:$PATH" bash "$ROOT/scripts/ci/export-docker-image.sh" \
  xdrive/caddy:test "$TMP/exported" > "$TMP/exported.log"
cmp "$TMP/expected-config-id" "$TMP/exported/image.id"
grep -Fq 'Exported exact Docker image xdrive/caddy:test' "$TMP/exported.log"
export XD_TEST_DOCKER_SAVE_TAR="$TMP/wrong-tag-fixture.tar"
if PATH="$TMP/bin-export:$PATH" bash "$ROOT/scripts/ci/export-docker-image.sh" \
  xdrive/caddy:test "$TMP/export-bad" > "$TMP/export-bad.log" 2>&1; then
  echo 'Docker save accepted an archive for a different image' >&2
  exit 1
fi
grep -Fq 'archive must contain exactly the requested image/tag' "$TMP/export-bad.log"


# Index-id and config-id differ under some Docker 29/containerd stores.
# Verify the exact loaded tag's config bytes instead of trusting inspect .Id.
rm -f "$TMP/artifact/image.tar.gz"
gzip -c "$TMP/payload" > "$TMP/artifact/image.tar.gz"
cp "$TMP/expected-config-id" "$TMP/artifact/image.id"
export XD_TEST_IMAGE_ID="sha256:$(printf 'b%.0s' {1..64})"
export XD_TEST_DOCKER_SAVE_TAR="$TMP/docker-import-verify.tar"
bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/index-digest.log"
grep -Fq 'Verified re-saved Docker image config SHA-256' "$TMP/index-digest.log"

# A tag that claims an unrelated expected config must fail closed.
printf 'sha256:%064d\n' 7 > "$TMP/artifact/image.id"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/false-config.log" 2>&1; then
  echo 'Wrong config accepted after OCI-index mismatch' >&2; exit 1
fi

# Re-saving an unrelated tag must not satisfy a matching config digest.
cp "$TMP/expected-config-id" "$TMP/artifact/image.id"
export XD_TEST_DOCKER_SAVE_TAR="$TMP/wrong-tag-fixture.tar"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/false-tag.log" 2>&1; then
  echo 'Wrong saved image tag accepted after OCI-index mismatch' >&2; exit 1
fi

echo 'Bounded exact Docker image import: SHA, CRC, bounded timeout, OCI index/config, tag and negative tests passed'
