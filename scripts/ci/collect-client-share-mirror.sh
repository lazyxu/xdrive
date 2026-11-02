#!/usr/bin/env bash
# Collect only verified, latest successful client installers. Never rebuild,
# forward CI failures, pull unsigned PR artifacts, or mirror server images.
set -euo pipefail
[[ $# == 1 && -n "${GITHUB_REPOSITORY:-}" && -n "${GH_TOKEN:-}" ]] || {
  echo 'Usage: collect-client-share-mirror.sh OUTPUT_DIR (requires GITHUB_REPOSITORY, GH_TOKEN)' >&2
  exit 2
}
output="$(mkdir -p "$1" && cd "$1" && pwd)"
mkdir -p "$output"/{snapshot,android,ios,meta}
repo="$GITHUB_REPOSITORY"
release_json="$output/meta/snapshot-release.json"
gh api "repos/$repo/releases/tags/snapshot" > "$release_json"

# A floating snapshot is trusted only when the notes and Git ref agree. The
# publish workflow signs/attests exact CI binaries; we verify immutable bytes
# against GitHub's published per-asset digest after downloading.
snapshot_sha="$(jq -er '.body | capture("master at `(?<sha>[a-f0-9]{40})`").sha' "$release_json")"
[[ "$snapshot_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Snapshot source identity' >&2; exit 1; }
verify_snapshot_ref() {
  local actual
  actual="$(gh api "repos/$repo/git/ref/tags/snapshot" --jq '.object.sha')"
  [[ "$actual" == "$snapshot_sha" ]] || {
    echo 'Snapshot tag moved during mirror collection; retry with consistent release' >&2
    exit 1
  }
}
verify_snapshot_ref

# The glob gets the single versioned SPK and checksum without guessing build
# numbers. Exclude source agents, Docker layers, backup CLIs and deploy assets.
gh release download snapshot --repo "$repo" --dir "$output/snapshot" \
  --pattern 'xDriveSetup-amd64.exe' \
  --pattern 'xdrive-linux-amd64.deb' \
  --pattern 'xdrivenas-armada38x-*.spk' \
  --pattern 'xdrivenas-armada38x-*.spk.sha256' \
  --pattern 'SHA256SUMS.txt'
verify_snapshot_ref

verify_release_asset() {
  local filename="$1" expected actual
  expected="$(jq -er --arg n "$filename" \
    '[.assets[] | select(.name == $n) | .digest] | if length == 1 then .[0] else error("release asset missing or duplicate") end' \
    "$release_json")"
  [[ "$expected" =~ ^sha256:[a-f0-9]{64}$ ]] || {
    echo "Missing GitHub SHA256 digest for $filename" >&2; exit 1;
  }
  actual="sha256:$(sha256sum "$output/snapshot/$filename" | cut -d' ' -f1)"
  [[ "$actual" == "$expected" ]] || {
    echo "Snapshot asset SHA256 mismatch: $filename" >&2; exit 1;
  }
}
verify_release_asset 'xDriveSetup-amd64.exe'
verify_release_asset 'xdrive-linux-amd64.deb'
[[ -s "$output/snapshot/SHA256SUMS.txt" ]] || { echo 'Snapshot checksum manifest missing'; exit 1; }
(cd "$output/snapshot"; sha256sum --check --ignore-missing SHA256SUMS.txt)
printf '%s\n' "$snapshot_sha" > "$output/meta/snapshot.sha"

# CLI SPK may be separately successful while the published DSM GUI SPK is
# stale/invalid. Only publish the canonical snapshot SPK after its real GUI,
# signed checksum, tar roots and XZ payload contract pass.
include_dsm=()
shopt -s nullglob
spks=("$output"/snapshot/xdrivenas-armada38x-*.spk)
spk_sums=("$output"/snapshot/xdrivenas-armada38x-*.spk.sha256)
if [[ "${#spks[@]}" == 1 && "${#spk_sums[@]}" == 1 ]]; then
  verify_release_asset "$(basename "${spks[0]}")"
  verify_release_asset "$(basename "${spk_sums[0]}")"
  if bash scripts/ci/verify-synology-spk-release.sh "$output/snapshot" --require-mui; then
    include_dsm=(--include-dsm)
  else
    echo '::warning title=DSM not mirrored::Published DSM GUI SPK failed exact XZ/format verification; Windows/Linux remain eligible.'
  fi
else
  echo '::warning title=DSM not mirrored::Snapshot lacks one unique DSM GUI installer and checksum.'
fi

# Use only artifacts from successful *master push* workflow runs (never PR
# builds). Their exact SHA must match the artifact name and embedded checksums.
collect_mobile() {
  local platform="$1" workflow="$2" prefix="$3" suffix="$4"
  local runs_json run_id sha artifacts name found=''
  runs_json="$(gh api "repos/$repo/actions/workflows/$workflow/runs?branch=master&event=push&status=success&per_page=60")"
  while IFS=$'\t' read -r run_id sha; do
    [[ "$run_id" =~ ^[0-9]+$ && "$sha" =~ ^[0-9a-f]{40}$ ]] || continue
    artifacts="$(gh api "repos/$repo/actions/runs/$run_id/artifacts?per_page=100")"
    name="$(jq -r --arg wanted "${prefix}${sha}" \
      '[.artifacts[] | select(.name == $wanted and .expired == false)] | if length == 1 then .[0].name else empty end' <<< "$artifacts")"
    [[ -n "$name" ]] || continue
    if ! gh run download "$run_id" --repo "$repo" --name "$name" --dir "$output/$platform"; then
      echo "Could not download $platform run $run_id artifact; trying older successful run" >&2
      rm -f "$output/$platform"/*
      continue
    fi
    # Downloaded ZIP is extracted by gh, and the compile workflow provides
    # one *.apk or one *.ipa plus a separately trusted checksum.
    local installers=("$output/$platform"/*"$suffix")
    [[ ${#installers[@]} == 1 ]] || {
      echo "Invalid $platform artifact structure in run $run_id" >&2; exit 1;
    }
    if [[ "$platform" == android ]]; then
      (cd "$output/android"; sha256sum -c SHA256SUMS.txt)
    else
      (cd "$output/ios"; sha256sum -c xDrive-unsigned.ipa.sha256)
    fi
    printf '%s\n' "$sha" > "$output/meta/$platform.sha"
    echo "Selected $platform: $sha from successful master run $run_id"
    found=1
    break
  done < <(jq -r '.workflow_runs[] | [.id,.head_sha] | @tsv' <<< "$runs_json")
  [[ "$found" == 1 ]] || { echo "No nonexpired $platform master installer found" >&2; exit 1; }
}
collect_mobile android android-master-apk.yml xdrive-android-master- '.apk'
collect_mobile ios ios-unsigned-ipa.yml xDrive-iOS-unsigned- '.ipa'

python3 scripts/ci/mirror-clients-to-share.py plan \
  --staging "$output" \
  --manifest "$output/meta/manifest.json" \
  "${include_dsm[@]}"

# The SHA/tag can advance while mobile artifacts are fetched. A snapshot
# mismatch is a retriable failure rather than a silently mixed release.
verify_snapshot_ref
