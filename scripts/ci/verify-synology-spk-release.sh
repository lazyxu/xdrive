#!/usr/bin/env bash
# Verify the exact single DSM release payload before publication. This file is
# run both on GitHub and GitLab, without production credentials or NAS access.
set -euo pipefail
release_dir="${1:-release}"
# CLI-only SPKs remain testable; published DSM SPKs must include the shared UI.
required_flavor="${2:-}"
[[ "$required_flavor" == "" || "$required_flavor" == "--require-mui" ]] || {
  echo "unknown DSM release verification mode: $required_flavor" >&2; exit 2;
}
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
if [[ "$required_flavor" == "--require-mui" ]]; then
  grep -Fxq 'dsmuidir="ui"' <<<"$actual_info" || {
    echo "published DSM SPK lacks registered graphical UI" >&2; exit 1;
  }
  grep -Fxq 'dsmappname="com.xdrive.NASBackup"' <<<"$actual_info" || {
    echo "published DSM SPK lacks shared UI identity" >&2; exit 1;
  }
  # Inspect the real nested archive; INFO metadata alone is not sufficient.
  # Source-exact Go binaries, bundled UI and CGI bytes are verified separately.
  payload_entries="$(tar -xOf "$spk" ./package.tgz | tar -tzf -)" || {
    echo "published DSM GUI payload cannot be read" >&2; exit 1;
  }
  for required in ./ui/config ./ui/backup.cgi ./ui/synology.html; do
    grep -Fxq "$required" <<<"$payload_entries" || {
      echo "published DSM GUI payload missing $required" >&2; exit 1;
    }
  done
  grep -Eq '^[.]/ui/assets/.+[.]js$' <<<"$payload_entries" || {
    echo "published DSM GUI payload lacks compiled JavaScript" >&2; exit 1;
  }
fi
echo "Verified exact DSM SPK and matching SHA256: $(basename "$spk")"
