#!/usr/bin/env bash
# Optional native builds are published by independent exact-source workflows.
# Include only already-published, same-commit release bytes; never manufacture
# an entry or treat a queued CI artifact as an available installer.
set -euo pipefail
sha="${1:?full source SHA}"
directory="${2:?release directory}"
[[ "$sha" =~ ^[0-9a-f]{40}$ && -d "$directory" ]] || exit 2
repo="${GITHUB_REPOSITORY:-lazyxu/xdrive}"
[[ "$repo" == lazyxu/xdrive ]] || exit 2
for platform in ios android; do
  case "$platform" in
    ios) tag="ios-unsigned-${sha:0:12}"; pattern='xDrive-unsigned.ipa'; checksum='xDrive-unsigned.ipa.sha256' ;;
    android)
      # Android master Debug artifacts are intentionally private Actions artifacts.
      # Only the separately approved, fixed-key signed public android-vN Release
      # can join an immutable Bundle. Its source line must match this full SHA.
      releases="$(gh api --paginate "repos/$repo/releases?per_page=100")" || exit 1
      mapfile -t candidates < <(jq -s -r --arg sha "$sha" '
        .[][] | select(.tag_name | test("^android-v[0-9]+$"))
        | select((.body // "") | contains("Source: " + $sha + " (master)"))
        | select((.body // "") | test("Certificate SHA-256: [a-fA-F0-9]{64}"))
        | .tag_name
      ' <<< "$releases")
      [[ "${#candidates[@]}" -le 1 ]] || { echo "ambiguous same-commit Android signed Releases" >&2; exit 1; }
      if [[ "${#candidates[@]}" == 0 ]]; then
        echo "::notice::No approved exact-commit Android signed APK for $sha; omitting"
        continue
      fi
      tag="${candidates[0]}"; pattern='xdrive-android-*.apk'; checksum='SHA256SUMS.txt' ;;
  esac
  if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    echo "::notice::No published exact-commit $platform package for $sha; omitting"
    continue
  fi
  ref="$(gh api "repos/$repo/git/ref/tags/$tag" --jq '.object.sha')"
  [[ "$ref" == "$sha" ]] || { echo "$platform release tag is not exact $sha" >&2; exit 1; }
  scratch="$(mktemp -d)"
  trap 'rm -rf -- "${scratch:-}"' EXIT
  gh release download "$tag" --repo "$repo" --dir "$scratch" --pattern "$pattern"
  gh release download "$tag" --repo "$repo" --dir "$scratch" --pattern "$checksum"
  find "$scratch" -maxdepth 1 -type l | grep -q . && { echo "symlinked native artifact" >&2; exit 1; }
  (cd "$scratch"; sha256sum -c "$checksum")
  mapfile -t packages < <(find "$scratch" -maxdepth 1 -type f -name "$pattern" -printf '%f\n')
  [[ "${#packages[@]}" == 1 ]] || { echo "ambiguous $platform release payload" >&2; exit 1; }
  name="${packages[0]}"
  [[ -f "$scratch/$name" && ! -e "$directory/$name" ]] || exit 1
  remote_sha="$(gh api "repos/$repo/releases/tags/$tag" --jq ".assets[] | select(.name == \"$name\") | .digest")"
  [[ "$remote_sha" == "sha256:$(sha256sum "$scratch/$name" | cut -d' ' -f1)" ]] || {
    echo "wrong $platform remote digest" >&2; exit 1;
  }
  cp -- "$scratch/$name" "$directory/$name"
  echo "Included published same-commit $platform artifact $name"
  rm -rf -- "$scratch"
  trap - EXIT
done
