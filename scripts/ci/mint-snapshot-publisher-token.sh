#!/usr/bin/env bash
# Mint exactly one repository-scoped GitHub App installation token.
# GitHub's live JWT endpoint requires an INTEGER iss claim. The pinned
# create-github-app-token@v3.3.0 serializes client-id/app-id as a string,
# which GitHub currently rejects with HTTP 401.
set -euo pipefail
umask 077

if [[ -z "$GITHUB_OUTPUT" || "$GITHUB_REPOSITORY" != "lazyxu/xdrive" ]]; then
  echo "::error title=Snapshot publisher scope::Only lazyxu/xdrive Actions may mint this token." >&2
  exit 1
fi
if [[ ! "$XD_SNAPSHOT_APP_ID" =~ ^[1-9][0-9]*$ ]] ||
   [[ "$(printf '%s' "$XD_SNAPSHOT_APP_ID" | wc -c)" -gt 15 ]]; then
  echo "::error title=Invalid Snapshot App ID::Set numeric GitHub App ID in XD_SNAPSHOT_APP_ID (not the Iv1. Client ID)." >&2
  exit 1
fi
if [[ -z "$XD_SNAPSHOT_APP_PRIVATE_KEY" ]]; then
  echo "::error title=Missing Snapshot App private key::Set XD_SNAPSHOT_APP_PRIVATE_KEY in Repository Secrets." >&2
  exit 1
fi
key="$(mktemp)"
trap 'rm -f "$key"' EXIT
printf '%s\n' "$XD_SNAPSHOT_APP_PRIVATE_KEY" > "$key"
if ! openssl pkey -in "$key" -noout 2>/dev/null; then
  echo "::error title=Invalid Snapshot private key::The configured key is not a valid signing PEM." >&2
  exit 1
fi

base64url() { openssl base64 -A | tr '/+' '_-' | tr -d '='; }
now="$(date -u +%s)"
iat="$((now - 60))"
exp="$((now + 480))"
header="$(printf '%s' '{"alg":"RS256","typ":"JWT"}' | base64url)"
payload="$(jq -cn --argjson iat "$iat" --argjson exp "$exp" \
  --argjson iss "$XD_SNAPSHOT_APP_ID" \
  '{iat:$iat,exp:$exp,iss:$iss}' | base64url)"
signed="$header.$payload"
signature="$(printf '%s' "$signed" | openssl dgst -sha256 -sign "$key" -binary | base64url)"
jwt="$signed.$signature"

# Never log the JWT, private key, REST JSON token body, or signed headers.
installation_response="$(curl --fail --silent --show-error --connect-timeout 10 --max-time 25 \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $jwt" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "https://api.github.com/repos/$GITHUB_REPOSITORY/installation")" || {
    echo "::error title=Snapshot App authentication::Verify numeric App ID, matching private key, and installation on lazyxu/xdrive." >&2
    exit 1
  }
installation_id="$(jq -er --argjson app "$XD_SNAPSHOT_APP_ID" \
  'select(.app_id == $app) | .id | select(type == "number" and . > 0)' \
  <<< "$installation_response")" || {
    echo "::error title=Snapshot App installation::App ID mismatch or inaccessible repository installation." >&2
    exit 1
  }

repo_name="$(printf '%s' "$GITHUB_REPOSITORY" | cut -d/ -f2)"
request_body="$(jq -cn --arg repo "$repo_name" \
  '{repositories:[$repo],permissions:{contents:"write",workflows:"write"}}')"
token_response="$(curl --fail --silent --show-error --connect-timeout 10 --max-time 25 \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $jwt" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  --data-binary "$request_body" \
  "https://api.github.com/app/installations/$installation_id/access_tokens")" || {
    echo "::error title=Snapshot App permissions::Installation token denied. Check Contents/Workflows write and repository selection." >&2
    exit 1
  }
token="$(jq -er --arg repo "$GITHUB_REPOSITORY" '
  select(.permissions.contents == "write" and .permissions.workflows == "write") |
  select([.repositories[]?.full_name] == [$repo]) |
  .token | select(type == "string" and length >= 20)
' <<< "$token_response")" || {
    echo "::error title=Snapshot token scope::GitHub did not grant both write permissions scoped to exactly lazyxu/xdrive." >&2
    exit 1
  }
printf '::add-mask::%s\n' "$token"
printf 'token=%s\n' "$token" >> "$GITHUB_OUTPUT"
echo "[xDrive] Scoped Snapshot token created with integer JWT issuer; no credentials printed."
