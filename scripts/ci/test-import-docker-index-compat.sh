#!/usr/bin/env bash
# OCI index and platform config are both legitimate Docker 29 image identities.
# The fallback may pass ONLY when docker save of the loaded tag reproduces the
# exact config digest of the already-validated CI archive.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMPORT="$ROOT/scripts/ci/import-docker-image.sh"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/artifact"
python3 - "$TMP" <<'PY'
import gzip
import hashlib
import io
import json
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
tag = "xdrive/server:test"
config = b'{"architecture":"amd64","os":"linux","config":{"Labels":{"release":"correct"}}}'
other = b'{"architecture":"amd64","os":"linux","config":{"Labels":{"release":"wrong"}}}'
digest = hashlib.sha256(config).hexdigest()
(root / "artifact" / "image.id").write_text("sha256:" + digest + "\n")
def make_archive(filename, contents, selected_tag, override_path=None):
    checksum = hashlib.sha256(contents).hexdigest()
    config_path = override_path or ("blobs/sha256/" + checksum)
    manifest = json.dumps([{"Config":config_path,"RepoTags":[selected_tag],"Layers":[]}]).encode()
    with tarfile.open(root / filename, mode="w") as tar:
        for name, body in [("manifest.json", manifest), (config_path, contents)]:
            entry = tarfile.TarInfo(name)
            entry.size = len(body)
            entry.mode = 0o644
            tar.addfile(entry, io.BytesIO(body))
make_archive("good.tar", config, tag)
make_archive("wrong-config.tar", other, tag)
make_archive("wrong-tag.tar", config, "other/server:test")
make_archive("tampered-config.tar", config + b"!", tag, "blobs/sha256/" + digest)
with open(root / "good.tar", "rb") as src, gzip.open(root / "artifact" / "image.tar.gz", "wb") as out:
    out.write(src.read())
PY
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_INDEX_DOCKER_RECORD"
case "$1" in
  load)
    cat > "$XD_INDEX_DOCKER_LOADED"
    echo 'Loaded image: xdrive/server:test'
    ;;
  image)
    [[ "$2" == inspect && "$3" == --format && "$4" == '{{.Id}}' && "$5" == xdrive/server:test ]] || exit 3
    printf 'sha256:%064d\n' 1
    ;;
  save)
    [[ "$2" == xdrive/server:test ]] || exit 3
    cat "$XD_INDEX_DOCKER_REEXPORT"
    ;;
  *)
    echo "unexpected Docker operation: $*" >&2
    exit 3
    ;;
esac
MOCK
chmod 700 "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export XD_INDEX_DOCKER_RECORD="$TMP/docker.log"
export XD_INDEX_DOCKER_LOADED="$TMP/loaded.tar"
export XD_INDEX_DOCKER_REEXPORT="$TMP/good.tar"
bash -n "$IMPORT"
bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/ok.log" 2>&1
grep -Fq 'verified platform config' "$TMP/ok.log"
grep -Fq 'Loaded exact Docker image xdrive/server:test' "$TMP/ok.log"
cmp "$TMP/good.tar" "$TMP/loaded.tar"
grep -Fxq 'save xdrive/server:test' "$XD_INDEX_DOCKER_RECORD"

for bad in wrong-config wrong-tag tampered-config; do
  export XD_INDEX_DOCKER_REEXPORT="$TMP/$bad.tar"
  if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/$bad.log" 2>&1; then
    echo "mismatched loaded Docker image accepted: $bad" >&2
    exit 1
  fi
  grep -Fq 'loaded Docker image ID mismatch' "$TMP/$bad.log"
done

# A failed re-export cannot be mistaken for a trustworthy image identity.
export XD_INDEX_DOCKER_REEXPORT="$TMP/missing.tar"
if bash "$IMPORT" "$TMP/artifact" xdrive/server:test > "$TMP/missing.log" 2>&1; then
  echo "failed Docker re-export was accepted" >&2
  exit 1
fi
grep -Fq 'loaded Docker image ID mismatch' "$TMP/missing.log"
if grep -E '^(build|tag|push)' "$XD_INDEX_DOCKER_RECORD"; then
  echo "image compatibility verification mutated Docker state" >&2
  exit 1
fi
echo 'Docker OCI-index/config: exact loaded bytes accepted; wrong content/tag/tamper/save fail closed'
