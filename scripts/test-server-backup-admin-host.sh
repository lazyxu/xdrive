#!/usr/bin/env bash
set -euo pipefail
umask 077
# GitHub's server-validation job normally suppresses expected Host errors.
# Report the actual failing contract assertion without dumping private logs,
# file contents, environment variables, tokens or backup paths.
trap 'rc=$?; printf "admin backup Host contract failed at line %s (exit %s)\n" "$LINENO" "$rc" >&2' ERR

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XD_CONFIG_DIR="$TMP/xd"
export XD_HOST_CONTROL_SOURCE_ONLY=1
export XD_BACKUP_ADMIN_TEST_LOG="$TMP/manager-argv"
mkdir -p "$XD_CONFIG_DIR/config" "$XD_CONFIG_DIR/bin" "$XD_CONFIG_DIR/backups/snapshots" \
  "$XD_CONFIG_DIR/backups/incremental/snapshots" "$XD_CONFIG_DIR/state" "$XD_CONFIG_DIR/logs"
printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_RETENTION_DAYS=7\n' > "$XD_CONFIG_DIR/config/.env"

cat > "$XD_CONFIG_DIR/bin/xdrive-server" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$XD_BACKUP_ADMIN_TEST_LOG"
if [[ "$1" == backup && "$2" == delete-snapshot ]]; then
  shift 2
  selected=""
  repository=""
  yes=0
  while (( $# > 0 )); do
    case "$1" in
      --snapshot) selected="$2"; shift 2 ;;
      --repository-dir) repository="$2"; shift 2 ;;
      --yes) yes=1; shift ;;
      *) exit 2 ;;
    esac
  done
  [[ "$yes" == 1 && "$selected" =~ ^xdrive-backup-[0-9]{8}T[0-9]{6}Z$ &&
     "$repository" == "$XD_CONFIG_DIR/backups/incremental" ]] || exit 2
  if [[ "${XD_BACKUP_ADMIN_TEST_DELETE_NOOP:-}" == yes ]]; then exit 0; fi
  for f in database.dump verify.json manifest.json SHA256SUMS.txt legacy.tar objects.index; do
    rm -f -- "$repository/snapshots/$selected/$f"
  done
  rmdir -- "$repository/snapshots/$selected"
  if [[ "${XD_BACKUP_ADMIN_TEST_DELETE_FAKE:-}" == yes ]]; then
    printf '{"mode":"manual_selected","keep_last":1,"retired_snapshots":["wrong-snapshot"],"recovered_transactions":0,"deleted_cas_objects":0,"deleted_cas_logical_bytes":0,"deleted_snapshot_files":6,"deleted_snapshot_file_bytes":30,"verification":"metadata_only","automatic":false}\n'
    exit 0
  fi
  printf '{"mode":"manual_selected","keep_last":1,"retired_snapshots":["%s"],"recovered_transactions":0,"deleted_cas_objects":1,"deleted_cas_logical_bytes":12,"deleted_snapshot_files":6,"deleted_snapshot_file_bytes":30,"verification":"exclusive_lock_and_full_cas_sha256","automatic":false}\n' "$selected"
  exit 0
fi
if [[ "$1" == backup && "$2" == preview-delete-snapshot ]]; then
  if [[ "${XD_BACKUP_ADMIN_TEST_BAD_SELECTED_PREVIEW:-}" == bad ]]; then
    printf '{"protocol":"wrong","delete_enabled":true}\n'
    exit 0
  fi
  name=""
  mode=""
  while (( $# > 0 )); do
    case "$1" in
      --snapshot) name="$2"; shift 2 ;;
      --mode) mode="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  validation=snapshot_sha256_and_cas_size
  hashed_objects=0
  hashed_bytes=0
  if [[ "$mode" == deep ]]; then
    validation=snapshot_sha256_and_full_cas_sha256
    hashed_objects=3
    hashed_bytes=350
    if [[ "${XD_BACKUP_ADMIN_TEST_BAD_SELECTED_PREVIEW:-}" == missing_hash ]]; then
      hashed_objects=0
      hashed_bytes=0
    fi
  fi
  printf '{"protocol":"xdrive-backup-selected-prune-plan-v1","mode":"read_only","validation":"%s","snapshot":"%s","committed_snapshots":2,"surviving_snapshots":1,"selected_snapshot_bytes":100,"selected_cas_objects":2,"shared_cas_objects":1,"exclusive_cas_objects":1,"exclusive_cas_bytes":200,"unreferenced_objects":1,"unreferenced_bytes":30,"potential_logical_bytes":330,"hashed_objects":%s,"hashed_bytes":%s,"delete_enabled":false}\n' "$validation" "$name" "$hashed_objects" "$hashed_bytes"
  exit 0
fi
if [[ "$1" == backup && "$2" == drill ]]; then
  name="$(basename -- "${3:-}")"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "${XD_BACKUP_ADMIN_TEST_DRILL_BAD:-}" == bad ]]; then
    printf '{"protocol":"fake","state":"success"}\n'
    exit 0
  fi
  printf '{"protocol":"xdrive-host-isolated-drill-v1","state":"success","environment":"host_ephemeral_offline_tmpfs","snapshot":"%s","started_at":"%s","finished_at":"%s","files_restored":true,"postgresql_restored":true,"production_verified":false,"max_mib":1024,"failure_category":""}\n' "$name" "$now" "$now"
  exit 0
