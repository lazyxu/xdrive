#!/usr/bin/env bash
set -euo pipefail

echo "[ci] internal/api race suite: timeout=30m count=1 json=enabled"

set +e
go test -race -timeout=30m -count=1 -json ./internal/api
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  echo "[ci] internal/api failed; collecting runner and PostgreSQL diagnostics" >&2
  uname -a >&2 || true
  uptime >&2 || true
  df -h . >&2 || true
  if [[ -r /proc/loadavg ]]; then
    printf '[ci] loadavg: ' >&2
    cat /proc/loadavg >&2 || true
  fi
  if [[ -r /proc/diskstats ]]; then
    echo "[ci] /proc/diskstats (tail):" >&2
    tail -n 32 /proc/diskstats >&2 || true
  fi

  if command -v psql >/dev/null 2>&1 && [[ -n "${XD_TEST_DATABASE_URL:-}" ]]; then
    echo "[ci] PostgreSQL activity:" >&2
    psql "$XD_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 >&2 <<'SQL' || true
SELECT pid,
       state,
       wait_event_type,
       wait_event,
       now() - query_start AS query_age,
       left(query, 180) AS query
FROM pg_stat_activity
WHERE datname = current_database()
ORDER BY query_start NULLS LAST;

SELECT datname,
       numbackends,
       xact_commit,
       xact_rollback,
       blks_read,
       blks_hit,
       temp_files,
       temp_bytes,
       deadlocks
FROM pg_stat_database
WHERE datname = current_database();
SQL
  fi
fi

exit "$status"
