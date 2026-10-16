#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# Syntax and actual Compose-normalized port mapping, not a claim the
# independent operator login or recovery has succeeded on a real host.
for port in 3080 3089; do
  COMPOSE_PROFILES= POSTGRES_PASSWORD=fixture-only XD_JWT_SECRET=fixture-only \
    XD_CADDY_RESCUE_PORT="$port" docker compose --profile caddy-rescue \
    -f "$ROOT/deploy/docker-compose.yml" config --format json > "$scratch/config.json"
  python3 - "$scratch/config.json" "$port" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
port = sys.argv[2]
services = data.get("services", {})
assert "server" in services and "caddy" in services, "main services must remain unchanged"
rescue = services["caddy-rescue"]
assert rescue["profiles"] == ["caddy-rescue"], "must be opt-in"
assert rescue.get("container_name") == "xdrive-caddy-rescue"
assert rescue.get("read_only") is True
assert rescue.get("cap_drop") == ["ALL"]
assert "no-new-privileges:true" in rescue.get("security_opt", [])
assert rescue.get("user") == "65532:65532"
assert rescue["command"] == [
    "caddy", "run", "--config", "/etc/caddy/Caddyfile.rescue",
    "--adapter", "caddyfile",
]
assert rescue.get("depends_on", {}).get("server", {}).get("condition") == "service_healthy"
assert rescue.get("volumes") in (None, []), "no shared Caddy storage"
assert any(x.startswith("/tmp:") for x in rescue.get("tmpfs", []))
assert rescue.get("environment") == {
    "XDG_CONFIG_HOME": "/tmp/caddy-rescue-config",
    "XDG_DATA_HOME": "/tmp/caddy-rescue-data",
}, "no AliDNS/JWT/other credentials may enter rescue environment"
ports = rescue.get("ports", [])
assert len(ports) == 1, "exactly one local-only recovery listener"
p = ports[0]
assert p.get("host_ip") == "127.0.0.1", "no public recovery listener"
assert str(p.get("published")) == port and p.get("target") == 8080
assert p.get("protocol") == "tcp"
assert "127.0.0.1:8080/api/v1/readyz" in " ".join(rescue["healthcheck"]["test"])
assert "ALIYUN_ACCESS_KEY_SECRET" not in json.dumps(rescue)
print("Optional separate recovery ingress: loopback-only, readonly, no admin proof:", port)
PY
done

python3 - "$ROOT/deploy/Caddyfile.rescue" <<'PY'
from pathlib import Path
import sys
config = Path(sys.argv[1]).read_text()
assert "admin off" in config
assert "auto_https off" in config
assert ":8080" in config
assert "import xdrive_app" in config
assert "dns alidns" not in config
assert "ALIYUN_ACCESS_KEY" not in config
PY
echo "Optional Caddy rescue profile: separated and private Compose contract OK"
python3 "$ROOT/scripts/test-caddy-rescue-operator-check.py"
