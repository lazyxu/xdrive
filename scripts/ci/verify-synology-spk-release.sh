#!/usr/bin/env bash
# Verify the exact single DSM release payload before publication. This file is
# run both on GitHub and GitLab, without production credentials or NAS access.
set -euo pipefail
release_dir="${1:-release}"
[[ -d "$release_dir" ]] || { echo "missing release directory: $release_dir" >&2; exit 1; }
shopt -s nullglob dotglob
spks=("$release_dir"/xdrivenas-armada38x-*.spk)
[[ "${#spks[@]}" -eq 1 && -f "${spks[0]}" && -s "${spks[0]}" && ! -L "${spks[0]}" ]] || {
  echo "expected exactly one real xdrivenas-armada38x SPK" >&2
  exit 1
}
spk="${spks[0]}"
checksum="$spk.sha256"
[[ -f "$checksum" && -s "$checksum" && ! -L "$checksum" ]] || {
  echo "missing/untrusted DSM SPK SHA256 file" >&2
  exit 1
}
for item in "$release_dir"/*.spk "$release_dir"/*.spk.sha256; do
  case "$item" in "$spk"|"$checksum") ;; *) echo "unexpected DSM payload: $item" >&2; exit 1 ;; esac
done
(cd "$release_dir"; sha256sum -c --status "$(basename "$checksum")")
expected_version="${spk##*/xdrivenas-armada38x-}"
expected_version="${expected_version%.spk}"
[[ "$expected_version" =~ ^[0-9]+(\.[0-9]+){1,3}-[0-9]+$ ]] || {
  echo "invalid DSM package asset version" >&2
  exit 1
}
actual_info="$(tar -xOf "$spk" ./INFO)"
grep -Fxq "package=\"xdrivenas\"" <<<"$actual_info"
grep -Fxq "version=\"$expected_version\"" <<<"$actual_info"
grep -Fxq 'arch="armada38x"' <<<"$actual_info"
grep -Fxq 'os_min_ver="7.0-40759"' <<<"$actual_info"
echo "Verified exact DSM SPK and matching SHA256: $(basename "$spk")"
