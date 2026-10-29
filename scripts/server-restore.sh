#!/usr/bin/env bash
set -euo pipefail
umask 077

XDRIVE_HOME="${XD_CONFIG_DIR:-$HOME/.xd}"
BACKUP_DIR=""
ASSUME_YES=0
SAFETY_BACKUP=1
DATABASE_ONLY=0

usage() {
  cat <<'EOF'
Usage: server-restore.sh BACKUP_DIR [--config-dir DIR] [--yes] [--no-safety-backup] [--database-only]

Restore is destructive. By default xDrive first creates a pre-restore safety
backup of the current state, then stops the API and pull worker, verifies
SHA-256 checksums, recreates the PostgreSQL database, replaces file-data, runs
an offline consistency verification, and only then reopens the services.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir) XDRIVE_HOME="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-safety-backup) SAFETY_BACKUP=0; shift ;;
    --database-only) DATABASE_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$BACKUP_DIR" ]]; then
        echo "only one BACKUP_DIR may be supplied" >&2
        exit 2
      fi
      BACKUP_DIR="$1"
      shift
      ;;
  esac
done

[[ -n "$BACKUP_DIR" ]] || { usage >&2; exit 2; }
[[ -d "$BACKUP_DIR" ]] || { echo "backup directory not found: $BACKUP_DIR" >&2; exit 1; }
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
CONFIG_DIR="$XDRIVE_HOME/config"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"
[[ -f "$COMPOSE_PATH" ]] || { echo "missing $COMPOSE_PATH" >&2; exit 1; }
[[ -f "$ENV_PATH" ]] || { echo "missing $ENV_PATH" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }

# Resolve the runtime owner before any destructive restore step. Never assume
# the default UID when this deployment explicitly runs the Server as another.
storage_uid="$(grep '^XD_SERVER_UID=' "$ENV_PATH" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
storage_gid="$(grep '^XD_SERVER_GID=' "$ENV_PATH" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
storage_uid="${storage_uid:-65532}"
storage_gid="${storage_gid:-65532}"
if [[ ! "$storage_uid" =~ ^[0-9]+$ || ! "$storage_gid" =~ ^[0-9]+$ ]]; then
  echo "restore: invalid Server storage UID/GID." >&2
  exit 1
fi

BACKUP_VERSION=1
if grep -Eq '"format_version"[[:space:]]*:[[:space:]]*2' "$BACKUP_DIR/manifest.json"; then
  BACKUP_VERSION=2
elif ! grep -Eq '"format_version"[[:space:]]*:[[:space:]]*1' "$BACKUP_DIR/manifest.json"; then
  echo "unsupported backup format" >&2
  exit 1
fi
# Hold a SHARED lease on the same .backup.lock used by v2 snapshot capture.
# A future reference-aware prune must acquire its EXCLUSIVE lease first.
# Hold the lease from checksum preflight through the final physical restore:
# otherwise a concurrent prune could remove a snapshot or shared CAS object
# between integrity verification and the destructive PostgreSQL restore.
# Open read-only, never truncate or recreate the repository lock.
if [[ "$BACKUP_VERSION" == "2" ]]; then
  [[ "$(basename "$(dirname "$BACKUP_DIR")")" == "snapshots" ]] || {
    echo "restore: invalid CAS repository layout." >&2
    exit 1
  }
  backup_repo_lock_dir="$(cd "$BACKUP_DIR/../.." && pwd -P)"
  backup_repo_lock="$backup_repo_lock_dir/.backup.lock"
  [[ -f "$backup_repo_lock" && ! -L "$backup_repo_lock" ]] || {
    echo "restore: missing or unsafe v2 repository lock: $backup_repo_lock" >&2
    exit 1
  }
  command -v flock >/dev/null 2>&1 || {
    echo "restore: flock is required for v2 repository safety" >&2
    exit 1
  }
  exec 7<"$backup_repo_lock"
  flock -s -n 7 || {
    echo "restore: v2 repository is busy with another operation" >&2
    exit 75
  }
fi
required_files=(database.dump verify.json manifest.json SHA256SUMS.txt)
if [[ "$BACKUP_VERSION" == "2" ]]; then
  required_files+=(objects.index legacy.tar)
