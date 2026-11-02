#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/temps"
cat > "$tmp/bin/apk" <<'SH'
#!/usr/bin/env sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in --repositories-file) repos="$2"; shift ;; esac
  shift
done
cat "$repos" >> "$APK_TEST_LOG"
if grep -q mirror.invalid "$repos" && [ "$APK_TEST_PLAN" != mirror-ok ]; then exit 9; fi
[ "$APK_TEST_PLAN" != all-fail ]
SH
chmod +x "$tmp/bin/apk"
export PATH="$tmp/bin:$PATH" APK_TEST_LOG="$tmp/repositories"
export TEMP="$tmp/temps" TMP="$tmp/temps" TMPDIR="$tmp/temps"
for plan in mirror-ok mirror-fails; do
  : > "$APK_TEST_LOG"
  APK_TEST_PLAN="$plan" sh "$ROOT/deploy/install-media-worker-ffmpeg.sh" https://mirror.invalid/alpine 3.22
  grep -q 'https://mirror.invalid/alpine/v3.22/main' "$APK_TEST_LOG"
  if [[ "$plan" == mirror-fails ]]; then
    grep -q 'https://dl-cdn.alpinelinux.org/alpine/v3.22/community' "$APK_TEST_LOG"
  else
    ! grep -q dl-cdn.alpinelinux.org "$APK_TEST_LOG"
  fi
  [[ -z "$(ls -A "$tmp/temps")" ]]
done
if APK_TEST_PLAN=all-fail sh "$ROOT/deploy/install-media-worker-ffmpeg.sh" https://mirror.invalid/alpine 3.22; then
  echo 'both APK sources failing must not pass the image build' >&2; exit 1
fi
if APK_TEST_PLAN=mirror-ok sh "$ROOT/deploy/install-media-worker-ffmpeg.sh" http://mirror.invalid/alpine 3.22; then
  echo 'non-HTTPS mirror accepted' >&2; exit 1
fi
[[ -z "$(ls -A "$tmp/temps")" ]]
echo 'FFmpeg APK mirror, official fallback, failure and cleanup verified.'