fi
if [[ "$1" == backup && "$2" == verify && "${3:-}" == --json ]]; then
  if [[ "${4:-}" == "$XD_CONFIG_DIR/backups/snapshots/"* ]]; then
    printf '{"protocol":"xdrive-host-backup-verify-v1","state":"success","format":"v1","scope":"backup_snapshot_and_referenced_cas","cas_objects_checked":0,"cas_bytes_hashed":0}\n'
    exit 0
  fi
  if [[ "${4:-}" == "${XD_BACKUP_ADMIN_TEST_BAD_VERIFY:-/unreachable}" ]]; then
    printf '{"protocol":"xdrive-host-backup-verify-v1","state":"failed","format":"v2","scope":"backup_snapshot_and_referenced_cas","cas_objects_checked":1,"cas_bytes_hashed":11,"failure_category":"object_sha256_mismatch"}\n'
    exit 22
  fi
  printf '{"protocol":"xdrive-host-backup-verify-v1","state":"success","format":"v2","scope":"backup_snapshot_and_referenced_cas","cas_objects_checked":2,"cas_bytes_hashed":17}\n'
  exit 0
fi
if [[ "$1" == backup && "$2" == verify && "${3:-}" == "${XD_BACKUP_ADMIN_TEST_BAD_VERIFY:-/unreachable}" ]]; then
  exit 22
fi
if [[ "$1" == backup && "$2" == retention-plan ]]; then
  if [[ " $* " == *" --mode deep "* ]]; then
    validation=snapshot_sha256_and_full_cas_sha256
    keep_last=1
    [[ "${XD_BACKUP_ADMIN_TEST_FAKE_DEEP:-}" != fast ]] || validation=snapshot_sha256_and_cas_size
  else
    validation=snapshot_sha256_and_cas_size
    keep_last=2
  fi
  printf '{"mode":"read_only","validation":"%s","keep_last":%s,"committed_snapshots":1,"keep_snapshots":["xdrive-backup-20261027T030000Z"],"drop_candidates":[],"retained_objects":1,"drop_only_objects":0,"unreferenced_objects":0,"drop_only_object_bytes":0,"unreferenced_bytes":0,"drop_snapshot_bytes":0,"potential_logical_bytes":0,"delete_enabled":false,"warning":"read-only","hashed_objects":0,"hashed_bytes":0}\n' "$validation" "$keep_last"
fi
FAKE
chmod 700 "$XD_CONFIG_DIR/bin/xdrive-server"
source "$ROOT/scripts/server-control.sh"

fixture() {
  local root="$1" fmt="$2" name="$3"
  local snapshot="$root/$name" filename
  mkdir -p "$snapshot"
  for filename in database.dump verify.json manifest.json SHA256SUMS.txt; do
    printf '%s' ok > "$snapshot/$filename"
  done
  if [[ "$fmt" == v2 ]]; then
    touch "$snapshot/legacy.tar" "$snapshot/objects.index"
    printf '{"format_version":2,"consistency_verified":true}\n' > "$snapshot/manifest.json"
  else
    touch "$snapshot/blobs.tar"
    printf '{"format_version":1,"consistency_verified":true}\n' > "$snapshot/manifest.json"
  fi
}
v1="xdrive-backup-20261026T010000Z"
v2="xdrive-backup-20261027T030000Z"
fixture "$XD_CONFIG_DIR/backups/snapshots" v1 "$v1"
fixture "$XD_CONFIG_DIR/backups/incremental/snapshots" v2 "$v2"

dir="$(prepare_dir)"
backup_admin_inventory "$dir"
python3 - "$dir/backup-admin-inventory.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
assert d["protocol"]=="xdrive-backup-admin-v1"
assert d["policy"]["schedule_format"]=="v2"
assert len(d["policy"]["revision"])==64
assert sorted(x["id"] for x in d["snapshots"])==[
    "v1:xdrive-backup-20261026T010000Z",
    "v2-default:xdrive-backup-20261027T030000Z",
]
assert all(x["state"]=="complete" and x["file_data_included"] for x in d["snapshots"])
PY