elif [[ "$DATABASE_ONLY" != "1" ]]; then
  required_files+=(blobs.tar)
fi
for required in "${required_files[@]}"; do
  [[ -f "$BACKUP_DIR/$required" ]] || { echo "backup is missing $required" >&2; exit 1; }
  if [[ "$BACKUP_VERSION" == "2" && -L "$BACKUP_DIR/$required" ]]; then
    echo "restore: v2 snapshot contains symlink $required" >&2
    exit 1
  fi
  if [[ "$BACKUP_VERSION" == "1" && -L "$BACKUP_DIR/$required" ]]; then
    echo "restore: v1 snapshot contains symlink $required" >&2
    exit 1
  fi
done
if [[ "$BACKUP_VERSION" == "2" ]]; then
  # sha256sum -c accepts an incomplete checksum list. Require exactly the
  # five canonical v2 files in creation order; reject omitted, duplicate,
  # extra, renamed, or incorrect checksums BEFORE the safety backup.
  (
    cd "$BACKUP_DIR"
    cmp -s SHA256SUMS.txt <(sha256sum database.dump verify.json manifest.json objects.index legacy.tar)
  ) || { echo "restore: v2 checksum manifest mismatch (missing/extra entry or corrupt file)" >&2; exit 1; }
else
  # Old v1 restore used sha256sum -c, which accepts omitted members. Compare
  # the complete canonical archive list in writer order before any stop/backup.
  v1_checksum_files=(database.dump verify.json manifest.json)
  if [[ -L "$BACKUP_DIR/blobs.tar" ]]; then
    echo "restore: v1 snapshot contains symlink blobs.tar" >&2
    exit 1
  fi
  if [[ -f "$BACKUP_DIR/blobs.tar" ]]; then
    v1_checksum_files+=(blobs.tar)
  fi
  (
    cd "$BACKUP_DIR"
    cmp -s SHA256SUMS.txt <(sha256sum "${v1_checksum_files[@]}")
  ) || { echo "restore: v1 checksum manifest mismatch (missing/extra entry or corrupt file)" >&2; exit 1; }

  if [[ "$DATABASE_ONLY" != "1" ]]; then
    # GNU tar extraction replaces /data after the database is dropped. Reject
    # path traversal, symlinks/special inodes, ambiguous duplicates, ancestor
    # collisions, and hardlinks outside the archive before stopping services.
    command -v python3 >/dev/null 2>&1 || {
      echo "restore: Python 3 is required for v1 archive safety preflight." >&2
      exit 1
    }
    python3 - "$BACKUP_DIR/blobs.tar" <<'PY'
import sys
import tarfile

archive_path = sys.argv[1]
seen = {}
ancestors = set()
regular = set()

def canonical(name):
    if not name or name.startswith("/") or "\\" in name or "\x00" in name:
        raise ValueError("absolute or malformed name")
    parts = name.split("/")
    if any(part == ".." for part in parts):
        raise ValueError("parent traversal")
    parts = [part for part in parts if part and part != "."]
    return "/".join(parts)

try:
    # Random-access header iteration skips regular file payloads; do not read
    # a possibly multi-terabyte tar stream a second time merely to list names.
    with tarfile.open(archive_path, mode="r:") as archive:
        for member in archive:
            name = canonical(member.name)
            if not name:
                if not member.isdir():
                    raise ValueError("unsafe archive root")
                continue
            if name in seen:
                raise ValueError("duplicate path or alias")
            if member.isdir():
                kind = "dir"
            elif member.isreg():
                kind = "file"
            elif member.islnk():
                # GNU tar stores safe hardlink targets as archive-relative
                # names. Accept only a previously inspected regular member.
                target = canonical(member.linkname)
                if not target or target not in regular:
                    raise ValueError("unsafe hardlink target")
                kind = "file"
            else:
                # Includes symlink, device, FIFO and unsupported member types.
                raise ValueError("unsafe archive member type")
            parts = name.split("/")
            for index in range(1, len(parts)):
                parent = "/".join(parts[:index])
                if seen.get(parent) == "file":
                    raise ValueError("file ancestor collision")
                ancestors.add(parent)
            if kind == "file" and name in ancestors:
                raise ValueError("file replaces earlier directory ancestor")
            seen[name] = kind
            if kind == "file":
                regular.add(name)
