#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY="$ROOT/scripts/server-verify.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home/config" "$TMP/state"

printf 'XD_DOMAIN=\n' > "$TMP/home/config/.env"
printf 'name: xdrive\nservices: {}\n' > "$TMP/home/config/docker-compose.yml"

cat > "$TMP/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_STATE/docker-args"
if [[ "$1" == "compose" ]]; then
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file|-f) shift 2 ;;
      *) break ;;
    esac
  done
  case "$1" in
    ps)
      if [[ "$*" == *"--status running --services"* ]]; then
        echo "server"
      fi
      exit 0
      ;;
    up|stop|start)
      exit 0
      ;;
    exec)
      if [[ "$*" == *"postgres pg_isready"* ]]; then
        exit 0
      fi
      if [[ "$*" == *"server xdrive-server storage verify --json"* || "$*" == *"server xdrive-server storage verify --summary-json"* ]]; then
        echo '{"ok":true}'
        exit 0
      fi
      ;;
    run)
      if [[ "$*" == *"server storage repair --json --dry-run"* ]]; then
        echo '{"dry_run":true}'
        exit 0
      fi
      if [[ "$*" == *"server storage repair --json"* ]]; then
        echo '{"dry_run":false}'
        exit 0
      fi
      if [[ "$*" == *"server storage verify --json"* || "$*" == *"server storage verify --summary-json"* ]]; then
        echo '{"ok":true}'
        exit 0
      fi
      ;;
  esac
fi
echo "unexpected docker invocation: $*" >&2
exit 9
SH
chmod +x "$TMP/bin/docker"

run_verify() {
  : > "$TMP/state/docker-args"
  TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" XD_CONFIG_DIR="$TMP/home" \
    bash "$VERIFY" "$@"
}

run_verify >"$TMP/default.out"
grep -q 'compose.*stop server' "$TMP/state/docker-args"
grep -q 'compose.*run -T --rm --no-deps server storage verify --json' "$TMP/state/docker-args"
grep -q 'compose.*start server' "$TMP/state/docker-args"
if grep -q 'storage repair' "$TMP/state/docker-args"; then
  echo "default verify unexpectedly repaired metadata" >&2
  exit 1
fi

run_verify --repair >"$TMP/repair.out"
repair_line="$(grep -n 'storage repair --json' "$TMP/state/docker-args" | head -n1 | cut -d: -f1)"
verify_line="$(grep -n 'storage verify --json' "$TMP/state/docker-args" | tail -n1 | cut -d: -f1)"
[[ -n "$repair_line" && -n "$verify_line" && "$repair_line" -lt "$verify_line" ]]
grep -q 'compose.*start server' "$TMP/state/docker-args"

run_verify --repair --dry-run >"$TMP/dry-run.out"
grep -q 'storage repair --json --dry-run' "$TMP/state/docker-args"
if grep -q 'storage verify --json' "$TMP/state/docker-args"; then
  echo "repair dry-run unexpectedly ran full verify" >&2
  exit 1
fi

run_verify --summary-json >"$TMP/summary.out"
grep -q 'compose.*run -T --rm --no-deps server storage verify --summary-json' "$TMP/state/docker-args"

run_verify --mode deep --summary-json >"$TMP/deep-summary.out"
grep -q 'compose.*run -T --rm --no-deps -e XD_STORAGE_VERIFY_MODE=deep server storage verify --summary-json' "$TMP/state/docker-args"

run_verify --mode deep --progress >"$TMP/deep.out"
grep -q 'compose.*run -T --rm --no-deps -e XD_STORAGE_VERIFY_MODE=deep -e XD_STORAGE_VERIFY_PROGRESS=1 server storage verify --json' "$TMP/state/docker-args"
if grep -q 'storage repair' "$TMP/state/docker-args"; then
  echo "manual deep verification unexpectedly performed a repair" >&2
  exit 1
fi

run_verify --online --mode deep --progress >"$TMP/online-deep.out"
grep -q 'compose.*exec -T -e XD_STORAGE_VERIFY_MODE=deep -e XD_STORAGE_VERIFY_PROGRESS=1 server xdrive-server storage verify --json' "$TMP/state/docker-args"
if grep -q 'compose.*stop server' "$TMP/state/docker-args"; then
  echo "manual online deep verification must not stop Server" >&2
  exit 1
fi

run_verify --online >"$TMP/online.out"
grep -q 'compose.*exec -T server xdrive-server storage verify --json' "$TMP/state/docker-args"
if grep -q 'compose.*stop server' "$TMP/state/docker-args"; then
  echo "online verify unexpectedly stopped server" >&2
  exit 1
fi

set +e
run_verify --online --repair >"$TMP/invalid.out" 2>"$TMP/invalid.err"
status=$?
set -e
[[ "$status" -eq 2 ]]
grep -q -- '--repair cannot be combined with --online' "$TMP/invalid.err"

set +e
run_verify --mode invalid >"$TMP/mode-invalid.out" 2>"$TMP/mode-invalid.err"
mode_status=$?
set -e
[[ "$mode_status" -eq 2 ]]
grep -q -- '--mode must be fast or deep' "$TMP/mode-invalid.err"

grep -q "XD_STORAGE_VERIFY_MODE=deep" "$ROOT/scripts/server-restore.sh"

echo "server verify tests passed"