write_request() {
  python3 - "$dir/backup-admin-request.json" "$1" "$2" "$3" "$4" "$5" "$6" "${7:-}" <<'PY'
import datetime,json,sys,uuid
path,action,snapshot,fmt,mode,keep,confirm,preview_id=sys.argv[1:]
request={
  "protocol":"xdrive-backup-admin-v1",
  "request_id":uuid.uuid4().hex[:24],
  "action":action,
  "snapshot_id":snapshot,
  "format":fmt,
  "mode":mode,
  "keep_last":int(keep or 0),
  "confirmation":confirm,
  "created_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
if preview_id: request["preview_request_id"]=preview_id
with open(path,"w",encoding="utf-8") as out:
    json.dump(request,out,separators=(",",":"))
PY
}

# A request that contains no path or shell argument is converted into exactly
# the fixed host verify command for the selected committed generation.
write_request verify "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
grep -Fq "backup verify --json $XD_CONFIG_DIR/backups/incremental/snapshots/$v2" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq "backup retention-plan --repository-dir $XD_CONFIG_DIR/backups/incremental --keep-last 1 --mode deep" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
[[ ! -e "$dir/backup-admin-active.json" ]]
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
v=e["verification"]
assert e["action"]=="verify" and e["state"]=="success",e
assert v["protocol"]=="xdrive-host-backup-verify-v1" and v["state"]=="success",v
assert v["cas_objects_checked"]==2 and v["cas_bytes_hashed"]==17,v
assert "path" not in v and "hash" not in v,v
PY

 
# The selected v2 preview is a Host-resolved, read-only inspection. A forged
# success stdout must fail and cannot become an administrator success receipt.
write_request preview_delete "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
grep -Fq "backup preview-delete-snapshot --snapshot $v2 --mode deep --repository-dir $XD_CONFIG_DIR/backups/incremental" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-selected-preview.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
p=r["report"]
assert r["protocol"]=="xdrive-host-selected-v2-preview-v1"
assert r["snapshot_id"]=="v2-default:xdrive-backup-20261027T030000Z"
assert r["mode"]=="deep" and p["mode"]=="read_only" and p["delete_enabled"] is False
assert p["validation"]=="snapshot_sha256_and_full_cas_sha256"
assert p["exclusive_cas_bytes"]==200 and p["potential_logical_bytes"]==330
assert "repository_dir" not in p and "hashes" not in p
PY
export XD_BACKUP_ADMIN_TEST_BAD_SELECTED_PREVIEW=missing_hash
write_request preview_delete "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
unset XD_BACKUP_ADMIN_TEST_BAD_SELECTED_PREVIEW
export XD_BACKUP_ADMIN_TEST_BAD_SELECTED_PREVIEW=bad
write_request preview_delete "v2-default:$v2" "" fast "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
unset XD_BACKUP_ADMIN_TEST_BAD_SELECTED_PREVIEW

# A scheduled backup holds this exact lock. Admin verification must fail
# without invoking the Manager rather than racing a snapshot/retention job.
exec 9>>"$XD_CONFIG_DIR/state/scheduled-backup.lock"
flock -n 9
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-scheduled-lock"
write_request verify "v2-default:$v2" "" fast "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
cmp "$TMP/before-scheduled-lock" "$XD_BACKUP_ADMIN_TEST_LOG"
flock -u 9
exec 9>&-

# A concurrent CLI upgrade holds the same installer lock. A destructive
# restore must fail closed rather than interleave a database/file replacement.
exec 8>>"$XD_CONFIG_DIR/state/install.lock"
flock -n 8
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-install-lock"
# DB-only recovery is intentionally a different privileged action from a
# full restore. It must preserve file data and keep safety backup enabled.
write_request restore_database_only "v1:$db_only" "" "" "" "DATABASE ONLY RESTORE v1:$db_only"
backup_admin_process_request "$dir"
grep -Fq "backup verify $XD_CONFIG_DIR/backups/snapshots/$db_only" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq "restore $XD_CONFIG_DIR/backups/snapshots/$db_only --yes --database-only" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
entry=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert entry["action"]=="restore_database_only" and entry["snapshot_id"]=="v1:xdrive-backup-20261025T010000Z",entry
assert entry["state"]=="success",entry
PY
if grep -Eq -- 'no-safety-backup|--privileged|rm -rf' "$XD_BACKUP_ADMIN_TEST_LOG"; then
  echo 'unsafe database-only restore flags reached Host manager' >&2; exit 1
fi
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-invalid-db-restore"
write_request restore_database_only "v1:$v1" "" "" "" "DATABASE ONLY RESTORE v1:$v1"
backup_admin_process_request "$dir"
cmp "$TMP/before-invalid-db-restore" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
write_request restore_database_only "v2-default:$v2" "" "" "" "DATABASE ONLY RESTORE v2-default:$v2"
backup_admin_process_request "$dir"
cmp "$TMP/before-invalid-db-restore" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
write_request restore_database_only "v1:$db_only" "" "" "" "RESTORE v1:$db_only"
backup_admin_process_request "$dir"
cmp "$TMP/before-invalid-db-restore" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"

# A text fragment that claims database-only is insufficient: duplicate
# manifest keys or a false consistency flag must not reach restore.
db_only_manifest="$XD_CONFIG_DIR/backups/snapshots/$db_only/manifest.json"
cp "$db_only_manifest" "$TMP/db-only-valid-manifest"
printf '{"format_version":1,"file_data_included":false,"file_data_included":true,"consistency_verified":true}\n' > "$db_only_manifest"
if backup_admin_valid_database_only_manifest "$db_only_manifest"; then
  echo 'ambiguous v1 database-only manifest accepted' >&2; exit 1
fi
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-ambiguous-db-only"
write_request restore_database_only "v1:$db_only" "" "" "" "DATABASE ONLY RESTORE v1:$db_only"
backup_admin_process_request "$dir"
cmp "$TMP/before-ambiguous-db-only" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
printf '{"format_version":1,"file_data_included":false,"consistency_verified":false}\n' > "$db_only_manifest"
if backup_admin_valid_database_only_manifest "$db_only_manifest"; then
  echo 'inconsistent v1 database-only manifest accepted' >&2; exit 1
fi
cp "$TMP/db-only-valid-manifest" "$db_only_manifest"

write_request restore "v2-default:$v2" "" "" "" "RESTORE v2-default:$v2"
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
cmp "$TMP/before-install-lock" "$XD_BACKUP_ADMIN_TEST_LOG"
flock -u 8
exec 8>&-

# Restart recovery must never replay even a freshly queued delete.
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-restart"
write_request delete "v1:$v1" "" "" "" "DELETE v1:$v1"
backup_admin_recover_interrupted "$dir"
[[ ! -e "$dir/backup-admin-request.json" ]]
grep -Fq '"error_code":"interrupted"' "$dir/backup-admin-status.json"
cmp "$TMP/before-restart" "$XD_BACKUP_ADMIN_TEST_LOG"
[[ -d "$XD_CONFIG_DIR/backups/snapshots/$v1" ]]

write_request plan "" "" fast 2 ""
backup_admin_process_request "$dir"
grep -Fq "backup retention-plan --keep-last 2 --mode fast" "$XD_BACKUP_ADMIN_TEST_LOG"
python3 - "$dir/backup-admin-retention-report.json" <<'PY'
import json,sys
result=json.load(open(sys.argv[1],encoding="utf-8"))
assert result["delete_enabled"] is False
assert result["mode"]=="read_only"
PY

# A database-only v1 archive must never masquerade as a full restore.
db_only="xdrive-backup-20261025T010000Z"
fixture "$XD_CONFIG_DIR/backups/snapshots" v1 "$db_only"
rm "$XD_CONFIG_DIR/backups/snapshots/$db_only/blobs.tar"
printf '{"format_version":1,"file_data_included":false,"consistency_verified":true}\n' > "$XD_CONFIG_DIR/backups/snapshots/$db_only/manifest.json"
backup_admin_inventory "$dir"
python3 - "$dir/backup-admin-inventory.json" <<'PY'
import json,sys
snapshots=json.load(open(sys.argv[1],encoding="utf-8"))["snapshots"]
entry=next(x for x in snapshots if x["id"]=="v1:xdrive-backup-20261025T010000Z")
assert entry["state"]=="complete" and entry["file_data_included"] is False
PY
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-db-only"
write_request restore "v1:$db_only" "" "" "" "RESTORE v1:$db_only"
backup_admin_process_request "$dir"
cmp "$TMP/before-db-only" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"

write_request restore "v2-default:$v2" "" "" "" "RESTORE v2-default:$v2"
backup_admin_process_request "$dir"
grep -Fq "restore $XD_CONFIG_DIR/backups/incremental/snapshots/$v2 --yes" "$XD_BACKUP_ADMIN_TEST_LOG"
if grep -Eq 'no-safety-backup|rm -rf|--privileged' "$XD_BACKUP_ADMIN_TEST_LOG"; then
  echo 'unsafe restore arguments reached manager' >&2
  exit 1
fi

write_request prune "" "" "" 1 "PRUNE 1"
backup_admin_process_request "$dir"
grep -Fq 'backup prune --keep-last 1 --yes' "$XD_BACKUP_ADMIN_TEST_LOG"

# Browser-path traversal and wrong human confirmations can never become a
# command invocation even if the host request file is directly poisoned.
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-malicious"
write_request restore 'v2-default:../../secret' "" "" "" "RESTORE v2-default:../../secret"
backup_admin_process_request "$dir"
cmp "$TMP/before-malicious" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"

# v1 deletion is implemented by allowlisted unlink, never by arbitrary rmtree.
write_request delete "v1:$v1" "" "" "" "DELETE v1:$v1"
backup_admin_process_request "$dir"
[[ ! -e "$XD_CONFIG_DIR/backups/snapshots/$v1" ]]
[[ -d "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2" ]]

# An incomplete other snapshot is NOT a second usable recovery point.
fixture "$XD_CONFIG_DIR/backups/snapshots" v1 "$v1"
rm "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2/legacy.tar"
write_request delete "v1:$v1" "" "" "" "DELETE v1:$v1"
backup_admin_process_request "$dir"
[[ -d "$XD_CONFIG_DIR/backups/snapshots/$v1" ]]
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
touch "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2/legacy.tar"

# A checksum-invalid second generation is NOT a valid safety recovery point.
export XD_BACKUP_ADMIN_TEST_BAD_VERIFY="$XD_CONFIG_DIR/backups/incremental/snapshots/$v2"
write_request delete "v1:$v1" "" "" "" "DELETE v1:$v1"
backup_admin_process_request "$dir"
[[ -d "$XD_CONFIG_DIR/backups/snapshots/$v1" ]]
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
unset XD_BACKUP_ADMIN_TEST_BAD_VERIFY

# A saved revision gates policy edits, and unrecognized parameters never
# become modifications to any unrelated .env keys.
revision="$(python3 - "$dir/backup-admin-inventory.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding="utf-8"))["policy"]["revision"])
PY
)"
python3 - "$dir/backup-admin-request.json" "$revision" <<'PY'
import datetime,json,sys
json.dump({
 "protocol":"xdrive-backup-admin-v1",
 "request_id":"0123456789abcdef01234567",
 "action":"policy","format":"v1","retention_days":14,
 "revision":sys.argv[2],
 "created_at":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
},open(sys.argv[1],"w",encoding="utf-8"))
PY
backup_admin_process_request "$dir"
grep -Fxq XD_BACKUP_SCHEDULE_FORMAT=v1 "$XD_CONFIG_DIR/config/.env"
grep -Fxq XD_BACKUP_RETENTION_DAYS=14 "$XD_CONFIG_DIR/config/.env"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"

