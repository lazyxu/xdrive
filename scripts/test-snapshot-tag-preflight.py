#!/usr/bin/env python3
"""Run the actual Snapshot tag permission preflight against a fake GitHub API."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap

root = Path(__file__).resolve().parents[1]
release = (root / ".github/workflows/release.yml").read_text(encoding="utf-8")
ci = (root / ".github/workflows/ci.yml").read_text(encoding="utf-8")
marker = "      - name: Probe snapshot Git ref authorization before release mutation\n"
assert release.count(marker) == 1, "must have one Snapshot Git ref permission probe"
preflight = release.split(marker, 1)[1].split("        run: |\n", 1)[1]
script = textwrap.dedent(preflight.split("\n      - name:", 1)[0])
assert release.index(marker) < release.index("      - name: Log in to GHCR for channel promotion")
assert release.index(marker) < release.index("      - name: Publish rolling snapshot prerelease")
assert "python3 scripts/test-snapshot-tag-preflight.py" in ci


# The optional App token must be minted in the trusted release bundle,
# after signing, and before any public image or Release mutation.
identity = "      - name: Validate optional Snapshot publisher identity\n"
mint = "      - name: Mint scoped Snapshot publisher token\n"
stale = "      - name: Reject stale master snapshot before channel promotion\n"
assert release.count(identity) == 1 and release.count(mint) == 1
assert release.index("      - name: Cryptographically verify signed bundle before releasing") < release.index(identity)
assert release.index(identity) < release.index(mint) < release.index(stale) < release.index(marker)
# The Client ID may live in Repository Variables or Repository Secrets, but
# only this trusted publisher job may read it. Do not make private-key-only
# configuration sufficient to mint a token, and do not weaken fail-closed.
bundle = release.split("  bundle:\n", 1)[1].split("    steps:\n", 1)[0]
assert "SNAPSHOT_APP_CLIENT_ID: ${{ vars.XD_SNAPSHOT_APP_CLIENT_ID || secrets.XD_SNAPSHOT_APP_CLIENT_ID }}" in bundle
assert bundle.count("SNAPSHOT_APP_CLIENT_ID:") == 1
guard = release.split(identity, 1)[1].split(mint, 1)[0]
assert "HAS_SNAPSHOT_APP_CLIENT_ID: ${{ env.SNAPSHOT_APP_CLIENT_ID != '' }}" in guard
assert "HAS_SNAPSHOT_APP_PRIVATE_KEY: ${{ secrets.XD_SNAPSHOT_APP_PRIVATE_KEY != '' }}" in guard
assert '"$HAS_SNAPSHOT_APP_CLIENT_ID" != "$HAS_SNAPSHOT_APP_PRIVATE_KEY"' in guard
action = release.split(mint, 1)[1].split(stale, 1)[0]
assert "if: github.ref == 'refs/heads/master' && env.SNAPSHOT_APP_CLIENT_ID != ''" in action
assert "id: snapshot_app_token" in action
assert "uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0" in action
assert "client-id: ${{ env.SNAPSHOT_APP_CLIENT_ID }}" in action
assert "private-key: ${{ secrets.XD_SNAPSHOT_APP_PRIVATE_KEY }}" in action
assert "permission-contents: write" in action and "permission-workflows: write" in action
assert "repositories:" not in action and "owner:" not in action, "App token must default to current repository only"
token = "GH_TOKEN: ${{ steps.snapshot_app_token.outputs.token || github.token }}"
assert release.count(token) == 3, "preflight, permission probe and Snapshot publish must share token"
assert release.count("GH_TOKEN: ${{ github.token }}") == 2, "attestation check and stable publish keep original token"
assert release.index(token) < release.index(marker)
assert token in release.split(marker, 1)[1].split("      - name: Log in to GHCR for channel promotion", 1)[0]
assert token in release.split("      - name: Publish rolling snapshot prerelease", 1)[1].split("      - name: Assert distribution assets", 1)[0]
OLD = "a" * 40
NEW = "b" * 40
MOCK_GH = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

path = Path(os.environ["TEST_SNAPSHOT_STATE"])
state = json.loads(path.read_text())
args = sys.argv[1:]
assert args[0] == "api", args
endpoint = next((x for x in args if x.startswith("repos/")), "")
method = args[args.index("--method") + 1] if "--method" in args else "GET"

def event(name):
    state["events"].append(name)
    path.write_text(json.dumps(state))

def field(key):
    return next(v.split("=", 1)[1] for v in args if v.startswith(key + "="))

if method == "GET" and endpoint.endswith("/git/ref/tags/snapshot"):
    event("read")
    print(state["snapshot"])
elif method == "POST" and endpoint.endswith("/git/refs"):
    assert field("ref").startswith("refs/tags/xdrive-snapshot-ref-probe-")
    assert field("sha") == state["snapshot"]
    if os.getenv("TEST_DENY_CREATE"):
        event("create-denied")
        sys.exit(22)
    assert state["scratch"] is None
    state["scratch"] = state["snapshot"]
    event("create")
elif method == "PATCH" and "/git/refs/tags/xdrive-snapshot-ref-probe-" in endpoint:
    assert state["scratch"] is not None
    assert field("sha") == os.environ["GITHUB_SHA"]
    assert "force=true" in args
    if os.getenv("TEST_DENY_UPDATE"):
        event("update-denied")
        print("gh: Resource not accessible by integration (HTTP 403)", file=sys.stderr)
        sys.exit(22)
    state["scratch"] = field("sha")
    event("update")
elif method == "DELETE" and "/git/refs/tags/xdrive-snapshot-ref-probe-" in endpoint:
    assert state["scratch"] is not None
    state["scratch"] = None
    event("delete")
else:
    sys.exit("Unexpected gh call: " + " ".join(args))
'''

def run_case(**switches):
    with tempfile.TemporaryDirectory(prefix="xdrive-snapshot-ref-probe-") as tmp:
        rootdir = Path(tmp)
        binpath = rootdir / "bin"
        binpath.mkdir()
        mock = binpath / "gh"
        mock.write_text(MOCK_GH)
        mock.chmod(0o755)
        statepath = rootdir / "state.json"
        statepath.write_text(json.dumps({
            "snapshot": OLD, "scratch": None, "events": [],
        }))
        env = {
            **os.environ,
            "GITHUB_REPOSITORY": "lazyxu/xdrive",
            "GITHUB_SHA": NEW,
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
            "TEST_SNAPSHOT_STATE": str(statepath),
            "PATH": str(binpath) + os.pathsep + os.environ["PATH"],
        }
        env.update(switches)
        result = subprocess.run(
            ["bash", "-e", "-u", "-o", "pipefail", "-c", script],
            env=env, cwd=rootdir, text=True, capture_output=True,
        )
        return result, json.loads(statepath.read_text())

result, state = run_case()
assert result.returncode == 0, result.stderr
assert state == {
    "snapshot": OLD, "scratch": None,
    "events": ["read", "create", "update", "delete"],
}, state

for failpoint, events in (
    ("TEST_DENY_CREATE", ["read", "create-denied"]),
    ("TEST_DENY_UPDATE", ["read", "create", "update-denied", "delete"]),
):
    result, state = run_case(**{failpoint: "1"})
    assert result.returncode != 0, (failpoint, result.stdout, result.stderr)
    assert state["snapshot"] == OLD, (failpoint, state)
    assert state["scratch"] is None, (failpoint, state)
    assert state["events"] == events, (failpoint, state)
    assert "Snapshot ref permission probe passed" not in result.stdout
    if failpoint == "TEST_DENY_UPDATE":
        assert "no public release assets were modified" in result.stderr
print("Snapshot Git ref preflight mock: success, create denied, update denied/cleanup passed")
