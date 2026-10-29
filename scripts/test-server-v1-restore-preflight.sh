#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/xd"
export XD_RESTORE_TEST_DOCKER_SENTINEL="$TMP/docker-invoked"
mkdir -p "$XD_CONFIG_DIR/config" "$TMP/bin" "$TMP/snapshot"
: > "$XD_CONFIG_DIR/config/docker-compose.yml"
: > "$XD_CONFIG_DIR/config/.env"
BACKUP_DIR="$TMP/snapshot"
RESTORE="$ROOT/scripts/server-restore.sh"
export PATH="$TMP/bin:$PATH"
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
if [[ "${1:-}" == run && " $* " == *" --entrypoint pg_restore "* ]]; then
  printf 'read-only pg_restore list\n' >> "$XD_RESTORE_TEST_DOCKER_SENTINEL"
  head -c 5 | grep -q '^PGDMP' || exit 87
  exit 0
fi
printf 'docker invoked\n' >> "$XD_RESTORE_TEST_DOCKER_SENTINEL"
exit 77
MOCK
chmod 700 "$TMP/bin/docker"

printf 'PGDMPdatabase fixture\n' > "$BACKUP_DIR/database.dump"
printf '{"checks":[],"ok":true}\n' > "$BACKUP_DIR/verify.json"
printf '{"format_version":1,"consistency_verified":true,"file_data_included":true}\n' > "$BACKUP_DIR/manifest.json"

write_archive() {
  python3 - "$BACKUP_DIR/blobs.tar" "$1" <<'PY'
import io, sys, tarfile
path, scenario = sys.argv[1:3]
def entry(archive, name, kind="file", content=b"file", link=""):
    item=tarfile.TarInfo(name)
    if kind=="file":
        item.size=len(content)
        archive.addfile(item,io.BytesIO(content))
    elif kind=="dir":
        item.type=tarfile.DIRTYPE
        archive.addfile(item)
    elif kind=="sym":
        item.type=tarfile.SYMTYPE
        item.linkname=link
        archive.addfile(item)
    elif kind=="hard":
        item.type=tarfile.LNKTYPE
        item.linkname=link
        archive.addfile(item)
    elif kind=="fifo":
        item.type=tarfile.FIFOTYPE
        archive.addfile(item)
with tarfile.open(path,"w") as archive:
    if scenario=="valid":
        entry(archive,"./a.txt")
        entry(archive,"./folder/","dir")
        entry(archive,"./folder/b.txt")
        entry(archive,"./also-a.txt","hard",link="./a.txt")
    elif scenario=="parent_traversal":
        entry(archive,"../outside")
    elif scenario=="absolute":
        entry(archive,"/tmp/outside")
    elif scenario=="symlink":
        entry(archive,"./link","sym",link="../../etc")
    elif scenario=="duplicate":
        entry(archive,"./same")
        entry(archive,"././same")
    elif scenario=="ancestor":
        entry(archive,"./parent")
        entry(archive,"./parent/child")
    elif scenario=="descendant_first":
        entry(archive,"./parent/child")
        entry(archive,"./parent")
    elif scenario=="hardlink_escape":
        entry(archive,"./outside-link","hard",link="../outside")
    elif scenario=="fifo":
        entry(archive,"./special","fifo")
    else:
        raise SystemExit("unknown archive test scenario")
PY
}
write_checksums() {
  (cd "$BACKUP_DIR"; sha256sum database.dump verify.json manifest.json blobs.tar > SHA256SUMS.txt)
}
assert_fail_closed() {
  local label="$1" message="$2"
  rm -f -- "$XD_RESTORE_TEST_DOCKER_SENTINEL"
  if bash "$RESTORE" "$BACKUP_DIR" --config-dir "$XD_CONFIG_DIR" --yes --no-safety-backup >"$TMP/$label.log" 2>&1; then
    echo "unsafe v1 restore preflight accepted $label" >&2
    exit 1
  fi
  grep -Fq "$message" "$TMP/$label.log" || {
    echo "unexpected rejection for $label:" >&2
    cat "$TMP/$label.log" >&2
    exit 1
  }
  [[ ! -e "$XD_RESTORE_TEST_DOCKER_SENTINEL" ]] || {
    echo "unsafe archive $label reached Docker or destructive restore" >&2
    exit 1
  }
}