# More than 100 older legacy snapshots must not hide the newest v2 recovery.
for n in $(seq 0 104); do
  name="xdrive-backup-$(date -u -d "2026-05-01 +$n days" +%Y%m%dT%H%M%SZ)"
  fixture "$XD_CONFIG_DIR/backups/snapshots" v1 "$name"
done
backup_admin_inventory "$dir"
python3 - "$dir/backup-admin-inventory.json" "$v2" <<'PY'
import json,sys
from datetime import datetime
data=json.load(open(sys.argv[1],encoding="utf-8"))
rows=data["snapshots"]
assert len(rows)==100, len(rows)
assert rows[0]["id"]=="v2-default:"+sys.argv[2],rows[0]
assert rows[0]["created_at"]=="2026-10-27T03:00:00Z",rows[0]
assert all(datetime.fromisoformat(x["created_at"].replace("Z","+00:00")) for x in rows)
assert rows==sorted(rows,key=lambda x:(x["created_at"],x["id"]),reverse=True)
PY

# Custom v2 must count as a valid surviving recovery point, but only when
# verified. This isolated fixture has exactly one v1 and one custom v2.
(
  export XD_CONFIG_DIR="$TMP/custom-backup-layout"
  export XD_BACKUP_ADMIN_TEST_LOG="$TMP/custom-manager-argv"
  XDRIVE_HOME="$XD_CONFIG_DIR"
  CONFIG_DIR="$XDRIVE_HOME/config"
  BIN_DIR="$XDRIVE_HOME/bin"
  STATE_DIR="$XDRIVE_HOME/state"
  LOG_DIR="$XDRIVE_HOME/logs"
  ENV_PATH="$CONFIG_DIR/.env"
  MANAGER="$BIN_DIR/xdrive-server"
  custom_root="$XDRIVE_HOME/external-repository"
  old="xdrive-backup-20261022T030000Z"
  newer="xdrive-backup-20261023T030000Z"
  mkdir -p "$CONFIG_DIR" "$BIN_DIR" "$STATE_DIR" "$LOG_DIR" \
    "$XDRIVE_HOME/backups/snapshots" "$custom_root/snapshots"
  cp "$TMP/xd/bin/xdrive-server" "$MANAGER"
  printf 'XD_BACKUP_SCHEDULE_FORMAT=v2\nXD_BACKUP_RETENTION_DAYS=0\nXD_BACKUP_SCHEDULE_REPOSITORY_DIR=%s\n' \
    "$custom_root" > "$ENV_PATH"
  fixture "$XDRIVE_HOME/backups/snapshots" v1 "$old"
  fixture "$custom_root/snapshots" v2 "$newer"
  backup_admin_delete_v1 "v1:$old"
  [[ ! -e "$XDRIVE_HOME/backups/snapshots/$old" ]]
  [[ -d "$custom_root/snapshots/$newer" ]]
  grep -Fq "backup verify $custom_root/snapshots/$newer" "$XD_BACKUP_ADMIN_TEST_LOG"
  fixture "$XDRIVE_HOME/backups/snapshots" v1 "$old"
  export XD_BACKUP_ADMIN_TEST_BAD_VERIFY="$custom_root/snapshots/$newer"
  if backup_admin_delete_v1 "v1:$old"; then
    echo "ERROR: last recovery point deleted despite invalid custom v2" >&2
    exit 1
  fi
  [[ -d "$XDRIVE_HOME/backups/snapshots/$old" ]]
)


