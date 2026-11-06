#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/release" "$tmp/package" "$tmp/payload/bin" \
  "$tmp/payload/ui/assets" "$tmp/bin" "$tmp/remote"

cat > "$tmp/payload/ui/config" <<'JSON'
{".url":{"com.xdrive.NASBackup":{"type":"url","url":"/webman/3rdparty/xdrivenas/synology.html"}}}
JSON
printf 'fixture' > "$tmp/payload/bin/xd"
printf 'fixture' > "$tmp/payload/bin/xdrive-agent"
printf 'fixture' > "$tmp/payload/ui/backup.cgi"
printf 'fixture' > "$tmp/payload/ui/synology.html"
printf 'fixture' > "$tmp/payload/ui/assets/app.js"
spk() {
  local version="$1"
  cat > "$tmp/package/INFO" <<INFO
package="xdrivenas"
version="$version"
arch="armada38x"
os_min_ver="7.0-40759"
dsmuidir="ui"
dsmappname="com.xdrive.NASBackup"
INFO
  tar -C "$tmp/payload" -cJf "$tmp/package/package.tgz" bin ui
  rm -f "$tmp/release"/*.spk "$tmp/release"/*.spk.sha256
  tar --format=ustar -C "$tmp/package" \
    -cf "$tmp/release/xdrivenas-armada38x-$version.spk" INFO package.tgz
  (cd "$tmp/release"; sha256sum "xdrivenas-armada38x-$version.spk" > "xdrivenas-armada38x-$version.spk.sha256")
}

cat > "$tmp/bin/gh" <<'PY'
#!/usr/bin/env python3
import hashlib, json, os, pathlib, shutil, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ["MOCK_GH_STATE"])
def assets(tag):
    directory = root / tag
    return [{"name": p.name, "digest": "sha256:" + hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(directory.iterdir()) if p.is_file() and not p.name.startswith(".")]
if args[:2] == ["release", "view"]:
    sys.exit(0 if (root / args[2]).is_dir() else 1)
if args[:2] == ["release", "create"]:
    tag = args[2]
    target = args[args.index("--target") + 1]
    d = root / tag
    if d.exists():
        sys.exit("Duplicate immutable release")
    d.mkdir()
    (d / ".commit").write_text(target)
    for filename in args[3:]:
        if not filename.startswith("--") and os.path.isfile(filename):
            shutil.copy2(filename, d / pathlib.Path(filename).name)
    sys.exit()
if args[:2] == ["release", "upload"]:
    tag = args[2]
    if not (root / tag).exists():
        sys.exit("Missing release")
    shutil.copy2(args[3], root / tag / pathlib.Path(args[3]).name)
    sys.exit()
if args[:2] == ["release", "download"]:
    tag = args[2]
    directory = pathlib.Path(args[args.index("--dir") + 1])
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / tag / "catalog.json", directory / "catalog.json")
    sys.exit()
if args[:1] == ["api"]:
    route = args[1]
    if "/releases/tags/" in route:
        tag = route.rsplit("/", 1)[1]
        print(json.dumps({"assets": assets(tag)}))
        sys.exit()
    if "/git/ref/tags/" in route:
        tag = route.rsplit("/", 1)[1]
        sha = (os.environ["MOCK_SNAPSHOT"] if tag == "snapshot"
               else (root / tag / ".commit").read_text())
        print(sha if "--jq" in args else json.dumps({"object": {"sha": sha}}))
        sys.exit()
sys.exit("Unexpected gh command: " + " ".join(args))
PY
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH" GH_TOKEN=fixture MOCK_GH_STATE="$tmp/remote"
one="0123456789abcdef0123456789abcdef01234567"
two="1123456789abcdef0123456789abcdef01234567"
export MOCK_SNAPSHOT="$one"

spk 0.1.0-9000
bash scripts/ci/publish-dsm-package-source.sh edge "$tmp/release" "$one"
python3 - "$tmp/remote/dsm-edge-feed/catalog.json" "$one" <<'PY'
import json, sys
with open(sys.argv[1]) as f: data = json.load(f)
assert data["commit"] == sys.argv[2]
assert data["version"] == "0.1.0-9000"
assert data["package"] == "xdrivenas" and data["arch"] == "armada38x"
assert data["link"].startswith("https://github.com/lazyxu/xdrive/releases/download/dsm-edge-")
assert data["sha256"] and data["md5"] and data["size"] > 1000
PY
bash scripts/ci/publish-dsm-package-source.sh edge "$tmp/release" "$one"

# Older version must not replace a published newer one, even if correctly hashed.
spk 0.1.0-8999
if bash scripts/ci/publish-dsm-package-source.sh edge "$tmp/release" "$one" >/dev/null 2>&1; then
  echo "DSM version rollback unexpectedly admitted" >&2; exit 1
fi

# An earlier master publisher must not move the edge feed after Snapshot advanced.
spk 0.1.0-9001
MOCK_SNAPSHOT="$two" bash scripts/ci/publish-dsm-package-source.sh edge "$tmp/release" "$one"
grep -Fq '"version":"0.1.0-9000"' "$tmp/remote/dsm-edge-feed/catalog.json"

# Stable and edge are different channels; a stable release does not modify edge.
bash scripts/ci/publish-dsm-package-source.sh stable "$tmp/release" "$two"
test -f "$tmp/remote/dsm-stable-feed/catalog.json"
grep -Fq '"version":"0.1.0-9000"' "$tmp/remote/dsm-edge-feed/catalog.json"

# Mutated package bytes must be rejected even when its version remains constant.
printf 'tamper' >> "$tmp/release/xdrivenas-armada38x-0.1.0-9001.spk"
if bash scripts/ci/publish-dsm-package-source.sh stable "$tmp/release" "$two" >/dev/null 2>&1; then
  echo "tampered package was published" >&2; exit 1
fi
echo "DSM immutable SPK publisher: edge/stable, monotonicity, stale master and tamper checks passed."
