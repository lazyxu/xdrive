#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/out"
cat > "$tmp/bin/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "api --paginate") cat "$XD_TEST_INVENTORY" ;;
  "run download")
    [[ "${XD_TEST_FAIL_DOWNLOAD:-0}" == 0 ]] || exit 75
    name="" dir=""
    while (($#)); do
      case "$1" in
        --name) name="$2"; shift 2 ;;
        --dir) dir="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    [[ "$name" == xdrive-linux-amd64 && -n "$dir" ]] || exit 2
    printf 'validated-client-fixture' > "$dir/xdrive-linux-amd64.deb"
    ;;
  *) echo "unexpected gh mock command" >&2; exit 2 ;;
esac
MOCK
chmod +x "$tmp/bin/gh"
cat > "$tmp/inventory.json" <<'JSON'
{"artifacts":[
 {"name":"xdrive-linux-amd64","expired":false},
 {"name":"xdrive-windows-amd64","expired":true}
]}
JSON
run() {
  env PATH="$tmp/bin:$PATH" GH_TOKEN=fixture GITHUB_RUN_ID=123456789 \
    GITHUB_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    GITHUB_REPOSITORY=lazyxu/xdrive XD_TEST_INVENTORY="$tmp/inventory.json" \
    bash "$root/scripts/ci/download-optional-client-artifacts.sh" "$tmp/out"
}
run
test -s "$tmp/out/xdrive-linux-amd64.deb"
test "$(find "$tmp/out" -maxdepth 1 -type f | wc -l)" -eq 1
printf 'not-json' > "$tmp/inventory.json"
if run >/dev/null 2>&1; then
  echo "malformed inventory was treated as an absent artifact" >&2
  exit 1
fi
cat > "$tmp/inventory.json" <<'JSON'
{"artifacts":[{"name":"xdrive-linux-amd64","expired":false}]}
JSON
if XD_TEST_FAIL_DOWNLOAD=1 run >/dev/null 2>&1; then
  echo "failed exact-artifact retrieval was treated as missing" >&2
  exit 1
fi
echo "Optional exact-commit client artifact collection: 3/3 passed."
