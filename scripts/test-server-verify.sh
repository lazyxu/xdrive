#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY="$ROOT/scripts/server-verify.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/config" "$TMP/state"

printf 'XD_DOMAIN=\n' > "$TMP/config/.env"
printf 'name: xdrive\nservices: {}\n' > "$TMP/config/docker-compose.yml"

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
      if [[ "$*" == *"server xdrive-server storage verify --json"* ]]; then
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
      if [[ "$*" == *"server storage verify --json"* ]]; then
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
  TEST_STATE="$TMP/state" PATH="$TMP/bin:/usr/bin:/bin" XD_CONFIG_DIR="$TMP/config" \
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

echo "server verify tests passed"