# Valid archive, including a canonical internal hardlink, passes preflight:
# the test's deliberately failing docker shim proves entry past the safety gate.
write_archive valid
write_checksums
if bash "$RESTORE" "$BACKUP_DIR" --config-dir "$XD_CONFIG_DIR" --yes --no-safety-backup >"$TMP/valid.log" 2>&1; then
  echo "fake Docker unexpectedly allowed real restore" >&2; exit 1
fi
[[ -s "$XD_RESTORE_TEST_DOCKER_SENTINEL" ]] || {
  echo "valid v1 archive was rejected before normal restore" >&2
  cat "$TMP/valid.log" >&2
  exit 1
}

for scenario in parent_traversal absolute symlink duplicate ancestor descendant_first hardlink_escape fifo; do
  write_archive "$scenario"
  write_checksums
  assert_fail_closed "$scenario" 'unsafe v1 tar archive entry'
done

# A correct checksum cannot make an ambiguous or syntactically invalid
# Manifest safe. These must fail before any Docker call, not simply fail
# later when selecting v1/v2 archives or opening the recovery database.
write_archive valid
assert_bad_manifest() {
  local label="$1" contents="$2"
  printf '%s\n' "$contents" > "$BACKUP_DIR/manifest.json"
  write_checksums
  assert_fail_closed "$label" 'invalid or unsafe backup manifest'
}
assert_bad_manifest manifest_missing_version '{"file_data_included":true}'
assert_bad_manifest manifest_version_string '{"format_version":"1","file_data_included":true}'
assert_bad_manifest manifest_version_boolean '{"format_version":true,"file_data_included":true}'
assert_bad_manifest manifest_version_unknown '{"format_version":3,"file_data_included":true}'
assert_bad_manifest manifest_duplicate_version '{"format_version":1,"format_version":2,"file_data_included":true}'
assert_bad_manifest manifest_duplicate_nested '{"format_version":1,"database":{"file":"a","file":"b"}}'
assert_bad_manifest manifest_trailing_garbage '{"format_version":1} {"other":true}'
assert_bad_manifest manifest_nonstandard_number '{"format_version":1,"other":NaN}'
assert_bad_manifest manifest_invalid_boolean '{"format_version":1,"file_data_included":"true"}'
assert_bad_manifest manifest_full_from_db_only '{"format_version":1,"file_data_included":false}'
python3 - "$BACKUP_DIR/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1], 'w', encoding='utf-8') as out:
    json.dump({'format_version': 1, 'padding': 'a' * 65536}, out)
PY
write_checksums
assert_fail_closed manifest_too_large 'invalid or unsafe backup manifest'

# Do not follow symlinks or wait on a FIFO masquerading as the Manifest.
printf '{"format_version":1,"consistency_verified":true,"file_data_included":true}\n' > "$BACKUP_DIR/manifest.json"
mv "$BACKUP_DIR/manifest.json" "$BACKUP_DIR/manifest.original"
ln -s "$BACKUP_DIR/manifest.original" "$BACKUP_DIR/manifest.json"
assert_fail_closed manifest_symlink 'invalid or unsafe backup manifest'
rm -- "$BACKUP_DIR/manifest.json"
mkfifo "$BACKUP_DIR/manifest.json"
assert_fail_closed manifest_fifo 'invalid or unsafe backup manifest'
rm -- "$BACKUP_DIR/manifest.json"
mv "$BACKUP_DIR/manifest.original" "$BACKUP_DIR/manifest.json"
write_checksums

# GNU sha256sum -c accepts partial lists; v1 restore must not.
write_archive valid
write_checksums
grep -v '  blobs.tar$' "$BACKUP_DIR/SHA256SUMS.txt" > "$TMP/missing-blobs.sum"
mv "$TMP/missing-blobs.sum" "$BACKUP_DIR/SHA256SUMS.txt"
assert_fail_closed missing_checksum 'v1 checksum manifest mismatch'

# Symlinked backup metadata is rejected even if checksum content would match.
write_checksums
mv "$BACKUP_DIR/database.dump" "$BACKUP_DIR/database.original"
ln -s "$BACKUP_DIR/database.original" "$BACKUP_DIR/database.dump"
assert_fail_closed symlinked_database 'v1 snapshot contains symlink database.dump'
rm "$BACKUP_DIR/database.dump"
mv "$BACKUP_DIR/database.original" "$BACKUP_DIR/database.dump"