# Host receipts are durable evidence from execution, not request acceptance.
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
data=json.load(open(sys.argv[1],encoding="utf-8"))
assert data["protocol"]=="xdrive-backup-admin-history-v1"
items=data["operations"]
assert 1 <= len(items) <= 30
assert any(e["action"]=="verify" and e["state"]=="success" and e["mode"]=="deep" for e in items)
assert any(e["state"]=="failed" for e in items)
assert len(set(e["request_id"] for e in items))==len(items)
PY
[[ "$(stat -c %a "$dir/backup-admin-history.json")" == 660 ]]
# Reject a symlink rather than overwriting another Host-owned file.
mv "$dir/backup-admin-history.json" "$dir/backup-admin-history.saved"
printf safe > "$TMP/history-outside"
ln -s "$TMP/history-outside" "$dir/backup-admin-history.json"
if backup_admin_history_append "$dir" success verify 0123456789abcdef01234567 \
  "v2-default:$v2" deep 2026-10-27T03:00:00Z 2026-10-27T03:00:01Z ""; then
  echo 'unsafe history symlink followed' >&2
  exit 1
fi
[[ "$(cat "$TMP/history-outside")" == safe ]]
rm "$dir/backup-admin-history.json"
mv "$dir/backup-admin-history.saved" "$dir/backup-admin-history.json"


