#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/xd"
mkdir -p "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/backups/incremental/snapshots" \
  "$XD_CONFIG_DIR/backups/incremental/objects/sha256" "$TMP/bin"
printf 'XD_SERVER_IMAGE=xdrive/server:test\n' > "$XD_CONFIG_DIR/config/.env"
snapshot="$XD_CONFIG_DIR/backups/incremental/snapshots/xdrive-backup-20261027T120000Z"
mkdir -p "$snapshot"
printf 'db' > "$snapshot/database.dump"
printf 'verify' > "$snapshot/verify.json"
printf '{"format_version":2,"consistency_verified":true,"file_data_included":true}\n' > "$snapshot/manifest.json"
: > "$snapshot/objects.index"
: > "$snapshot/legacy.tar"
(cd "$snapshot"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
touch "$XD_CONFIG_DIR/backups/incremental/.backup.lock"
cat > "$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
# Inspect and compose ps are harmless read-only Host discovery. The test
# must prove that no Docker *container* starts on bad input.
if [[ "${1:-}" == run ]]; then
  printf 'DOCKER RUN CALLED\n' >> "$XD_DRILL_TEST_SENTINEL"
fi
exit 10
FAKE
chmod 700 "$TMP/bin/docker"
export XD_DRILL_TEST_SENTINEL="$TMP/docker-invoked"
export PATH="$TMP/bin:$PATH"
manager="$ROOT/scripts/xdrive-server-host.sh"
# The repository Host manager is a 0644 script; invoke it explicitly via Bash.
if bash "$manager" backup drill ../bad > "$TMP/relative.json" 2>/dev/null; then
  echo 'relative path accepted' >&2; exit 1
fi
if bash "$manager" backup drill "$snapshot" --max-mib 9000 >/dev/null 2>&1; then
  echo 'unbounded memory accepted' >&2; exit 1
fi
if bash "$manager" backup drill "$snapshot" --max-mib xyz >/dev/null 2>&1; then
  echo 'malformed memory accepted' >&2; exit 1
fi
[[ ! -e "$XD_DRILL_TEST_SENTINEL" ]]
# Even freshly recomputed SHA256SUMS.txt cannot authorize a Host Docker
# drill when a nested, duplicated or mistyped Manifest spoofs v2/full status.
assert_invalid_drill_manifest() {
  local label="$1" raw="$2" row
  printf '%s\n' "$raw" > "$snapshot/manifest.json"
  (cd "$snapshot"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
  if bash "$manager" backup drill "$snapshot" --max-mib 256 > "$TMP/unsafe-$label.json" 2>/dev/null; then
    echo "ambiguous Manifest authorized offline drill: $label" >&2; exit 1
  fi
  python3 - "$TMP/unsafe-$label.json" <<'PY'
import json,sys
result=json.load(open(sys.argv[1], encoding='utf-8'))
assert result['state']=='failed' and result['failure_category']=='invalid_snapshot_checksum',result
assert result['files_restored'] is False and result['postgresql_restored'] is False,result
assert result['production_verified'] is False,result
PY
  row="$(bash "$manager" backup list | grep -F -- "$snapshot" || true)"
  [[ "$row" == *invalid-manifest* ]] || {
    echo "ambiguous Manifest was listed as a usable backup: $label" >&2; exit 1
  }
  [[ ! -e "$XD_DRILL_TEST_SENTINEL" ]] || {
    echo "invalid Manifest invoked Docker: $label" >&2; exit 1
  }
}
assert_invalid_drill_manifest nested_version '{"format_version":1,"nested":{"format_version":2},"file_data_included":true,"consistency_verified":true}'
assert_invalid_drill_manifest nested_file_data '{"format_version":2,"file_data_included":false,"nested":{"file_data_included":true},"consistency_verified":true}'
assert_invalid_drill_manifest nested_consistency '{"format_version":2,"file_data_included":true,"consistency_verified":false,"nested":{"consistency_verified":true}}'
assert_invalid_drill_manifest duplicate_version '{"format_version":2,"format_version":1,"file_data_included":true,"consistency_verified":true}'
assert_invalid_drill_manifest duplicate_nested '{"format_version":2,"file_data_included":true,"consistency_verified":true,"extra":{"x":1,"x":2}}'
assert_invalid_drill_manifest string_boolean '{"format_version":2,"file_data_included":"true","consistency_verified":true}'
printf '{"format_version":2,"consistency_verified":true,"file_data_included":true}\n' > "$snapshot/manifest.json"
(cd "$snapshot"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
good_row="$(bash "$manager" backup list | grep -F -- "$snapshot" || true)"
[[ "$good_row" == *cas-incremental* ]] || {
  echo 'valid v2 Manifest not recognized by Host list' >&2; exit 1
}
printf 'tampered' >> "$snapshot/database.dump"
if bash "$manager" backup drill "$snapshot" --max-mib 256 > "$TMP/corrupt.json" 2>/dev/null; then
  echo 'corrupt snapshot accepted' >&2; exit 1
fi
python3 - "$TMP/corrupt.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="invalid_snapshot_checksum",x
assert x["production_verified"] is False,x
assert x["files_restored"] is False and x["postgresql_restored"] is False,x
assert "root" not in str(x) and "password" not in str(x),x
PY
[[ ! -e "$XD_DRILL_TEST_SENTINEL" ]]
# A symlinked repository lock fails closed before Docker, regardless of
# whether the target is an ordinary file or looks like a valid backup.
mv "$XD_CONFIG_DIR/backups/incremental/.backup.lock" "$TMP/real-lock"
ln -s "$TMP/real-lock" "$XD_CONFIG_DIR/backups/incremental/.backup.lock"
if bash "$manager" backup drill "$snapshot" > "$TMP/symlink.json" 2>/dev/null; then
  echo 'symlinked repository lock accepted' >&2; exit 1
fi
python3 - "$TMP/symlink.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="invalid_snapshot_checksum",x
PY
[[ ! -e "$XD_DRILL_TEST_SENTINEL" ]]
# An unknown but apparently valid v2 repository must not be mounted.
rogue="$TMP/unknown/snapshots/xdrive-backup-20261027T120000Z"
mkdir -p "$rogue"
if bash "$manager" backup drill "$rogue" > "$TMP/unknown.json" 2>/dev/null; then
  echo 'unknown repository accepted' >&2; exit 1
fi
python3 - "$TMP/unknown.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["failure_category"]=="unsafe_snapshot",x
PY
# Quota must fail before any container is run, not after allocating data.
rm "$XD_CONFIG_DIR/backups/incremental/.backup.lock"
mv "$TMP/real-lock" "$XD_CONFIG_DIR/backups/incremental/.backup.lock"
printf '{"format_version":2,"consistency_verified":true,"file_data_included":true}\n' > "$snapshot/manifest.json"
printf 'db' > "$snapshot/database.dump"
printf '%064d\t%d\n' 0 300000000 > "$snapshot/objects.index"
(cd "$snapshot"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
if bash "$manager" backup drill "$snapshot" --max-mib 256 > "$TMP/quota.json" 2>/dev/null; then
  echo 'overquota v2 snapshot accepted' >&2; exit 1
fi
python3 - "$TMP/quota.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="sandbox_quota_exceeded",x
assert x["production_verified"] is False,x
PY
[[ ! -e "$XD_DRILL_TEST_SENTINEL" ]]
echo 'Host offline drill: source allowlist, checksums, symlink, quota and no-container safety passed'
