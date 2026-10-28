#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/xd"
mkdir -p "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/backups/snapshots" "$TMP/mock-bin"
printf 'XD_SERVER_IMAGE=xdrive/server:test\n' > "$XD_CONFIG_DIR/config/.env"
MANAGER="$ROOT/scripts/xdrive-server-host.sh"
v1="$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20261027T010000Z"
mkdir -p "$v1"
printf 'db-only' > "$v1/database.dump"
printf '{}' > "$v1/verify.json"
printf '{"format_version":1,"file_data_included":false,"consistency_verified":true}\n' > "$v1/manifest.json"
(cd "$v1"; sha256sum database.dump verify.json manifest.json > SHA256SUMS.txt)
bash "$MANAGER" backup verify --json "$v1" > "$TMP/v1-good.json"
python3 - "$TMP/v1-good.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="success" and x["format"]=="v1",x
assert x["cas_objects_checked"]==0 and x["cas_bytes_hashed"]==0,x
assert x["scope"]=="backup_snapshot_and_referenced_cas"
PY
printf 'tamper' >> "$v1/database.dump"
if bash "$MANAGER" backup verify --json "$v1" > "$TMP/v1-bad.json" 2>"$TMP/private.log"; then
  echo 'corrupt v1 backup was accepted' >&2; exit 1
fi
python3 - "$TMP/v1-bad.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="snapshot_verification_failed",x
PY
if grep -Fq "$TMP" "$TMP/v1-bad.json"; then
  echo 'private Host path was sent to JSON stdout' >&2; exit 1
fi
# v1 Host checksum verification must reject omitted, added and symlinked
# members, including when sha256sum -c would accept the remaining entries.
printf 'db-only' > "$v1/database.dump"
(cd "$v1"; sha256sum database.dump verify.json manifest.json > SHA256SUMS.txt)
cp "$v1/SHA256SUMS.txt" "$TMP/v1-complete.sum"
grep -v '  database.dump
v2="$v2root/snapshots/xdrive-backup-20261027T020000Z"
mkdir -p "$v2" "$v2root/objects/sha256"
touch "$v2root/.backup.lock" "$v2/objects.index" "$v2/legacy.tar"
printf 'db-dump' > "$v2/database.dump"
printf '{}' > "$v2/verify.json"
printf '{"format_version":2,"file_data_included":true,"consistency_verified":true}\n' > "$v2/manifest.json"
(cd "$v2"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
cat > "$TMP/mock-bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  compose) exit 0 ;;
  run)
    [[ " $* " == *" --json "* ]] || { echo 'CAS helper did not get --json' >&2; exit 8; }
    case "${XD_MOCK_CAS:-pass}" in
      pass) printf '{"protocol":"xdrive-backup-verify-v1","state":"success","mode":"deep","objects_checked":2,"bytes_hashed":17}\n' ;;
      fail) printf '{"protocol":"xdrive-backup-verify-v1","state":"failed","mode":"deep","objects_checked":1,"bytes_hashed":11,"failure_category":"object_sha256_mismatch"}\n'; exit 17 ;;
      malformed) printf '{"protocol":"fake","state":"success","mode":"deep","objects_checked":2,"bytes_hashed":17}\n' ;;
      *) exit 19 ;;
    esac ;;
  *) echo "Unexpected Docker invocation" >&2; exit 9 ;;
esac
DOCKER
chmod 700 "$TMP/mock-bin/docker"
export PATH="$TMP/mock-bin:$PATH"
bash "$MANAGER" backup verify --json "$v2" > "$TMP/v2-good.json"
python3 - "$TMP/v2-good.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="success" and x["format"]=="v2",x
assert x["cas_objects_checked"]==2 and x["cas_bytes_hashed"]==17,x
PY
if XD_MOCK_CAS=fail bash "$MANAGER" backup verify --json "$v2" > "$TMP/v2-bad.json" 2>"$TMP/private-cas.log"; then
  echo 'corrupt v2 CAS was accepted' >&2; exit 1
fi
python3 - "$TMP/v2-bad.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="object_sha256_mismatch",x
assert x["cas_objects_checked"]==1 and x["cas_bytes_hashed"]==11,x
PY
if XD_MOCK_CAS=malformed bash "$MANAGER" backup verify --json "$v2" > "$TMP/v2-fake.json" 2>"$TMP/private-bad.log"; then
  echo 'untrusted CAS receipt was accepted' >&2; exit 1
fi
python3 - "$TMP/v2-fake.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="invalid_cas_report",x
assert x["cas_objects_checked"]==0 and x["cas_bytes_hashed"]==0,x
PY
if grep -Fq "$TMP" "$TMP/v2-bad.json"; then
  echo 'CAS JSON leaked Host path' >&2; exit 1
fi
if bash "$MANAGER" backup verify --json "$v2" unexpected > "$TMP/extra.json" 2>/dev/null; then
  echo 'extra verify args accepted' >&2; exit 1
