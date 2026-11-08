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
mapfile -t names < <(python3 - "$root/release-bundle.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf8") as f:
    data=json.load(f)
names=[item["filename"] for item in data["artifacts"]]
assert len(names) == len(set(names)) and all("/" not in n and "\\" not in n for n in names)
for name in sorted(names):
    print(name)
PY
)
assets=("$root/release-bundle.json")
for name in "${names[@]}"; do
  [[ -s "$root/$name" && ! -L "$root/$name" ]] || { echo "missing $name" >&2; exit 1; }
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