except (OSError, EOFError, tarfile.TarError, ValueError) as exc:
    print("restore: unsafe v1 tar archive entry: " + type(exc).__name__, file=sys.stderr)
    sys.exit(1)
PY
  fi
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    echo "restore requires --yes in a non-interactive shell" >&2
    exit 2
  fi
  if [[ "$DATABASE_ONLY" == "1" ]]; then
    printf 'Restore xDrive database from %s? File data will be preserved. [y/N] ' "$BACKUP_DIR" >/dev/tty
  else
    printf 'Restore xDrive from %s? This replaces the current database and all blobs. [y/N] ' "$BACKUP_DIR" >/dev/tty
  fi
  read -r answer </dev/tty
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "restore cancelled"; exit 0; }
fi

compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@" </dev/null
}

compose_with_stdin() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
}

wait_postgres() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T postgres pg_isready -h 127.0.0.1 -U xdrive -d xdrive >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready" >&2
  return 1
}

wait_server() {
  local i
  for i in $(seq 1 60); do
    if compose exec -T server xdrive-server healthcheck >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "xDrive API did not become ready after restore" >&2
  return 1
}

CAS_REPOSITORY=""
CAS_SNAPSHOT=""
CAS_SERVER_IMAGE=""
if [[ "$BACKUP_VERSION" == "2" && "$DATABASE_ONLY" != "1" ]]; then
  # The v2 snapshot must reside inside the local CAS repository. Verify every
  # immutable object BEFORE terminating any API/worker or replacing the DB.
  CAS_REPOSITORY="$(cd "$BACKUP_DIR/../.." && pwd)"
  [[ "$(basename "$(dirname "$BACKUP_DIR")")" == "snapshots" &&
     -d "$CAS_REPOSITORY/objects/sha256" ]] || {
    echo "restore: invalid CAS repository layout." >&2
    exit 1
  }
  CAS_SNAPSHOT="$(basename "$BACKUP_DIR")"
  restore_server_id="$(compose ps -aq server | head -n1 || true)"
  CAS_SERVER_IMAGE=""
  if [[ -n "$restore_server_id" ]]; then
    CAS_SERVER_IMAGE="$(docker inspect "$restore_server_id" --format '{{.Config.Image}}' </dev/null 2>/dev/null || true)"
  fi
  if [[ -z "$CAS_SERVER_IMAGE" ]]; then
    CAS_SERVER_IMAGE="$(grep '^XD_SERVER_IMAGE=' "$ENV_PATH" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  fi
  [[ -n "$CAS_SERVER_IMAGE" ]] || { echo "restore: xDrive server image is missing." >&2; exit 1; }
  docker run --rm --user 0:0 \
    --mount "type=bind,src=$CAS_REPOSITORY,dst=/repo,readonly" \
    --entrypoint /usr/local/bin/xdrive-backup-repo \
    "$CAS_SERVER_IMAGE" verify --repo /repo --snapshot "$CAS_SNAPSHOT" </dev/null
fi

# Integrity of the requested v2 snapshot must be verified BEFORE creating a
# pre-restore safety backup. Otherwise a corrupt/missing CAS object would
# unnecessarily stop/restart the healthy live service even though restore is
# rejected before touching PostgreSQL.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$SAFETY_BACKUP" == "1" ]]; then
  echo "Creating pre-restore safety backup..."
  "$SCRIPT_DIR/server-backup.sh"     --config-dir "$XDRIVE_HOME"     --output-dir "$XDRIVE_HOME/backups/pre-restore"     --allow-inconsistent
fi

server_was_running=0
worker_was_running=0
if compose ps --status running --services | grep -qx server; then
  server_was_running=1
fi
if compose ps --status running --services | grep -qx worker; then
  worker_was_running=1
fi

restore_ok=0
on_exit() {
  if [[ "$restore_ok" != "1" ]]; then
    echo "Restore did not complete successfully; xDrive API and pull worker remain stopped." >&2
    echo "Inspect the error, then retry restore or recover from the pre-restore backup." >&2
  fi
}
trap on_exit EXIT INT TERM

