#!/usr/bin/env bash
# Publish source-exact Synology SPK to immutable GitHub Release + monotonic channel feed.
set -euo pipefail

channel="${1:-}"
directory="${2:-}"
commit="${3:-}"
repo="${GITHUB_REPOSITORY:-lazyxu/xdrive}"
case "$channel" in edge|stable) ;; *) echo "expected stable or edge channel" >&2; exit 2 ;; esac
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo "full source commit required" >&2; exit 2; }
[[ "$repo" == "lazyxu/xdrive" ]] || { echo "official repository required" >&2; exit 2; }
[[ -n "$directory" && -d "$directory" ]] || { echo "release directory required" >&2; exit 2; }
: "${GH_TOKEN:?A scoped GitHub Release publisher token is required}"
for tool in gh python3 jq sha256sum md5sum stat tar; do
  command -v "$tool" >/dev/null || { echo "missing publisher tool: $tool" >&2; exit 1; }
done

shopt -s nullglob
spks=("$directory"/xdrivenas-armada38x-*.spk)
[[ "${#spks[@]}" == 1 ]] || { echo "expected exactly one release SPK" >&2; exit 1; }
spk="${spks[0]}"
checksum="$spk.sha256"
[[ -s "$checksum" && ! -L "$spk" && ! -L "$checksum" ]] || {
  echo "missing, empty or linked release SPK/checksum" >&2; exit 1;
}
bash scripts/ci/verify-synology-spk-release.sh "$directory" --require-mui
base="$(basename "$spk")"
version="${base#xdrivenas-armada38x-}"
version="${version%.spk}"
[[ "$version" =~ ^0\.1\.0-[1-9][0-9]*$ ]] || { echo "invalid incremental DSM version" >&2; exit 1; }
digest="$(sha256sum "$spk" | awk '{print $1}')"
md5="$(md5sum "$spk" | awk '{print $1}')"
bytes="$(stat -c %s "$spk")"
tag="dsm-$channel-$commit"
feed="dsm-$channel-feed"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

# Always pin catalog.link to this permanent SPK URL, not mutable /snapshot/.
export XD_DSM_CHANNEL="$channel" XD_DSM_COMMIT="$commit" XD_DSM_VERSION="$version"
export XD_DSM_SHA256="$digest" XD_DSM_MD5="$md5" XD_DSM_SIZE="$bytes"
python3 - "$tmp/catalog.json" <<'PY'
import json, os, sys
channel = os.environ["XD_DSM_CHANNEL"]
commit = os.environ["XD_DSM_COMMIT"]
version = os.environ["XD_DSM_VERSION"]
data = {
    "schema": 1, "channel": channel, "package": "xdrivenas",
    "arch": "armada38x", "os_min_ver": "7.0-40759",
    "commit": commit, "version": version,
    "sha256": os.environ["XD_DSM_SHA256"],
    "md5": os.environ["XD_DSM_MD5"],
    "size": int(os.environ["XD_DSM_SIZE"]),
    "link": (
        "https://github.com/lazyxu/xdrive/releases/download/"
        f"dsm-{channel}-{commit}/xdrivenas-armada38x-{version}.spk"
    ),
}
with open(sys.argv[1], "w", encoding="utf-8") as out:
    json.dump(data, out, sort_keys=True, separators=(",", ":"))
    out.write("\n")
PY

verify_immutable() {
  local data names actual expected path filename ref
  data="$(gh api "repos/$repo/releases/tags/$tag")"
  names="$(jq -r '.assets[].name' <<< "$data" | LC_ALL=C sort)"
  expected="$(printf '%s\n%s\n' "$base" "$(basename "$checksum")" | LC_ALL=C sort)"
  [[ "$names" == "$expected" ]] || { echo "unexpected immutable SPK release asset" >&2; return 1; }
  for path in "$spk" "$checksum"; do
    filename="$(basename "$path")"
    expected="sha256:$(sha256sum "$path" | awk '{print $1}')"
    actual="$(jq -r --arg n "$filename" '[.assets[] | select(.name == $n) | .digest] | if length == 1 then .[0] else empty end' <<< "$data")"
    [[ "$actual" == "$expected" ]] || { echo "immutable release SHA-256 mismatch: $filename" >&2; return 1; }
  done
  ref="$(gh api "repos/$repo/git/ref/tags/$tag" --jq '.object.sha')"
  [[ "$ref" == "$commit" ]] || { echo "immutable release ref mismatch" >&2; return 1; }
}

if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  if [[ "$channel" == edge ]]; then
    gh release create "$tag" "$spk" "$checksum" --repo "$repo" --target "$commit" --prerelease \
      --title "xDrive DSM edge $version" --notes "Immutable verified SPK from $commit"
  else
    gh release create "$tag" "$spk" "$checksum" --repo "$repo" --target "$commit" \
      --title "xDrive DSM stable $version" --notes "Immutable verified SPK from $commit"
  fi
fi
verify_immutable

# Revalidate the published Snapshot immediately before edge feed promotion.
if [[ "$channel" == edge ]]; then
  snapshot="$(gh api "repos/$repo/git/ref/tags/snapshot" --jq '.object.sha')"
  [[ "$snapshot" =~ ^[a-f0-9]{40}$ ]] || { echo "invalid Snapshot ref" >&2; exit 1; }
  if [[ "$snapshot" != "$commit" ]]; then
    echo "Skip superseded edge feed: snapshot=$snapshot candidate=$commit"
    exit 0
  fi
fi

if gh release view "$feed" --repo "$repo" >/dev/null 2>&1; then
  mkdir -p "$tmp/prior"
  gh release download "$feed" --repo "$repo" --pattern catalog.json --dir "$tmp/prior"
  python3 - "$tmp/prior/catalog.json" "$tmp/catalog.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: old = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f: new = json.load(f)
assert old.get("schema") == new["schema"] == 1
assert old.get("channel") == new["channel"]
assert old.get("package") == new["package"] == "xdrivenas"
assert old.get("arch") == new["arch"] == "armada38x"
assert old.get("version", "").startswith("0.1.0-")
old_n = int(old["version"].rsplit("-", 1)[-1])
new_n = int(new["version"].rsplit("-", 1)[-1])
if old_n > new_n:
    print("Refusing obsolete DSM version", file=sys.stderr)
    sys.exit(10)
if old_n == new_n and old != new:
    print("Same DSM version with differing source or digest", file=sys.stderr)
    sys.exit(11)
PY
  if cmp -s "$tmp/prior/catalog.json" "$tmp/catalog.json"; then
    echo "DSM $channel feed already points to verified $version"
    exit 0
  fi
  gh release upload "$feed" "$tmp/catalog.json" --repo "$repo" --clobber
else
  gh release create "$feed" "$tmp/catalog.json" --repo "$repo" --target "$commit" \
    --title "xDrive DSM $channel package source" \
    --notes "Package Center catalog metadata; SPK binaries are immutable."
fi

# Promotion is accepted only when GitHub's remote asset SHA256 matches.
expected="sha256:$(sha256sum "$tmp/catalog.json" | awk '{print $1}')"
remote="$(gh api "repos/$repo/releases/tags/$feed")"
actual="$(jq -r '[.assets[] | select(.name == "catalog.json") | .digest] | if length == 1 then .[0] else empty end' <<< "$remote")"
[[ "$actual" == "$expected" ]] || { echo "DSM feed digest mismatch" >&2; exit 1; }
echo "Published DSM $channel feed: $version commit=$commit immutable=$tag"
