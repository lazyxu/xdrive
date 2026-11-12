#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXPORT="$ROOT/scripts/ci/export-docker-image.sh"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/out"

# Simulate BuildKit's attested manifest-list ID being different from the
# platform image config that docker save/load actually transports.
python3 - "$TMP" <<'PY'
import hashlib
import io
import json
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
config = b'{"architecture":"amd64","os":"linux","config":{"Labels":{"source":"tested"}}}'
digest = hashlib.sha256(config).hexdigest()
(root / "expected.id").write_text("sha256:" + digest + "\n")
def archive(name, tag, payload):
    member = "blobs/sha256/" + digest
    manifest = json.dumps([{"Config": member, "RepoTags": [tag], "Layers": []}]).encode()
    with tarfile.open(root / name, mode="w") as saved:
        for filename, body in [("manifest.json", manifest), (member, payload)]:
            info = tarfile.TarInfo(filename)
            info.mode = 0o644
            info.size = len(body)
            saved.addfile(info, io.BytesIO(body))
archive("good.tar", "xdrive/server:test", config)
archive("digest-mismatch.tar", "xdrive/server:test", config + b"tampered")
archive("wrong-tag.tar", "another/server:test", config)
PY

cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == image && "$2" == inspect && "$3" == xdrive/server:test ]]; then
  # The source tag is an attested manifest index, NOT the saved config ID.
  printf 'sha256:%064d\n' 9
elif [[ "$1" == save && "$2" == xdrive/server:test ]]; then
  cat "$XD_TEST_DOCKER_SAVE_ARCHIVE"
else
  echo "unexpected Docker export call: $*" >&2
  exit 3
fi
MOCK
chmod 700 "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export XD_TEST_DOCKER_SAVE_ARCHIVE="$TMP/good.tar"

bash -n "$EXPORT"
bash "$EXPORT" xdrive/server:test "$TMP/out" >"$TMP/good.log" 2>&1
cmp "$TMP/expected.id" "$TMP/out/image.id"
grep -Fxq xdrive/server:test "$TMP/out/image.ref"
gzip -t "$TMP/out/image.tar.gz"
grep -Fq 'Exported exact Docker image xdrive/server:test' "$TMP/good.log"
if grep -Fq "$(printf 'sha256:%064d' 9)" "$TMP/out/image.id"; then
  echo "export incorrectly captured attested index ID" >&2
  exit 1
fi

for fixture in digest-mismatch wrong-tag; do
  export XD_TEST_DOCKER_SAVE_ARCHIVE="$TMP/$fixture.tar"
  if bash "$EXPORT" xdrive/server:test "$TMP/out" >"$TMP/$fixture.log" 2>&1; then
    echo "untrusted Docker archive accepted: $fixture" >&2
    exit 1
  fi
  if [[ -e "$TMP/out/image.id" || -e "$TMP/out/image.ref" ]]; then
    echo "stale image sidecar survived failed export: $fixture" >&2
    exit 1
  fi
done

echo "Docker export: tagged config SHA, distinct manifest index, tamper and stale-sidecar checks passed"