fi
echo 'Host JSON backup verify: checksum, CAS stats, failure and privacy passed'
 "$TMP/v1-complete.sum" > "$v1/SHA256SUMS.txt"
if bash "$MANAGER" backup verify --json "$v1" > "$TMP/v1-omitted.json" 2> "$TMP/v1-omitted.log"; then
  echo 'v1 verify accepted omitted database checksum' >&2; exit 1
fi
grep -Fq 'v1 checksum manifest mismatch' "$TMP/v1-omitted.log"
python3 - "$TMP/v1-omitted.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
assert data["state"]=="failed" and data["failure_category"]=="snapshot_verification_failed",data
PY
cp "$TMP/v1-complete.sum" "$v1/SHA256SUMS.txt"
printf 'unexpected' > "$v1/extra.txt"
(cd "$v1"; sha256sum extra.txt >> SHA256SUMS.txt)
if bash "$MANAGER" backup verify "$v1" > "$TMP/v1-extra.log" 2>&1; then
  echo 'v1 verify accepted extra checksum member' >&2; exit 1
fi
grep -Fq 'v1 checksum manifest mismatch' "$TMP/v1-extra.log"
rm -f "$v1/extra.txt"
cp "$TMP/v1-complete.sum" "$v1/SHA256SUMS.txt"

mv "$v1/database.dump" "$v1/database.original"
ln -s "$v1/database.original" "$v1/database.dump"
if bash "$MANAGER" backup verify "$v1" > "$TMP/v1-symlink.log" 2>&1; then
  echo 'v1 verify accepted symlinked database.dump' >&2; exit 1
fi
grep -Fq 'v1 snapshot contains symlink database.dump' "$TMP/v1-symlink.log"
rm "$v1/database.dump"
mv "$v1/database.original" "$v1/database.dump"

v2root="$XD_CONFIG_DIR/backups/incremental"
v2="$v2root/snapshots/xdrive-backup-20261027T020000Z"
mkdir -p "$v2" "$v2root/objects/sha256"
touch "$v2root/.backup.lock" "$v2/objects.index" "$v2/legacy.tar"
printf 'db-dump' > "$v2/database.dump"
printf '{}' > "$v2/verify.json"
printf '{"format_version":2,"file_data_included":true,"consistency_verified":true}\n' > "$v2/manifest.json"
(cd "$v2"; sha256sum database.dump verify.json manifest.json objects.index legacy.tar > SHA256SUMS.txt)
cat > "$TMP/mock-bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  compose) exit 0 ;;
  run)
    [[ " $* " == *" --json "* ]] || { echo 'CAS helper did not get --json' >&2; exit 8; }
    case "${XD_MOCK_CAS:-pass}" in
      pass) printf '{"protocol":"xdrive-backup-verify-v1","state":"success","mode":"deep","objects_checked":2,"bytes_hashed":17}\n' ;;
      fail) printf '{"protocol":"xdrive-backup-verify-v1","state":"failed","mode":"deep","objects_checked":1,"bytes_hashed":11,"failure_category":"object_sha256_mismatch"}\n'; exit 17 ;;
      malformed) printf '{"protocol":"fake","state":"success","mode":"deep","objects_checked":2,"bytes_hashed":17}\n' ;;
      *) exit 19 ;;
    esac ;;
  *) echo "Unexpected Docker invocation" >&2; exit 9 ;;
esac
DOCKER
chmod 700 "$TMP/mock-bin/docker"
export PATH="$TMP/mock-bin:$PATH"
bash "$MANAGER" backup verify --json "$v2" > "$TMP/v2-good.json"
python3 - "$TMP/v2-good.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="success" and x["format"]=="v2",x
assert x["cas_objects_checked"]==2 and x["cas_bytes_hashed"]==17,x
PY
if XD_MOCK_CAS=fail bash "$MANAGER" backup verify --json "$v2" > "$TMP/v2-bad.json" 2>"$TMP/private-cas.log"; then
  echo 'corrupt v2 CAS was accepted' >&2; exit 1
fi
python3 - "$TMP/v2-bad.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="object_sha256_mismatch",x
assert x["cas_objects_checked"]==1 and x["cas_bytes_hashed"]==11,x
PY
if XD_MOCK_CAS=malformed bash "$MANAGER" backup verify --json "$v2" > "$TMP/v2-fake.json" 2>"$TMP/private-bad.log"; then
  echo 'untrusted CAS receipt was accepted' >&2; exit 1
fi
python3 - "$TMP/v2-fake.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x["state"]=="failed" and x["failure_category"]=="invalid_cas_report",x
assert x["cas_objects_checked"]==0 and x["cas_bytes_hashed"]==0,x
PY
if grep -Fq "$TMP" "$TMP/v2-bad.json"; then
  echo 'CAS JSON leaked Host path' >&2; exit 1
fi
if bash "$MANAGER" backup verify --json "$v2" unexpected > "$TMP/extra.json" 2>/dev/null; then
  echo 'extra verify args accepted' >&2; exit 1
fi
echo 'Host JSON backup verify: checksum, CAS stats, failure and privacy passed'
