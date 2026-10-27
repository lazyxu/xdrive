#!/usr/bin/env bash
set -euo pipefail
umask 077

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
if [[ "$1" == backup && "$2" == verify && "${3:-}" == --json ]]; then
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
  printf '{"mode":"read_only","validation":"snapshot_sha256_and_cas_size","keep_last":2,"committed_snapshots":1,"keep_snapshots":["xdrive-backup-20261027T030000Z"],"drop_candidates":[],"retained_objects":1,"drop_only_objects":0,"unreferenced_objects":0,"drop_only_object_bytes":0,"unreferenced_bytes":0,"drop_snapshot_bytes":0,"potential_logical_bytes":0,"delete_enabled":false,"warning":"read-only","hashed_objects":0,"hashed_bytes":0}\n'
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
  python3 - "$dir/backup-admin-request.json" "$1" "$2" "$3" "$4" "$5" "$6" <<'PY'
import datetime,json,sys,uuid
path,action,snapshot,fmt,mode,keep,confirm=sys.argv[1:]
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


# A full 30-row history is trimmed on the next real Host action. Seed the
# previous history in one operation to keep CI fast (no 35 fsync subprocesses).
python3 - "$dir/backup-admin-history.json" "$v2" <<'PY'
import json,sys
path,snapshot=sys.argv[1:]
entries=[dict(protocol="xdrive-backup-admin-v1",request_id=f"{n:024x}",action="verify",
    snapshot_id="v2-default:"+snapshot,mode="fast",state="success",
    started_at="2026-10-27T03:00:00Z",finished_at="2026-10-27T03:00:01Z",
    error_code="") for n in range(30,0,-1)]
with open(path,"w",encoding="utf-8") as f:
    json.dump(dict(protocol="xdrive-backup-admin-history-v1",operations=entries),f)
PY
backup_admin_history_append "$dir" success verify 00000000000000000000001f \
  "v2-default:$v2" fast 2026-10-27T03:00:00Z 2026-10-27T03:00:01Z ""
python3 - "$dir/backup-admin-history.json" <<'PY'
import json,sys
events=json.load(open(sys.argv[1],encoding="utf-8"))["operations"]
assert len(events)==30,len(events)
assert events[0]["request_id"]==f"{31:024x}"
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

echo 'Admin Server Backup host bridge: CRUD, history, live progress and safety tests passed'
