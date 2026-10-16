#!/usr/bin/env bash
# CI-ONLY: real localhost-only Caddy rescue and authenticated Server API drill.
# This runs exclusively inside the disposable rootless Docker E2E daemon.
set -Eeuo pipefail
umask 077

if (( $# != 6 )); then
  echo "CI rescue drill requires env, compose, main port, exact test image, rescue port and temp root" >&2
  exit 2
fi
env_path="$1"
compose_path="$2"
main_port="$3"
rescue_image="$4"
rescue_port="$5"
scratch_root="$6"
[[ -f "$env_path" && -f "$compose_path" && -d "$scratch_root" ]] || exit 2
[[ "$main_port" =~ ^[0-9]{4,5}$ && "$rescue_port" =~ ^[0-9]{4,5}$ ]] || exit 2
(( rescue_port >= 1024 && rescue_port <= 65535 && rescue_port != main_port )) || exit 2
[[ "$rescue_image" == 127.0.0.1:*"/xdrive-caddy:"* ]] || {
  echo "CI rescue image must come from the disposable local test registry" >&2
  exit 2
}
command -v docker >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null

tmp="$(mktemp -d "$scratch_root/rescue-verify.XXXXXX")"
export XD_CADDY_RESCUE_IMAGE="$rescue_image"
export XD_CADDY_RESCUE_PORT="$rescue_port"
main_stopped=false

compose() {
  docker compose --env-file "$env_path" -f "$compose_path" "$@"
}
cleanup() {
  set +e
  if [[ "$main_stopped" == true ]]; then
    compose start caddy >/dev/null 2>&1
  fi
  compose --profile caddy-rescue stop caddy-rescue >/dev/null 2>&1
  compose --profile caddy-rescue rm -f caddy-rescue >/dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT

[[ -z "$(docker ps -a --filter 'name=^/xdrive-caddy-rescue$' --format '{{.Names}}')" ]] || {
  echo "default Rootless installation unexpectedly started Caddy rescue" >&2
  exit 1
}

primary_before="$(docker inspect xdrive-caddy --format '{{.Id}}|{{.State.StartedAt}}|{{.State.Pid}}')"
echo "[rootless-e2e] opt-in independent Caddy rescue with exact CI-built local image"
compose --profile caddy-rescue up -d --no-deps caddy-rescue >/dev/null
rescue_id="$(compose --profile caddy-rescue ps -q caddy-rescue)"
[[ -n "$rescue_id" ]] || { echo "missing independently created Caddy rescue" >&2; exit 1; }

# Inspect actual Docker runtime, not only Compose's declarative port mapping.
docker inspect "$rescue_id" --format '{{json .NetworkSettings.Ports}}' > "$tmp/ports.json"
docker inspect "$rescue_id" --format '{{json .Mounts}}' > "$tmp/mounts.json"
docker inspect "$rescue_id" --format '{{json .Config.Env}}' > "$tmp/env.json"
python3 - "$tmp" "$rescue_port" <<'PY'
import json, pathlib, sys
tmp = pathlib.Path(sys.argv[1])
port = sys.argv[2]
ports = json.loads((tmp / "ports.json").read_text())
mapping = ports.get("8080/tcp")
assert isinstance(mapping, list) and len(mapping) == 1
assert mapping[0] == {"HostIp": "127.0.0.1", "HostPort": port}
assert json.loads((tmp / "mounts.json").read_text()) == [], "rescue must not share host volumes"
env = json.loads((tmp / "env.json").read_text())
keys = {item.partition("=")[0] for item in env}
for secret in ("ALIYUN_ACCESS_KEY_ID", "ALIYUN_ACCESS_KEY_SECRET",
               "XD_JWT_SECRET", "XD_CONNECTOR_SECRET_KEYS", "XD_DATABASE_URL"):
    assert secret not in keys, "rescue must not receive deployment credentials"
PY
[[ "$(docker inspect xdrive-caddy --format '{{.Id}}|{{.State.StartedAt}}|{{.State.Pid}}')" == "$primary_before" ]] || {
  echo "opt-in rescue startup must not replace or restart the primary Caddy" >&2
  exit 1
}
[[ "$(docker inspect "$rescue_id" --format '{{.Config.Image}}')" == "$rescue_image" ]] || {
  echo "rescue is not using the exact test Caddy image" >&2
  exit 1
}

url="http://127.0.0.1:$rescue_port"
healthy=false
for _ in $(seq 1 90); do
  if [[ "$(docker inspect "$rescue_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)" == healthy ]] &&
      curl --fail --silent --max-time 3 "$url/api/v1/readyz" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  # Diagnostic output is limited to bounded state enums, health exit codes,
  # header-free HTTP status, and an allowlisted log classification.
  # Do not print raw Docker logs, environment or any request contents.
  rescue_state="$(docker inspect "$rescue_id" --format '{{.State.Status}}' 2>/dev/null || true)"
  rescue_health="$(docker inspect "$rescue_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}absent{{end}}' 2>/dev/null || true)"
  rescue_restarts="$(docker inspect "$rescue_id" --format '{{.RestartCount}}' 2>/dev/null || true)"
  rescue_exit_codes="$(docker inspect "$rescue_id" --format '{{if .State.Health}}{{range .State.Health.Log}}{{.ExitCode}} {{end}}{{end}}' 2>/dev/null || true)"
  rescue_http="$(curl --silent --max-time 3 -o /dev/null -w '%{http_code}' "$url/api/v1/readyz" || true)"
  log_class=unclassified
  if docker logs --tail 40 "$rescue_id" 2>&1 | grep -qiE 'permission denied|read-only file system|operation not permitted'; then
    log_class=filesystem-permission
  elif docker logs --tail 40 "$rescue_id" 2>&1 | grep -qiE 'unrecognized directive|adapting config|parsing caddyfile'; then
    log_class=caddy-config
  elif docker logs --tail 40 "$rescue_id" 2>&1 | grep -qiE 'bind: address already in use|listen tcp.*address already in use'; then
    log_class=listener-bind
  elif docker logs --tail 40 "$rescue_id" 2>&1 | grep -qiE 'unknown command|unrecognized command'; then
    log_class=command-entrypoint
  fi
  [[ "$rescue_state" =~ ^[a-z-]{0,30}$ ]] || rescue_state=invalid
  [[ "$rescue_health" =~ ^[a-z-]{0,30}$ ]] || rescue_health=invalid
  [[ "$rescue_restarts" =~ ^[0-9]{0,8}$ ]] || rescue_restarts=invalid
  [[ "$rescue_http" =~ ^[0-9]{3}$ ]] || rescue_http=000
  [[ "$rescue_exit_codes" =~ ^[0-9[:space:]]{0,24}$ ]] || rescue_exit_codes=invalid
  echo "rescue not healthy: state=$rescue_state health=$rescue_health restarts=$rescue_restarts HTTP=$rescue_http health_exit_codes=[$rescue_exit_codes] log_class=$log_class" >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 8 "$url/" -o "$tmp/index.html"
grep -qi '<html' "$tmp/index.html"

# Protected admin route must not be accessible to anonymous rescue callers.
code="$(curl --silent --max-time 8 -o /dev/null -w '%{http_code}' "$url/api/v1/admin/services")"
[[ "$code" == 401 ]] || { echo "rescue unexpectedly permits anonymous admin access" >&2; exit 1; }

# Use the synthetic CI admin created by test-server-rootless-e2e.sh; don't
# expose real credentials, bearer tokens or login response in argv/logs.
printf '%s' '{"username":"upgrade-e2e","password":"RootlessE2E-Password-123!"}' > "$tmp/login.json"
code="$(curl --silent --show-error --max-time 8 -o "$tmp/login-response.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary @"$tmp/login.json" \
  "$url/api/v1/auth/login")"
[[ "$code" == 200 ]] || { echo "rescue failed real Server administrator login" >&2; exit 1; }
python3 - "$tmp/login-response.json" "$tmp/curl-auth.conf" <<'PY'
import json, os, re, sys
reply = json.load(open(sys.argv[1], encoding="utf-8"))
assert reply.get("role") == "admin", "login must be an actual administrator"
token = reply.get("access_token")
assert isinstance(token, str) and re.fullmatch(r"[A-Za-z0-9_.-]{20,4096}", token)
fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="ascii") as auth:
    auth.write('header = "Authorization: Bearer ' + token + '"\n')
PY
rm -f "$tmp/login-response.json" "$tmp/login.json"
check_admin() {
  curl --fail --silent --show-error --max-time 8 \
    --config "$tmp/curl-auth.conf" "$url/api/v1/admin/services" \
    -o "$tmp/admin-response.json"
  python3 - "$tmp/admin-response.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
ids = {row.get("id") for row in data.get("services", [])}
assert {"caddy", "baidu-map", "geonames"}.issubset(ids), "admin service inventory missing"
PY
}
check_admin
echo "[rootless-e2e] real rescue login and protected admin status authorized"

# Destructive PRIMARY-Caddy failure simulation is permitted ONLY in this
# disposable rootless CI daemon, NEVER through a production admin endpoint.
compose stop caddy >/dev/null
main_stopped=true
[[ "$(docker inspect xdrive-caddy --format '{{.State.Running}}')" == false ]] || exit 1
[[ "$(docker inspect xdrive-server --format '{{.State.Running}}')" == true ]] || {
  echo "primary Caddy stop unexpectedly stopped the Server" >&2
  exit 1
}
[[ "$(docker inspect "$rescue_id" --format '{{.Id}}|{{.State.Running}}')" == "$rescue_id|true" ]] || {
  echo "rescue was not independent of primary Caddy" >&2
  exit 1
}
check_admin
code="$(curl --silent --max-time 8 -o /dev/null -w '%{http_code}' "$url/api/v1/admin/services")"
[[ "$code" == 401 ]] || { echo "rescue lost its anonymous-access denial after main stop" >&2; exit 1; }
echo "[rootless-e2e] protected rescue API still works with primary Caddy STOPPED"

compose start caddy >/dev/null
main_stopped=false
restored=false
for _ in $(seq 1 90); do
  if curl --fail --silent --max-time 3 "http://127.0.0.1:$main_port/api/v1/readyz" >/dev/null; then
    restored=true
    break
  fi
  sleep 1
done
[[ "$restored" == true ]] || { echo "primary Caddy not restored after isolated test" >&2; exit 1; }
check_admin
echo "[rootless-e2e] main Caddy restored; authenticated independent rescue still works"
