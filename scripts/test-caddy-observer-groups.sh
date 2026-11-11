#!/usr/bin/env bash
# Real Linux supplementary-group regression. Uses only a disposable directory;
# no user/group database, installed Host state or Docker socket is changed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(id -u)" == 0 ]] || { echo 'Run this fixture as root in an isolated runner.' >&2; exit 2; }
command -v setpriv >/dev/null
# CI may set TMPDIR to the runner\u0027s private 0700 directory. The\n# setpriv users 65531/65532 cannot traverse that parent, even after chmod\n# of the child fixture. Use the shared sticky /tmp; mktemp still creates a\n# unique directory and all security/group assertions below remain intact.\nscratch="$(mktemp -d /tmp/xdrive-caddy-observer-groups.XXXXXXXX)"
trap 'rm -rf -- "$scratch"' EXIT
chmod 755 "$scratch"
mkdir -p "$scratch/xd/config" "$scratch/xd/bin" "$scratch/xd/state/control"
cp "$ROOT/scripts/server-control.sh" "$scratch/xd/bin/server-control.sh"
printf 'XD_SERVER_GID=65532\n' > "$scratch/xd/config/.env"
cat > "$scratch/run" <<'SH'
set -euo pipefail
export XD_CONFIG_DIR="$1/xd" XD_HOST_CONTROL_SOURCE_ONLY=1 XD_CADDY_OBSERVER_ONCE=1
source "$XD_CONFIG_DIR/bin/server-control.sh"
# Only replace external samplers; run the real observer startup, group check,
# prepare_dir, source fingerprint, lock and fixed snapshot publication.
caddy_env_refresh() {
  local dir tmp
  dir="$(prepare_dir)" || return 1
  tmp="$(mktemp "$dir/.snapshot.XXXXXX")"
  printf 'fresh\n' > "$tmp"
  chmod 660 "$tmp"
  mv "$tmp" "$dir/caddy-env-observed.json"
}
caddy_host_refresh() { return 0; }
caddy_compat_observe_cmd
SH
chown -R 65531:65531 "$scratch/xd"
bridge="$scratch/xd/state/control"
chown 65531:65532 "$bridge"
chmod 2770 "$bridge"
printf 'original\n' > "$bridge/caddy-env-observed.json"
chown 65531:65532 "$bridge/caddy-env-observed.json"
chmod 660 "$bridge/caddy-env-observed.json"

# Reproduce the OS behavior which made the legacy observer corrupt the bridge.
mkdir "$scratch/kernel-probe"
chown 65531:65532 "$scratch/kernel-probe"
chmod 2770 "$scratch/kernel-probe"
(cd "$scratch"; setpriv --reuid=65531 --regid=65531 --clear-groups chmod 2770 kernel-probe)
[[ "$(stat -c '%a' "$scratch/kernel-probe")" == 770 ]]

# A stale process must exit BEFORE chmod, lock creation or snapshot replacement.
if (cd "$scratch"; setpriv --reuid=65531 --regid=65531 --clear-groups bash run .); then
  echo 'stale observer unexpectedly succeeded' >&2; exit 1
fi
[[ "$(stat -c '%a:%g' "$bridge")" == 2770:65532 ]]
[[ "$(stat -c '%a:%g' "$bridge/caddy-env-observed.json")" == 660:65532 ]]
[[ "$(cat "$bridge/caddy-env-observed.json")" == original ]]
[[ ! -e "$bridge/caddy-observer.lock" && ! -e "$bridge/caddy-observer.pid" ]]

# A fresh login with the SAME primary UID/GID and required supplementary group
# may publish. This is not a check of the account database's current groups.
(cd "$scratch"; setpriv --reuid=65531 --regid=65531 --groups=65532 bash run .)
[[ "$(stat -c '%a:%g' "$bridge")" == 2770:65532 ]]
[[ "$(stat -c '%a:%g' "$bridge/caddy-env-observed.json")" == 660:65532 ]]
[[ "$(cat "$bridge/caddy-env-observed.json")" == fresh ]]
(cd "$scratch"; setpriv --reuid=65532 --regid=65532 --clear-groups cat xd/state/control/caddy-env-observed.json) >/dev/null
echo 'Caddy observer actual supplementary-group regression: PASS'
