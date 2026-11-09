#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/scripts/ci"
for file in gitlab-stable-prestage-gate.sh gitlab-stage-image.sh \
            gitlab-release-version.sh gitlab-registry-utils.sh; do
  cp "$ROOT/scripts/ci/$file" "$TMP/scripts/ci/$file"
done
cat > "$TMP/bin/go" <<'GO'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_GATE_LOG"
[[ "${MOCK_GATE_FAIL:-0}" != 1 ]]
GO
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
echo "$*" >> "$MOCK_DOCKER_LOG"
exit 98
DOCKER
chmod +x "$TMP/bin/go" "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"
export MOCK_GATE_LOG="$TMP/go.log" MOCK_DOCKER_LOG="$TMP/docker.log"
: > "$MOCK_GATE_LOG"
: > "$MOCK_DOCKER_LOG"
export CI_COMMIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export CI_COMMIT_BRANCH=master CI_COMMIT_TAG=""
cd "$TMP"

# No GitHub CI dependency for normal master source-exact staging.
bash scripts/ci/gitlab-stable-prestage-gate.sh
[[ ! -s "$MOCK_GATE_LOG" ]] || { echo 'master called stable-only gate' >&2; exit 1; }

# Stable v* must invoke EXACT named GitHub gate, before any image push.
CI_COMMIT_TAG=v1.2.3 bash scripts/ci/gitlab-stable-prestage-gate.sh
grep -Fxq 'run scripts/ci/verify-github-stable-final-gate.go' "$MOCK_GATE_LOG"

# Invalid tag and full Commit abort before attempting GitHub API or Registry.
: > "$MOCK_GATE_LOG"
if CI_COMMIT_TAG='v1-invalid' bash scripts/ci/gitlab-stable-prestage-gate.sh >/dev/null 2>&1; then
  echo 'invalid stable tag not rejected' >&2; exit 1
fi
if CI_COMMIT_SHA=short CI_COMMIT_TAG=v1.2.3 bash scripts/ci/gitlab-stable-prestage-gate.sh >/dev/null 2>&1; then
  echo 'invalid stable Commit not rejected' >&2; exit 1
fi
[[ ! -s "$MOCK_GATE_LOG" ]] || { echo 'gate invoked before tag validation' >&2; exit 1; }

# The real staging script MUST fail before inspecting or uploading an image
# if exact stable Final Gate has failed.
export CI_COMMIT_TAG=v1.2.3 MOCK_GATE_FAIL=1
export CI_PIPELINE_ID=77 CI_JOB_ID=99
if bash scripts/ci/gitlab-stage-image.sh xdrive-server dist/server-image xdrive/server:test > "$TMP/stage.err" 2>&1; then
  echo 'failed GitHub Final Gate allowed GitLab image staging' >&2; exit 1
fi
[[ ! -s "$MOCK_DOCKER_LOG" ]] || {
  echo 'Docker was invoked before stable Final Gate' >&2; exit 1
}
grep -Fxq 'run scripts/ci/verify-github-stable-final-gate.go' "$MOCK_GATE_LOG"

# Photo Face also has a prior check before *runtime cache* Registry writes,
# not just an eventual check before its final image is staged.
photo="$ROOT/scripts/ci/test-photo-face-image.sh"
grep -Fq 'bash scripts/ci/gitlab-stable-prestage-gate.sh' "$photo"
grep -Fq 'runtime_registry_tag="$CI_REGISTRY_IMAGE/xdrive-photo-face-runtime:contract-$runtime_contract_hash"' "$photo"
gate_line="$(grep -n 'bash scripts/ci/gitlab-stable-prestage-gate.sh' "$photo" | head -n1 | cut -d: -f1)"
runtime_line="$(grep -n 'runtime_registry_tag="$CI_REGISTRY_IMAGE/xdrive-photo-face-runtime' "$photo" | head -n1 | cut -d: -f1)"
((gate_line < runtime_line)) || { echo 'Photo Face runtime upload precedes Final Gate' >&2; exit 1; }

echo 'GitLab stable pre-stage gate: validated tag/SHA, master bypass, fail-before-Docker, Photo Face runtime guard'
