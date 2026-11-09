#!/usr/bin/env bash
# Publish a single immutable full-commit client Release Bundle.
# Never clobber, append to, or retag an existing Bundle. This is separate from
# the floating Snapshot and stable v* server update channels.
set -euo pipefail
: "${GH_TOKEN:?Scoped GitHub publisher token required}"
sha="${1:?full source SHA}"
root="${2:?release directory}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ -f "$root/release-bundle.json" ]] || exit 2
repo="${GITHUB_REPOSITORY:-lazyxu/xdrive}"
[[ "$repo" == lazyxu/xdrive ]] || exit 2
tag="bundle-$sha"
actual_sha="$(python3 - "$root/release-bundle.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf8") as f:
    print(json.load(f)["commit"])
PY
)"
[[ "$actual_sha" == "$sha" ]] || { echo "manifest commit mismatch" >&2; exit 1; }
# Process substitution hides the producer's exit status. A malformed
# manifest used to look exactly like a legitimately empty Server-only Bundle,
# potentially allowing publication with missing promised assets. Fail closed.
names_output="$(python3 - "$root/release-bundle.json" "$sha" <<'PY'
import json, re, sys
from urllib.parse import quote

def require(ok, detail):
    if not ok:
        raise ValueError(detail)

with open(sys.argv[1], encoding="utf8") as stream:
    data = json.load(stream)
sha = sys.argv[2]
require(isinstance(data, dict) and data.get("schema_version") == 1, "invalid schema")
require(data.get("commit") == sha, "manifest source commit mismatch")
require(data.get("channel") in ("master", "stable"), "invalid channel")
items = data.get("artifacts")
require(isinstance(items, list) and len(items) <= 30, "invalid artifact count")
names = []
for item in items:
    require(isinstance(item, dict), "invalid artifact record")
    name = item.get("filename")
    require(isinstance(name, str) and re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._+-]{0,180}", name
    ), "invalid package filename")
    require(item.get("build_commit") == sha, "cross-commit package")
    require(item.get("platform") in (
        "linux", "windows", "cli", "ios", "android", "dsm"
    ), "unknown platform")
    size, digest = item.get("size"), item.get("sha256")
    require(type(size) is int and 0 < size <= (8 << 30), "invalid package size")
    require(isinstance(digest, str) and re.fullmatch(
        r"[0-9a-f]{64}", digest
    ), "invalid package digest")
    mode = item.get("install_mode")
    require(mode in ("manual", "manual_test_only"), "invalid install mode")
    if item["platform"] == "android":
        require(mode == "manual" and re.fullmatch(
            r"xdrive-android-[1-9][0-9]{0,9}-[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}\\.apk",
            name
        ), "Android debug or unsigned APK cannot be published")
    origins = item.get("sources")
    require(isinstance(origins, dict) and set(origins) == {
        "gitlab", "github"
    }, "invalid download origins")
    require(origins["gitlab"] ==
        "http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive"
        "/packages/generic/xdrive-build-packages/sha-" + sha + "/" + quote(name),
        "untrusted GitLab source")
    require(origins["github"] ==
        "https://github.com/lazyxu/xdrive/releases/download/bundle-" + sha +
        "/" + quote(name), "untrusted GitHub source")
    names.append(name)
require(len(names) == len(set(names)), "duplicate package filename")
for name in sorted(names):
    print(name)
PY
)" || { echo "Invalid or incomplete immutable Bundle manifest" >&2; exit 1; }
names=()
if [[ -n "$names_output" ]]; then
  mapfile -t names <<< "$names_output"
fi
assets=("$root/release-bundle.json")
for name in "${names[@]}"; do
  [[ -s "$root/$name" && ! -L "$root/$name" ]] || { echo "missing $name" >&2; exit 1; }
  # Verify exact on-disk bytes before immutable release mutation; a checksum
  # mismatch is not authorization to publish the wrong installer.
  IFS=' ' read -r expected_size expected_sha < <(python3 - "$root/release-bundle.json" "$name" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf8") as stream:
    doc=json.load(stream)
row=next(item for item in doc["artifacts"] if item["filename"] == sys.argv[2])
print(row["size"], row["sha256"])
PY
)
  actual_size="$(wc -c < "$root/$name" | tr -d '[:space:]')"
  actual_sha="$(sha256sum "$root/$name" | cut -d' ' -f1)"
  [[ "$actual_size" == "$expected_size" && "$actual_sha" == "$expected_sha" ]] || {
    echo "Bundle artifact differs from its immutable SHA-256 manifest: $name" >&2
    exit 1
  }
  assets+=("$root/$name")
done

if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  # Never hijack an existing unrelated tag. A failed create is ambiguous:
  # verify remote state rather than blindly uploading partial replacements.
  if gh api "repos/$repo/git/ref/tags/$tag" >/dev/null 2>&1; then
    echo "Existing Bundle tag without a verified Release" >&2
    exit 1
  fi
  gh release create "$tag" "${assets[@]}" --repo "$repo" \
    --target "$sha" --prerelease --title "xDrive bundle ${sha:0:12}" \
    --notes "Immutable client artifacts built from complete Git Commit $sha. Optional platforms may be absent. Android debug APKs are manual testing only."
fi

ref="$(gh api "repos/$repo/git/ref/tags/$tag" --jq '.object.sha')"
[[ "$ref" == "$sha" ]] || { echo "Bundle tag does not resolve to source commit" >&2; exit 1; }
remote="$(gh api "repos/$repo/releases/tags/$tag")"
jq -e --arg tag "$tag" '.tag_name == $tag and .draft == false and .prerelease == true' <<< "$remote" >/dev/null
expected_names="$(printf '%s\n' "${assets[@]}" | xargs -r -n1 basename | LC_ALL=C sort)"
actual_names="$(jq -r '.assets[].name' <<< "$remote" | LC_ALL=C sort)"
[[ "$expected_names" == "$actual_names" ]] || { echo "Immutable Bundle asset set mismatch" >&2; exit 1; }
for path in "${assets[@]}"; do
  name="$(basename "$path")"
  expected="sha256:$(sha256sum "$path" | cut -d' ' -f1)"
  actual="$(jq -r --arg name "$name" '[.assets[] | select(.name == $name) | .digest] | if length == 1 then .[0] else empty end' <<< "$remote")"
  [[ "$actual" == "$expected" ]] || { echo "Immutable Bundle asset digest mismatch: $name" >&2; exit 1; }
done
echo "Published and verified immutable $tag with ${#names[@]} client artifacts."