# A full 100-row history is trimmed on the next real Host action. Seed the
# previous history in one operation to keep CI fast (no 101 fsync subprocesses).
python3 - "$dir/backup-admin-history.json" "$v2" <<'PY'
import json,sys
path,snapshot=sys.argv[1:]
entries=[dict(protocol="xdrive-backup-admin-v1",request_id=f"{n:024x}",action="verify",
    snapshot_id="v2-default:"+snapshot,mode="fast",state="success",
    started_at="2026-10-27T03:00:00Z",finished_at="2026-10-27T03:00:01Z",
    error_code="") for n in range(100,0,-1)]
with open(path,"w",encoding="utf-8") as f:
    json.dump(dict(protocol="xdrive-backup-admin-history-v1",operations=entries),f)
PY
backup_admin_history_append "$dir" success verify 000000000000000000000065 \
  "v2-default:$v2" fast 2026-10-27T03:00:00Z 2026-10-27T03:00:01Z ""
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
events=json.load(open(sys.argv[1],encoding="utf-8"))["operations"]
assert len(events)==100,len(events)
assert events[0]["request_id"]==f"{101:024x}"
assert events[-1]["request_id"]==f"{2:024x}"
assert all(e["state"]=="success" and e["mode"]=="fast" for e in events)
PY


# Actual stage progress, unknown totals and unsafe progress records.
progress="$dir/backup-admin-progress.env"
printf 'stage_current=0\nstage_total=0\nstage=create backup\nservice=备份数据库\nbytes_done=4096\nbytes_total=8192\n' > "$progress"
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
assert x["state"]=="running" and x["stage"]=="备份数据库"
assert x["bytes_done"]==4096 and x["bytes_total"]==8192
PY
printf 'service=校验备份完整性\nbytes_done=1536\nbytes_total=0\n' > "$progress"
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
assert x["stage"]=="校验备份完整性"
assert x["bytes_done"]==1536 and x["bytes_total"]==0
PY
printf 'service=异常样本\nbytes_done=99999999999999999999\nbytes_total=bad\n' > "$progress"
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1],encoding="utf-8"))
assert x["bytes_done"]==0 and x["bytes_total"]==0
PY
rm "$progress"
printf untouched > "$TMP/progress-outside"
ln -s "$TMP/progress-outside" "$progress"
cp "$dir/backup-admin-status.json" "$TMP/status-before-progress-symlink"
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
cmp "$dir/backup-admin-status.json" "$TMP/status-before-progress-symlink"
[[ "$(cat "$TMP/progress-outside")" == untouched ]]
rm "$progress"


# Malformed native stage labels cannot poison the JSON receipt. In particular,
# reject control characters and UTF-8 labels that exceed the 96-byte API cap.
python3 - "$progress" <<'PY'
import sys
with open(sys.argv[1], "w", encoding="utf-8") as out:
    out.write("service=错误\t标签\nbytes_done=0008\nbytes_total=0016\n")
PY
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1], encoding="utf-8"))
assert s["stage"]=="正在创建服务器备份", s
assert s["bytes_done"]==8 and s["bytes_total"]==16, s
PY
python3 - "$progress" <<'PY'
import sys
with open(sys.argv[1], "w", encoding="utf-8") as out:
    out.write("service=" + "中"*40 + "\nbytes_done=5\nbytes_total=0\n")
PY
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1], encoding="utf-8"))
assert s["stage"]=="正在创建服务器备份", s
assert s["bytes_done"]==5 and s["bytes_total"]==0, s
PY

# O_NOFOLLOW also refuses oversized and invalid UTF-8 progress input,
# preserving the previous Host status rather than inventing progress.
printf -v enormous '%02048d' 0
printf '%sZ' "$enormous" > "$progress"
cp "$dir/backup-admin-status.json" "$TMP/previous-progress-status"
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
cmp "$dir/backup-admin-status.json" "$TMP/previous-progress-status"
python3 - "$progress" <<'PY'
import sys
with open(sys.argv[1], "wb") as stream:
    stream.write(b"service=\xff\xfe\nbytes_done=8\n")
PY
backup_admin_publish_live_progress "$dir" create 0123456789abcdef01234567 "" "$(now_utc)"
cmp "$dir/backup-admin-status.json" "$TMP/previous-progress-status"

# Recovery after a Host restart must not show stale backup progress.
printf 'service=stale-stage\nbytes_done=5\nbytes_total=10\n' > "$progress"
write_request verify "v2-default:$v2" "" fast "" ""
backup_admin_recover_interrupted "$dir"
[[ ! -e "$progress" ]]