compose up -d postgres >/dev/null
wait_postgres
if [[ "$worker_was_running" == "1" ]]; then
  compose stop worker >/dev/null 2>&1 || true
fi
compose stop server >/dev/null 2>&1 || true

server_id="$(compose ps -aq server | head -n1 || true)"
mount_type=""
data_source=""
if [[ -n "$server_id" ]]; then
  mount_type="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}' </dev/null)"
  if [[ "$mount_type" == "volume" ]]; then
    data_source="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' </dev/null)"
  else
    data_source="$(docker inspect "$server_id" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' </dev/null)"
  fi
fi
if [[ -z "$data_source" ]]; then
  data_source="$(docker volume ls -q \
    --filter 'label=com.docker.compose.project=xdrive' \
    --filter 'label=com.docker.compose.volume=file-data' </dev/null | head -n1 || true)"
  [[ -n "$data_source" ]] && mount_type="volume"
fi
[[ -n "$data_source" ]] || {
  echo "cannot resolve xDrive /data mount without creating/recreating the server service" >&2
  exit 1
}
if [[ "$BACKUP_VERSION" == "2" && "$DATABASE_ONLY" != "1" && "$data_source" == /* ]]; then
  storage_real="$(readlink -f -- "$data_source" 2>/dev/null || true)"
  repository_real="$(readlink -f -- "$CAS_REPOSITORY" 2>/dev/null || true)"
  if [[ -n "$storage_real" && -n "$repository_real" ]]; then
    case "$repository_real/" in
      "$storage_real/"*) echo "restore: repository is nested inside data being replaced." >&2; exit 1 ;;
    esac
    case "$storage_real/" in
      "$repository_real/"*) echo "restore: live data is nested inside the repository." >&2; exit 1 ;;
    esac
  fi
fi

postgres_id="$(compose ps -q postgres | head -n1)"
postgres_image="$(docker inspect "$postgres_id" --format '{{.Config.Image}}' </dev/null)"

compose exec -T postgres psql -U xdrive -d postgres -v ON_ERROR_STOP=1   -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'xdrive' AND pid <> pg_backend_pid();" >/dev/null
compose exec -T postgres dropdb -U xdrive --if-exists xdrive
compose exec -T postgres createdb -U xdrive -O xdrive xdrive
compose_with_stdin exec -T postgres pg_restore -U xdrive -d xdrive --no-owner --no-privileges < "$BACKUP_DIR/database.dump"

if [[ "$DATABASE_ONLY" != "1" && "$BACKUP_VERSION" == "2" ]]; then
  docker run --rm --user 0:0 \
    --mount "type=bind,src=$CAS_REPOSITORY,dst=/repo,readonly" \
    -v "$data_source:/data" \
    --entrypoint /usr/local/bin/xdrive-backup-repo \
    "$CAS_SERVER_IMAGE" restore --repo /repo --snapshot "$CAS_SNAPSHOT" --target /data </dev/null
elif [[ "$DATABASE_ONLY" != "1" ]]; then
  docker run --rm -i --entrypoint sh \
    -v "$data_source:/data" \
    "$postgres_image" \
    -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} \; && tar -xf - -C /data' < "$BACKUP_DIR/blobs.tar"
else
  echo "Preserving existing file data (database-only restore)."
fi

echo "Repairing restored storage ownership..."
compose run -T --rm --no-deps --user 0:0 server storage prepare --force \
  --uid "$storage_uid" --gid "$storage_gid" </dev/null

echo "Verifying restored metadata and blobs..."
# Restore is a high-stakes integrity operation. Deep is mandatory even though
# normal verification and new pre-upgrade backups default to fast.
# Legacy Server images ignore this env var and already run deep by default.
compose run -T --rm --no-deps -e XD_STORAGE_VERIFY_MODE=deep server storage verify --json </dev/null

if [[ "$server_was_running" == "1" ]]; then
  compose start server >/dev/null
  wait_server
fi
if [[ "$worker_was_running" == "1" && "$server_was_running" == "1" ]]; then
  compose start worker >/dev/null
fi
restore_ok=1
trap - EXIT INT TERM
echo "xDrive restore completed successfully."