# A checksum-valid but unparseable PostgreSQL dump must fail the
# pg_restore list phase before any Compose/service/database action.
write_archive valid
printf 'NOT-A-PG-DUMP\n' > "$BACKUP_DIR/database.dump"
write_checksums
rm -f -- "$XD_RESTORE_TEST_DOCKER_SENTINEL"
if bash "$RESTORE" "$BACKUP_DIR" --config-dir "$XD_CONFIG_DIR" --yes --no-safety-backup >"$TMP/invalid-pgdump.log" 2>&1; then
  echo "invalid PostgreSQL archive entered restore" >&2; exit 1
fi
grep -Fq 'PostgreSQL custom dump preflight failed' "$TMP/invalid-pgdump.log"
[[ "$(cat "$XD_RESTORE_TEST_DOCKER_SENTINEL")" == 'read-only pg_restore list' ]] || {
  echo "invalid PostgreSQL archive reached destructive Docker/Compose operations" >&2
  exit 1
}
printf 'PGDMPdatabase fixture\n' > "$BACKUP_DIR/database.dump"
write_checksums

# Legacy database-only snapshots retain a separately authorized recovery path.
rm "$BACKUP_DIR/blobs.tar"
printf '{"format_version":1,"consistency_verified":true,"file_data_included":false}\n' > "$BACKUP_DIR/manifest.json"
(cd "$BACKUP_DIR"; sha256sum database.dump verify.json manifest.json > SHA256SUMS.txt)
rm -f -- "$XD_RESTORE_TEST_DOCKER_SENTINEL"
if bash "$RESTORE" "$BACKUP_DIR" --config-dir "$XD_CONFIG_DIR" --yes --no-safety-backup --database-only >"$TMP/db-only.log" 2>&1; then
  echo "fake Docker unexpectedly allowed database-only restore" >&2; exit 1
fi
[[ -s "$XD_RESTORE_TEST_DOCKER_SENTINEL" ]] || {
  echo "legacy database-only restore preflight regressed" >&2
  cat "$TMP/db-only.log" >&2
  exit 1
}

# A valid v2 Manifest must select the locked repository path and pass
# the same read-only PostgreSQL TOC preflight. Our Docker shim then fails
# safely at the CAS helper instead of touching any real service/database.
BACKUP_DIR="$TMP/v2-repository/snapshots/xdrive-backup-20261029T010000Z"
mkdir -p "$BACKUP_DIR"
: > "$TMP/v2-repository/.backup.lock"
printf 'PGDMPdatabase fixture\n' > "$BACKUP_DIR/database.dump"
printf '{"checks":[],"ok":true}\n' > "$BACKUP_DIR/verify.json"
printf '{"format_version":2,"consistency_verified":true,"file_data_included":true}\n' > "$BACKUP_DIR/manifest.json"
: > "$BACKUP_DIR/objects.index"
: > "$BACKUP_DIR/legacy.tar"
(cd "$BACKUP_DIR"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
rm -f -- "$XD_RESTORE_TEST_DOCKER_SENTINEL"
if bash "$RESTORE" "$BACKUP_DIR" --config-dir "$XD_CONFIG_DIR" --yes --no-safety-backup >"$TMP/valid-v2.log" 2>&1; then
  echo 'fake Docker unexpectedly allowed v2 recovery' >&2; exit 1
fi
[[ -s "$XD_RESTORE_TEST_DOCKER_SENTINEL" ]] &&
  grep -Fq 'read-only pg_restore list' "$XD_RESTORE_TEST_DOCKER_SENTINEL" || {
  echo 'valid v2 manifest was rejected before PostgreSQL archive inspection' >&2
  cat "$TMP/valid-v2.log" >&2
  exit 1
}
printf '{"format_version":2,"format_version":1,"file_data_included":true}\n' > "$BACKUP_DIR/manifest.json"
(cd "$BACKUP_DIR"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
assert_fail_closed manifest_v2_duplicate_version 'invalid or unsafe backup manifest'

echo 'v1/v2 restore manifest, checksum, tar and database-only fail-closed preflights passed'
