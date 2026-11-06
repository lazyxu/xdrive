#!/usr/bin/env bash
# Self-contained CI smoke tests for direct unsigned IPA GitHub Releases.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/artifact" "$tmp/remote"
export MOCK_IOS_RELEASE_STATE="$tmp/remote"
export GITHUB_REPOSITORY="lazyxu/xdrive"
export GITHUB_RUN_ID="12345678"
export GITHUB_STEP_SUMMARY="$tmp/summary.md"
export GH_TOKEN="mock-token"
sha="0123456789abcdef0123456789abcdef01234567"
tag="ios-unsigned-0123456789ab"

cat > "$tmp/bin/gh" <<'PY'
#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

root = Path(os.environ["MOCK_IOS_RELEASE_STATE"])
args = sys.argv[1:]
def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)
if args[:2] == ["release", "view"]:
    sys.exit(0 if (root / args[2]).is_dir() else 1)
if args[:2] == ["release", "create"]:
    tag = args[2]
    target = args[args.index("--target") + 1]
    if (root / tag).exists():
        fail("Duplicate immutable release")
    release = root / tag
    release.mkdir()
    (release / ".source").write_text(target)
    for arg in args[3:]:
        if Path(arg).is_file():
            shutil.copyfile(arg, release / Path(arg).name)
    sys.exit(0)
if args[:1] == ["api"]:
    path = args[1]
    if "/git/ref/tags/" in path:
        tag = path.rsplit("/", 1)[1]
        try:
            ref = (root / tag / ".source").read_text()
        except FileNotFoundError:
            fail("Missing release tag")
        print(ref if "--jq" in args else json.dumps({"object": {"sha": ref}}))
        sys.exit(0)
    if "/releases/tags/" in path:
        tag = path.rsplit("/", 1)[1]
        release = root / tag
        if not release.is_dir():
            fail("Missing release")
        assets = [
            {"name": p.name,
             "digest": "sha256:" + hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in release.iterdir()
            if p.is_file() and not p.name.startswith(".")
        ]
        print(json.dumps({
            "tag_name": tag, "draft": False, "prerelease": True,
            "assets": assets,
        }))
        sys.exit(0)
fail("Unexpected gh command: " + " ".join(args))
PY
chmod +x "$tmp/bin/gh"
cat > "$tmp/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "ls-remote" && "${2:-}" == "--tags" ]]; then
  if [[ "${MOCK_IOS_TAG_EXISTS:-}" == "1" ]]; then
    printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\t%s\n' "${4:-}"
  fi
  exit 0
fi
exec /usr/bin/git "$@"
SH
# Mock may intentionally implement a tag in the remote but no Release.
sed -i 's/\\${/${/g' "$tmp/bin/git"
chmod +x "$tmp/bin/git"
export PATH="$tmp/bin:$PATH"

write_ipa() {
  local identity="${1:-com.lazyxu.xdrive.ios}"
  python3 - "$tmp/artifact/xDrive-unsigned.ipa" "$identity" <<'PY'
import plistlib
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED
path, identity = Path(sys.argv[1]), sys.argv[2]
with ZipFile(path, "w", compression=ZIP_DEFLATED) as z:
    z.writestr("Payload/", b"")
    z.writestr("Payload/xDriveIOS.app/", b"")
    z.writestr("Payload/xDriveIOS.app/Info.plist", plistlib.dumps({
        "CFBundleIdentifier": identity, "CFBundleExecutable": "xDriveIOS"}))
    z.writestr("Payload/xDriveIOS.app/xDriveIOS", b"original iOS fixture binary")
PY
  (cd "$tmp/artifact" && sha256sum xDrive-unsigned.ipa > xDrive-unsigned.ipa.sha256)
}

publish() {
  bash "$root/scripts/ci/publish-ios-unsigned-ipa.sh" "$tmp/artifact" "$sha"
}

write_ipa
publish
test -s "$tmp/remote/$tag/xDrive-unsigned.ipa"
test -s "$tmp/remote/$tag/xDrive-unsigned.ipa.sha256"
cmp "$tmp/artifact/xDrive-unsigned.ipa" "$tmp/remote/$tag/xDrive-unsigned.ipa"
test "$(cat "$tmp/remote/$tag/.source")" = "$sha"
grep -Fq "https://github.com/lazyxu/xdrive/releases/download/$tag/xDrive-unsigned.ipa" "$tmp/summary.md"

# Idempotent retry does not create another release or rewrite the IPA.
publish
test "$(find "$tmp/remote/$tag" -maxdepth 1 -type f | wc -l)" -eq 3

# Local IPA tampering must fail its SHA256 check before touching GitHub.
printf 'tamper' >> "$tmp/artifact/xDrive-unsigned.ipa"
if publish >/dev/null 2>&1; then
  echo "Modified IPA accepted with stale checksum" >&2; exit 1
fi

# Recomputed SHA256 cannot authorize an unexpected bundle identifier.
write_ipa com.attacker.other
if publish >/dev/null 2>&1; then
  echo "Untrusted iOS app identifier accepted" >&2; exit 1
fi

# A matching local source must not reuse a remotely corrupted immutable IPA.
write_ipa
printf 'tamper' >> "$tmp/remote/$tag/xDrive-unsigned.ipa"
if publish >/dev/null 2>&1; then
  echo "Remote tamper was ignored" >&2; exit 1
fi
cp "$tmp/artifact/xDrive-unsigned.ipa" "$tmp/remote/$tag/xDrive-unsigned.ipa"

# A reused tag pointing to a different source must not be accepted.
printf '%040d' 9 > "$tmp/remote/$tag/.source"
if publish >/dev/null 2>&1; then
  echo "Mismatching release commit accepted" >&2; exit 1
fi
printf '%s' "$sha" > "$tmp/remote/$tag/.source"

# Ignore extra untrusted downloads neither as files nor as a signing path.
printf 'untrusted' > "$tmp/artifact/unexpected.zip"
if publish >/dev/null 2>&1; then
  echo "Unexpected package artifact accepted" >&2; exit 1
fi
rm "$tmp/artifact/unexpected.zip"

# Missing GH token fails closed.
if (unset GH_TOKEN; publish) >/dev/null 2>&1; then
  echo "Unsigned IPA publisher accepted missing GitHub token" >&2; exit 1
fi

# Existing tag without release: refuse to overwrite or adopt it.
rm -rf "$tmp/remote/$tag"
if MOCK_IOS_TAG_EXISTS=1 publish >/dev/null 2>&1; then
  echo "Existing tag without immutable Release accepted" >&2; exit 1
fi

echo "iOS direct IPA Release: exact bytes, checksum, identity, idempotence, tamper, tag takeover, and token tests passed."
