#!/usr/bin/env bash
set -euo pipefail
umask 077

CONFIG_DIR="${XD_CONFIG_DIR:-$HOME/.xd}"
COMPOSE_PATH="$CONFIG_DIR/docker-compose.yml"
ENV_PATH="$CONFIG_DIR/.env"
SOURCE_REF="${XD_SOURCE_REF:-@SOURCE_REF@}"
IMAGE_TAG="${XD_IMAGE_TAG:-@IMAGE_TAG@}"
REPOSITORY="${XD_GITHUB_REPOSITORY:-lazyxu/xdrive}"

if [[ "$SOURCE_REF" == "@SOURCE_REF@" ]]; then
  SOURCE_REF="master"
fi
if [[ "$IMAGE_TAG" == "@IMAGE_TAG@" ]]; then
  IMAGE_TAG="edge"
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "xDrive server installer: missing required command: $1" >&2
    exit 1
  }
}

case "$(uname -m)" in
  x86_64|amd64) ;;
  *)
    echo "xDrive server installer: current published images support Linux amd64 only." >&2
    exit 1
    ;;
esac

need docker
if ! docker compose version >/dev/null 2>&1; then
  echo "xDrive server installer: Docker Compose v2 is required (docker compose)." >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

raw_url="https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_REF/deploy/docker-compose.yml"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$raw_url" -o "$COMPOSE_PATH.tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$COMPOSE_PATH.tmp" "$raw_url"
else
  echo "xDrive server installer: curl or wget is required." >&2
  exit 1
fi
mv "$COMPOSE_PATH.tmp" "$COMPOSE_PATH"
chmod 600 "$COMPOSE_PATH"

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$bytes" <<'PY'
import secrets, sys
print(secrets.token_hex(int(sys.argv[1])))
PY
  else
    od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

ensure_env() {
  local key="$1" value="$2"
  if ! grep -q "^${key}=" "$ENV_PATH" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"
  fi
}

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_PATH" 2>/dev/null; then
    local tmp="$ENV_PATH.tmp"
    awk -v k="$key" -v v="$value" 'BEGIN{FS="="} $1==k{print k "=" v; next} {print}' "$ENV_PATH" > "$tmp"
    mv "$tmp" "$ENV_PATH"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_PATH"
  fi
}

touch "$ENV_PATH"
chmod 600 "$ENV_PATH"
ensure_env POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-$(random_hex 24)}"
ensure_env XD_JWT_SECRET "${XD_JWT_SECRET:-$(random_hex 48)}"
ensure_env XD_ACCESS_TOKEN_TTL "${XD_ACCESS_TOKEN_TTL:-15m}"
ensure_env XD_REFRESH_TOKEN_TTL "${XD_REFRESH_TOKEN_TTL:-720h}"
ensure_env XD_WEB_BIND "${XD_WEB_BIND:-0.0.0.0}"
ensure_env XD_WEB_PORT "${XD_WEB_PORT:-3000}"
ensure_env XD_ALLOWED_ORIGIN "${XD_ALLOWED_ORIGIN:-http://localhost:3000}"
ensure_env XD_MAX_UPLOAD_BYTES "${XD_MAX_UPLOAD_BYTES:-21474836480}"
set_env XD_SERVER_IMAGE "ghcr.io/lazyxu/xdrive-server:$IMAGE_TAG"
set_env XD_WEB_IMAGE "ghcr.io/lazyxu/xdrive-web:$IMAGE_TAG"

compose() {
  docker compose --env-file "$ENV_PATH" -f "$COMPOSE_PATH" "$@"
}

echo "xDrive compose: $COMPOSE_PATH"
echo "xDrive env:     $ENV_PATH"

if [[ "${XD_INSTALL_NO_START:-0}" == "1" ]]; then
  echo "Files installed. Start later with:"
  echo "  docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' pull"
  echo "  docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' up -d"
  exit 0
fi

if ! compose pull; then
  cat >&2 <<'MSG'
xDrive server installer: container pull failed.
If this is the first GHCR publication, make the xdrive-server and xdrive-web
container packages Public in GitHub package settings, or authenticate first:
  docker login ghcr.io
MSG
  exit 1
fi
compose up -d --remove-orphans
compose ps

echo
echo "xDrive is running. Default Web URL: http://localhost:$(grep '^XD_WEB_PORT=' "$ENV_PATH" | cut -d= -f2-)"
echo "Manage it with: docker compose --env-file '$ENV_PATH' -f '$COMPOSE_PATH' <command>"
