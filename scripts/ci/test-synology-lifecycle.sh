#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/packaging/synology/scripts/start-stop-status"
tmp="$(mktemp -d)"
cleanup() {
  export SYNOPKG_PKGDEST="$tmp/target" SYNOPKG_PKGHOME="$tmp/home" SYNOPKG_PKGVAR="$tmp/var"
  "$SCRIPT" stop >/dev/null 2>&1 || true
  [[ -z "${stranger:-}" ]] || kill "$stranger" 2>/dev/null || true
  [[ -z "${spoof_pid:-}" ]] || kill "$spoof_pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/target/bin" "$tmp/home-real" "$tmp/var-real"
ln -s "$tmp/home-real" "$tmp/home"
ln -s "$tmp/var-real" "$tmp/var"

cat > "$tmp/mock.go" <<'GO'
package main
import (
    "fmt"
    "os"
    "os/signal"
    "syscall"
)
func main() {
    if len(os.Args) != 2 || os.Args[1] != "--backup-only" { os.Exit(20) }
    f, err := os.OpenFile(os.Getenv("XDG_CACHE_HOME")+"/agent-environment", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
    if err != nil { os.Exit(21) }
    fmt.Fprintln(f, os.Getenv("HOME"), os.Getenv("XDG_CONFIG_HOME"), os.Getenv("GOMEMLIMIT"))
    _ = f.Close()
    ch := make(chan os.Signal, 1)
    signal.Notify(ch, syscall.SIGTERM)
    <-ch
}
GO
GO111MODULE=off go build -o "$tmp/target/bin/xdrive-agent" "$tmp/mock.go"
export SYNOPKG_PKGDEST="$tmp/target" SYNOPKG_PKGHOME="$tmp/home" SYNOPKG_PKGVAR="$tmp/var"

check_status() {
  local expected="$1"
  set +e
  "$SCRIPT" status
  local got="$?"
  set -e
  [[ "$got" == "$expected" ]] || { echo "expected status $expected, got $got" >&2; exit 1; }
}

check_status 3
"$SCRIPT" prestart
"$SCRIPT" start
check_status 0
pid1="$(cat "$tmp/var/run/agent.pid")"
"$SCRIPT" start
pid2="$(cat "$tmp/var/run/agent.pid")"
[[ "$pid1" == "$pid2" ]] || { echo 'double start spawned another Agent' >&2; exit 1; }
[[ -f "$tmp/var-real/cache/agent-environment" ]]
grep -Fq "$tmp/home/.config" "$tmp/var-real/cache/agent-environment"
grep -Fq '128MiB' "$tmp/var-real/cache/agent-environment"
"$SCRIPT" stop
check_status 3
# Replace the whole target directory as DSM does during an SPK upgrade.
# A persisted credential/config is intentionally outside the replaced target.
printf '%s\n' 'must-survive-upgrade' > "$tmp/home-real/.config/credentials-probe"
cp "$tmp/target/bin/xdrive-agent" "$tmp/replacement-agent"
rm -rf "$tmp/target"
mkdir -p "$tmp/target/bin"
install -m 0755 "$tmp/replacement-agent" "$tmp/target/bin/xdrive-agent"
"$SCRIPT" start
check_status 0
[[ "$(cat "$tmp/home-real/.config/credentials-probe")" == 'must-survive-upgrade' ]]
"$SCRIPT" stop
check_status 3

# Refuse symlink redirection for private config data under DSM-managed home.
mv "$tmp/home-real/.config" "$tmp/home-real/.config-safe"
mkdir "$tmp/unsafe-config"
ln -s "$tmp/unsafe-config" "$tmp/home-real/.config"
if "$SCRIPT" start >/dev/null 2>&1; then
  echo 'private config symlink unexpectedly allowed Agent to start' >&2
  exit 1
fi
check_status 3
rm "$tmp/home-real/.config"
mv "$tmp/home-real/.config-safe" "$tmp/home-real/.config"

# The pidfile cannot authorize signaling a reused unrelated process.
sleep 60 &
stranger=$!
printf '%s\n' "$stranger" > "$tmp/var-real/run/agent.pid"
check_status 1
"$SCRIPT" stop
kill -0 "$stranger"
check_status 3

# Reject another executable forging the real Agent's argv[0] and argv[1].
cp "$tmp/target/bin/xdrive-agent" "$tmp/forged-agent"
(
  export XDG_CACHE_HOME="$tmp/var/cache"
  exec -a "$tmp/target/bin/xdrive-agent" "$tmp/forged-agent" --backup-only
) &
spoof_pid=$!
sleep 1
kill -0 "$spoof_pid" || { echo 'forged process exited before test' >&2; exit 1; }
printf '%s\n' "$spoof_pid" > "$tmp/var-real/run/agent.pid"
check_status 1
"$SCRIPT" stop
kill -0 "$spoof_pid" || { echo 'stop signaled forged process!' >&2; exit 1; }
kill "$spoof_pid"
wait "$spoof_pid" || true
spoof_pid=''
check_status 3

# An inaccessible/missing agent must never be reported as running.
rm "$tmp/target/bin/xdrive-agent"
if "$SCRIPT" start; then
  echo 'missing executable unexpectedly allowed to start' >&2
  exit 1
fi
check_status 3
printf '%s\n' 'Synology lifecycle passed: cold start, idempotence, SIGTERM, FHS symlinks, persistence, PID reuse, symlink refusal and forged argv.'
