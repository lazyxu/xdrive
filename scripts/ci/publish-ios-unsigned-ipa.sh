#!/usr/bin/env bash
# Publish the exact successful master iOS IPA as a direct GitHub Release asset.
# No signing, rebuilding, artifact repacking, or mutable Release overwrite.
set -euo pipefail
umask 077

artifact_dir="${1:-}"
source_sha="${2:-}"
repo="${GITHUB_REPOSITORY:-lazyxu/xdrive}"
[[ "$repo" == "lazyxu/xdrive" ]] || { echo "Unexpected repository" >&2; exit 2; }
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Full source SHA required" >&2; exit 2; }
[[ -n "$artifact_dir" && -d "$artifact_dir" && ! -L "$artifact_dir" ]] || {
  echo "Missing regular artifact directory" >&2; exit 2;
}
: "${GH_TOKEN:?GitHub Release publishing token is required}"
for cmd in gh git sha256sum python3 jq; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 2; }
done

artifact_dir="$(cd "$artifact_dir" && pwd -P)"
ipa="$artifact_dir/xDrive-unsigned.ipa"
checksum="$ipa.sha256"
[[ -f "$ipa" && -s "$ipa" && ! -L "$ipa" && -f "$checksum" &&
   -s "$checksum" && ! -L "$checksum" ]] || {
  echo "Missing or linked IPA/SHA256 input" >&2; exit 1;
}
# Reject an extra artifact or malicious directory/symlink instead of
# accidentally publishing a different IPA from a completed CI run.
python3 - "$artifact_dir" <<'PY'
from pathlib import Path
import sys
directory = Path(sys.argv[1])
assert sorted(p.name for p in directory.iterdir()) == [
    "xDrive-unsigned.ipa", "xDrive-unsigned.ipa.sha256"
], "expected exactly the IPA and its SHA256"
assert all(p.is_file() and not p.is_symlink() for p in directory.iterdir())
PY
(cd "$artifact_dir" && sha256sum -c xDrive-unsigned.ipa.sha256)

# ZIP is the internal IPA container format, not a GitHub Artifact ZIP download.
# Validate the original compiled native iOS identity and unsigned payload.
python3 - "$ipa" <<'PY'
from pathlib import Path
import plistlib
import sys
import zipfile
p = Path(sys.argv[1])
with zipfile.ZipFile(p) as archive:
    names = archive.namelist()
    assert names and len(names) == len(set(names)), "empty or duplicated IPA members"
    assert all(name.startswith("Payload/xDriveIOS.app/") and
               ".." not in name.split("/") and not name.endswith("/../")
               for name in names), "unexpected IPA payload path"
    assert "Payload/xDriveIOS.app/Info.plist" in names, "missing native Info.plist"
    assert "Payload/xDriveIOS.app/xDriveIOS" in names, "missing native executable"
    assert not any(name.endswith("embedded.mobileprovision") or
                   "/_CodeSignature/" in name for name in names), "unexpected signed IPA"
    info = plistlib.loads(archive.read("Payload/xDriveIOS.app/Info.plist"))
    assert info.get("CFBundleIdentifier") == "com.lazyxu.xdrive.ios"
    assert info.get("CFBundleExecutable") == "xDriveIOS"
    assert archive.testzip() is None, "damaged IPA member"
PY

tag="ios-unsigned-${source_sha:0:12}"
notes="Unsigned xDrive Native iOS IPA from master commit $source_sha.

This IPA has no Apple distribution signature. Install using a signing or
sideloading tool such as SideStore; it is not an App Store build.
The attached .sha256 file verifies the exact downloadable IPA.
Build: https://github.com/$repo/actions/runs/${GITHUB_RUN_ID:-unknown}"

# If an immutable tag already exists without a Release, do not silently
# attach a new Release to someone else's reference.
if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  existing_ref="$(git ls-remote --tags origin "refs/tags/$tag")" || {
    echo "Unable to inspect remote Release tag" >&2; exit 1;
  }
  [[ -z "$existing_ref" ]] || {
    echo "Existing immutable iOS tag without matching Release; refusing" >&2; exit 1;
  }
  gh release create "$tag" "$ipa" "$checksum" --repo "$repo" \
    --target "$source_sha" --prerelease \
    --title "xDrive iOS unsigned ${source_sha:0:12}" --notes "$notes"
fi

# A retry may reuse exactly the same immutable Release, never change its bytes.
# Verify both the public Release assets AND the full commit behind its tag.
expected_ipa="sha256:$(sha256sum "$ipa" | awk '{print $1}')"
expected_checksum="sha256:$(sha256sum "$checksum" | awk '{print $1}')"
verified=0
for attempt in 1 2 3 4 5; do
  actual_ref="$(gh api "repos/$repo/git/ref/tags/$tag" --jq '.object.sha')"
  [[ "$actual_ref" == "$source_sha" ]] || {
    echo "iOS Release ref differs from exact source commit" >&2; exit 1;
  }
  release="$(gh api "repos/$repo/releases/tags/$tag")"
  if jq -e --arg tag "$tag" \
      '.tag_name == $tag and .draft == false and .prerelease == true' \
      <<< "$release" >/dev/null &&
     [[ "$(jq -r '.assets | length' <<< "$release")" == 2 ]]; then
    remote_ipa="$(jq -r '[.assets[] | select(.name == "xDrive-unsigned.ipa") | .digest] | if length == 1 then .[0] else empty end' <<< "$release")"
    remote_sum="$(jq -r '[.assets[] | select(.name == "xDrive-unsigned.ipa.sha256") | .digest] | if length == 1 then .[0] else empty end' <<< "$release")"
    if [[ "$remote_ipa" == "$expected_ipa" && "$remote_sum" == "$expected_checksum" ]]; then
      verified=1
      break
    fi
  fi
  [[ "$attempt" == 5 ]] || sleep 2
done
[[ "$verified" == 1 ]] || {
  echo "Public iOS Release asset names/digests did not match this build" >&2; exit 1;
}
direct_url="https://github.com/$repo/releases/download/$tag/xDrive-unsigned.ipa"
{
  echo "### xDrive Native iOS — direct, unsigned IPA"
  echo "- [Download IPA directly]($direct_url)"
  echo "- Source commit: \`$source_sha\`"
  echo "- SHA-256: \`${expected_ipa#sha256:}\`"
  echo "- Release: https://github.com/$repo/releases/tag/$tag"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "Published immutable direct IPA: $direct_url"