# Forged/oversized Host records cannot be reflected in the Admin API history.
proof_file="$TMP/forged-verify-report.json"
printf '{"protocol":"xdrive-host-backup-verify-v1","state":"success","format":"v2","scope":"backup_snapshot_and_referenced_cas","cas_objects_checked":9007199254740992,"cas_bytes_hashed":17}\n' > "$proof_file"
backup_admin_history_append "$dir" success verify 111111111111111111111111 \
  "v2-default:$v2" fast 2026-10-27T03:00:00Z 2026-10-27T03:00:01Z "" "$proof_file"
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert e["action"]=="verify" and "verification" not in e,e
PY
rm "$proof_file"
ln -s /etc/passwd "$proof_file"
backup_admin_history_append "$dir" success verify 222222222222222222222222 \
  "v2-default:$v2" fast 2026-10-27T03:00:00Z 2026-10-27T03:00:01Z "" "$proof_file"
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert "verification" not in e,e
PY
[[ -L "$proof_file" && "$(readlink "$proof_file")" == /etc/passwd ]]

# The fixed, non-destructive Host drill is the ONLY additional remote test.
# No browser can supply raw Host path, Docker flags or RAM limit.
write_request drill "v2-default:$v2" "" "" "" "DRILL v2-default:$v2"
backup_admin_process_request "$dir"
grep -Fq "backup drill $XD_CONFIG_DIR/backups/incremental/snapshots/$v2 --max-mib 1024" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert e["action"]=="drill" and e["state"]=="success",e
d=e["drill"]
assert d["protocol"]=="xdrive-host-isolated-drill-v1",d
assert d["files_restored"] and d["postgresql_restored"],d
assert d["production_verified"] is False and d["max_mib"]==1024,d
PY
# Forged success from the CLI can never create a successful history receipt.
export XD_BACKUP_ADMIN_TEST_DRILL_BAD=bad
write_request drill "v2-default:$v2" "" "" "" "DRILL v2-default:$v2"
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert e["action"]=="drill" and e["state"]=="failed" and "drill" not in e,e
PY
unset XD_BACKUP_ADMIN_TEST_DRILL_BAD
# A v1 target fails before invoking the isolated drill even with a typed word.
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-invalid-drill"
write_request drill "v1:$v1" "" "" "" "DRILL v1:$v1"
backup_admin_process_request "$dir"
cmp "$TMP/before-invalid-drill" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"


# Admin batch verification enumerates all committed generations (not the 100
# visible UI rows), is read-only, and stores real results after browser exit.
write_request verify_all "" "" fast "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
grep -Fq "backup verify --json $XD_CONFIG_DIR/backups/snapshots/" "$XD_BACKUP_ADMIN_TEST_LOG"
python3 - "$dir/backup-admin-verify-all-report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
assert r["protocol"]=="xdrive-host-verify-all-v1" and r["state"]=="success",r
assert r["mode"]=="fast" and r["total_snapshots"]>100,r
assert r["checked_snapshots"]==r["total_snapshots"]==r["passed_snapshots"],r
assert r["failed_snapshots"]==0 and r["unverified_snapshots"]==0,r
assert r["deep_repositories_checked"]==0 and r["deep_repositories_failed"]==0,r
assert r["failure_sample"]==[],r
PY
# The per-snapshot JSON fails closed when a real checksum check fails; other
# generations are still checked, and the whole result is not green.
export XD_BACKUP_ADMIN_TEST_BAD_VERIFY="$XD_CONFIG_DIR/backups/incremental/snapshots/$v2"
write_request verify_all "" "" fast "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-verify-all-report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
assert r["state"]=="failed" and r["failed_snapshots"]>=1,r
assert r["checked_snapshots"]==r["total_snapshots"],r
assert any(x["snapshot_id"].startswith("v2-default:") for x in r["failure_sample"]),r
PY
unset XD_BACKUP_ADMIN_TEST_BAD_VERIFY
# Deep runs exactly one independent repository-wide CAS audit for the v2
# default repository, not one scan per generation.
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-bulk-deep"
write_request verify_all "" "" deep "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-verify-all-report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
assert r["mode"]=="deep" and r["state"]=="success",r
assert r["deep_repositories_checked"]==1 and r["deep_repositories_failed"]==0,r
PY
# A helper returning exit 0 but fast-mode evidence is not proof that deep CAS
# hashing occurred. Keep the failed historical summary instead of a green pass.
export XD_BACKUP_ADMIN_TEST_FAKE_DEEP=fast
write_request verify_all "" "" deep "" ""
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
python3 - "$dir/backup-admin-verify-all-report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
assert r["state"]=="failed" and r["deep_repositories_failed"]==1,r
assert r["checked_snapshots"]==r["total_snapshots"] and r["failed_snapshots"]==0,r
PY
unset XD_BACKUP_ADMIN_TEST_FAKE_DEEP
# A symlinked generation blocks the entire batch before any Host verifier is
# invoked, and does not leak the symlink target into the report.
ln -s /etc "$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20261028T010000Z"
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-bulk-unsafe"
write_request verify_all "" "" fast "" ""
backup_admin_process_request "$dir"
cmp "$TMP/before-bulk-unsafe" "$XD_BACKUP_ADMIN_TEST_LOG"
python3 - "$dir/backup-admin-verify-all-report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1],encoding="utf-8"))
assert r["state"]=="failed" and r["failure_category"]=="unsafe_snapshot",r
assert r["checked_snapshots"]==0 and r["unverified_snapshots"]==r["total_snapshots"],r
assert "/etc" not in str(r),r
PY
rm "$XD_CONFIG_DIR/backups/snapshots/xdrive-backup-20261028T010000Z"

