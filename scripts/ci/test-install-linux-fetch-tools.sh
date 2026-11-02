#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/temps"
cat > "$tmp/bin/apt-get" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
kind=official
for arg in "$@"; do
  case "$arg" in
    Dir::Etc::sourcelist=*)
      kind=mirror
      source_file=${arg#*=}
      grep -Fq 'signed-by=/usr/share/keyrings/debian-archive-keyring.gpg' "$source_file"
      grep -Fq 'https://mirrors.huaweicloud.com/debian ' "$source_file"
      grep -Fq 'https://mirrors.huaweicloud.com/debian-security ' "$source_file"
      ;;
  esac
done
printf '%s %s\n' "$kind" "$*" >> "$APT_TEST_LOG"
case "$APT_TEST_PLAN:$kind:$*" in
  all-fail:*|mirror-update-fails:mirror:*update*|mirror-install-fails:mirror:*install*) exit 100 ;;
esac
SH
chmod +x "$tmp/bin/apt-get"
export PATH="$tmp/bin:$PATH" APT_TEST_LOG="$tmp/apt.log"
export TEMP="$tmp/temps" TMP="$tmp/temps" TMPDIR="$tmp/temps"
# The unit test also runs on GitHub's Ubuntu host; model the pinned Debian
# job image while mocking only APT, never writing host repository settings.
source() {
  if [[ "$1" == /etc/os-release ]]; then
    ID=debian VERSION_CODENAME=bookworm
  else
    builtin source "$@"
  fi
}
export -f source
for plan in mirror-ok mirror-update-fails mirror-install-fails; do
  : > "$APT_TEST_LOG"
  APT_TEST_PLAN="$plan" bash "$ROOT/scripts/ci/install-linux-fetch-tools.sh"
  grep -q '^mirror .*update' "$APT_TEST_LOG"
  if [[ "$plan" == mirror-ok ]]; then
    ! grep -q '^official ' "$APT_TEST_LOG"
  else
    grep -q '^official .*update' "$APT_TEST_LOG"
    grep -q '^official .*install.*xz-utils' "$APT_TEST_LOG"
  fi
  grep -q 'APT::Update::Error-Mode=any' "$APT_TEST_LOG"
  ! grep -Eq -- '--allow-unauthenticated|trusted=yes|Verify-Peer=false' "$APT_TEST_LOG"
  [[ -z "$(ls -A "$tmp/temps")" ]]
done
# Job-specific prerequisites must use the same signed mirror and survive
# fallback. Previously the API job bypassed this helper for PostgreSQL and
# stalled on the official CDN before it could run any tests.
for plan in mirror-ok mirror-update-fails mirror-install-fails; do
  : > "$APT_TEST_LOG"
  APT_TEST_PLAN="$plan" bash "$ROOT/scripts/ci/install-linux-fetch-tools.sh" postgresql-client python3
  expected=mirror
  [[ "$plan" == mirror-ok ]] || expected=official
  grep -q "^$expected .*install.*xz-utils postgresql-client python3" "$APT_TEST_LOG" || {
    echo 'job prerequisites were not installed through the signed APT helper' >&2
    exit 1
  }
  [[ -z "$(ls -A "$tmp/temps")" ]]
done
if APT_TEST_PLAN=all-fail bash "$ROOT/scripts/ci/install-linux-fetch-tools.sh"; then
  echo 'all failed repositories incorrectly reported success' >&2; exit 1
fi
[[ -z "$(ls -A "$tmp/temps")" ]]
echo 'Signed APT mirror success, update/install fallback, failure and temp cleanup passed.'
