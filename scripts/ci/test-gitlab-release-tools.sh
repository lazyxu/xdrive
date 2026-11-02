#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/temps"
cat > "$tmp/bin/apk" <<'SH'
#!/usr/bin/env sh
set -eu
printf 'args: %s\n' "$*" >> "$APK_TEST_LOG"
while [ "$#" -gt 0 ]; do
  case "$1" in --repositories-file) repos="$2"; shift ;; esac
  shift
done
cat "$repos" >> "$APK_TEST_LOG"
if grep -q mirror.invalid "$repos" && [ "$APK_TEST_PLAN" != mirror-ok ]; then exit 9; fi
[ "$APK_TEST_PLAN" != all-fail ]
SH
chmod +x "$tmp/bin/apk"
export PATH="$tmp/bin:$PATH" APK_TEST_LOG="$tmp/apk.log"
export TEMP="$tmp/temps" TMP="$tmp/temps" TMPDIR="$tmp/temps"
for plan in mirror-ok mirror-fails; do
  : > "$APK_TEST_LOG"
  APK_TEST_PLAN="$plan" sh "$ROOT/scripts/ci/install-gitlab-release-tools.sh" https://mirror.invalid/alpine 3.22
  grep -q 'https://mirror.invalid/alpine/v3.22/main' "$APK_TEST_LOG"
  grep -q -- '--timeout 20 --no-cache add bash coreutils tar xz jq' "$APK_TEST_LOG"
  ! grep -Eq -- '--allow-untrusted|--no-check-certificate' "$APK_TEST_LOG"
  if [[ "$plan" == mirror-fails ]]; then
    grep -q 'https://dl-cdn.alpinelinux.org/alpine/v3.22/community' "$APK_TEST_LOG"
    [[ "$(grep -c '^args:' "$APK_TEST_LOG")" == 2 ]]
  else
    [[ "$(grep -c '^args:' "$APK_TEST_LOG")" == 1 ]]
  fi
  [[ -z "$(ls -A "$tmp/temps")" ]]
done
if APK_TEST_PLAN=all-fail sh "$ROOT/scripts/ci/install-gitlab-release-tools.sh" https://mirror.invalid/alpine 3.22; then
  echo 'failed package installation must block release publication' >&2; exit 1
fi
for mirror in http://mirror.invalid/alpine 'https://mirror.invalid/alpine?unsafe=1'; do
  : > "$APK_TEST_LOG"
  if APK_TEST_PLAN=mirror-ok sh "$ROOT/scripts/ci/install-gitlab-release-tools.sh" "$mirror" 3.22; then
    echo 'invalid release tool mirror accepted' >&2; exit 1
  fi
  [[ ! -s "$APK_TEST_LOG" ]]
done
[[ -z "$(ls -A "$tmp/temps")" ]]
echo 'Release tool packages, signed mirror/fallback, failure and cleanup verified.'
