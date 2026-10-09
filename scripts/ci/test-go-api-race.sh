#!/usr/bin/env bash
set -euo pipefail

# Integration tests open independent PostgreSQL pools; the original single
# long-lived Go test process reproducibly exhausted PostgreSQL connections
# (SQLSTATE 53300). Keep every test and full race instrumentation, but launch
# four sequential test processes to release old SQL pools at each boundary.
# Concurrency INSIDE each test is unchanged.
shards=(
  '^(Test[A-F]|Example|Fuzz)'
  '^Test[G-M]'
  '^Test[N-S]'
  '^Test[T-Z]'
)
mapfile -t listed < <(go test -race -mod=readonly -list '^(Test|Example|Fuzz)' ./internal/api |
  grep -E '^(Test|Example|Fuzz)[[:alnum:]_]*$' || true)
if (( ${#listed[@]} == 0 )); then
  echo "[ci] ERROR: no internal/api tests were discovered" >&2
  exit 1
fi
for name in "${listed[@]}"; do
  matched=0
  for selector in "${shards[@]}"; do
    if [[ "$name" =~ $selector ]]; then
      ((matched+=1))
    fi
  done
  if (( matched != 1 )); then
    echo "[ci] ERROR: $name matched $matched shards, expected exactly one" >&2
    exit 1
  fi
done

echo "[ci] internal/api race: ${#listed[@]} tests; four sequential processes; timeout=30m each"
status=0
for i in "${!shards[@]}"; do
  echo "[ci] start shard $((i + 1))/${#shards[@]}: ${shards[i]}"
  set +e
  go test -race -timeout=30m -count=1 -json -run "${shards[i]}" ./internal/api
  status=$?
  set -e
  if (( status != 0 )); then
    echo "[ci] race test shard $((i + 1)) failed" >&2
    break
  fi
done

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