# Selected v2 deletion is independent of keep-last prune. The Host accepts
# exactly one recent deep preview receipt; missing, fast or stale evidence
# cannot trigger the Manager's destructive subcommand.
sibling="xdrive-backup-20261027T040000Z"
fixture "$XD_CONFIG_DIR/backups/incremental/snapshots" v2 "$sibling"
write_request preview_delete "v2-default:$v2" "" fast "" ""
backup_admin_process_request "$dir"
fast_id="$(python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding="utf-8"))["request_id"])
PY
)"
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-selected-fast"
write_request delete_selected "v2-default:$v2" "" "" "" "DELETE v2-default:$v2" "$fast_id"
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
cmp "$TMP/before-selected-fast" "$XD_BACKUP_ADMIN_TEST_LOG"
[[ -d "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2" ]]

# Mismatched preview ID must fail even with exact confirmation.
write_request preview_delete "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
deep_id="$(python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding="utf-8"))["request_id"])
PY
)"
cp "$XD_BACKUP_ADMIN_TEST_LOG" "$TMP/before-selected-wrong-id"
write_request delete_selected "v2-default:$v2" "" "" "" "DELETE v2-default:$v2" "aaaaaaaaaaaaaaaaaaaaaaaa"
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
cmp "$TMP/before-selected-wrong-id" "$XD_BACKUP_ADMIN_TEST_LOG"
grep -Fq '"error_code":"deep_preview_missing_or_stale"' "$dir/backup-admin-status.json"
[[ -d "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2" ]]

# Even an exit-zero Manager mock is insufficient without the selected
# generation actually being retired.
write_request preview_delete "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
deep_id="$(python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding="utf-8"))["request_id"])
PY
)"
export XD_BACKUP_ADMIN_TEST_DELETE_NOOP=yes
write_request delete_selected "v2-default:$v2" "" "" "" "DELETE v2-default:$v2" "$deep_id"
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
unset XD_BACKUP_ADMIN_TEST_DELETE_NOOP
[[ -d "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2" ]]

# Forged JSON cannot turn an actually removed generation into an accepted
# success. The target is removed in this disposable fixture, but Host status
# and history must report an uncertain failure, with no false success receipt.
write_request preview_delete "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
deep_id="$(python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding="utf-8"))["request_id"])
PY
)"
export XD_BACKUP_ADMIN_TEST_DELETE_FAKE=yes
write_request delete_selected "v2-default:$v2" "" "" "" "DELETE v2-default:$v2" "$deep_id"
backup_admin_process_request "$dir"
grep -Fq '"state":"failed"' "$dir/backup-admin-status.json"
grep -Fq '"error_code":"selected_delete_unverified"' "$dir/backup-admin-status.json"
[[ ! -e "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2" ]]
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert e["action"]=="delete_selected" and e["state"]=="failed"
assert "selected_delete" not in e
PY
unset XD_BACKUP_ADMIN_TEST_DELETE_FAKE
fixture "$XD_CONFIG_DIR/backups/incremental/snapshots" v2 "$v2"

# Fresh deep preview, exact confirmation and matching receipt permit the Host
# to call ONLY the fixed Server's independently audited selected-retire helper.
write_request preview_delete "v2-default:$v2" "" deep "" ""
backup_admin_process_request "$dir"
deep_id="$(python3 - "$dir/backup-admin-status.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding="utf-8"))["request_id"])
PY
)"
write_request delete_selected "v2-default:$v2" "" "" "" "DELETE v2-default:$v2" "$deep_id"
backup_admin_process_request "$dir"
grep -Fq '"state":"success"' "$dir/backup-admin-status.json"
grep -Fq "backup delete-snapshot --snapshot $v2 --yes --repository-dir $XD_CONFIG_DIR/backups/incremental" "$XD_BACKUP_ADMIN_TEST_LOG"
[[ ! -e "$XD_CONFIG_DIR/backups/incremental/snapshots/$v2" ]]
[[ -d "$XD_CONFIG_DIR/backups/incremental/snapshots/$sibling" ]]
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
row=json.load(open(sys.argv[1],encoding="utf-8"))["operations"][0]
assert row["action"]=="delete_selected" and row["state"]=="success"
assert row["snapshot_id"]=="v2-default:xdrive-backup-20261027T030000Z"
d=row["selected_delete"]
assert d["retired_snapshots"]==["xdrive-backup-20261027T030000Z"],d
assert d["verification"]=="exclusive_lock_and_full_cas_sha256" and d["automatic"] is False,d
assert d["deleted_cas_objects"]==1 and d["deleted_cas_logical_bytes"]==12,d
assert d["deleted_snapshot_files"]==6 and d["deleted_snapshot_file_bytes"]==30,d
PY

echo 'Admin Server Backup host bridge: CRUD, batch verify, selected-v2 delete and safety tests passed'
