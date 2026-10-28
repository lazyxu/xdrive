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
stale = "      - name: Classify stale master Snapshot eligibility before channel promotion\n"
assert release.count(identity) == 1 and release.count(mint) == 1
assert release.index("      - name: Cryptographically verify signed bundle before releasing") < release.index(identity)
assert release.index(identity) < release.index(mint) < release.index(stale) < release.index(marker)
# GitHub's live JWT endpoint requires a numeric App ID, never an Iv1. Client ID.
# Only the trusted release bundle receives a repository-scoped elevated token.
bundle = release.split("  bundle:\n", 1)[1].split("    steps:\n", 1)[0]
assert "SNAPSHOT_APP_ID: ${{ vars.XD_SNAPSHOT_APP_ID || secrets.XD_SNAPSHOT_APP_ID }}" in bundle
assert bundle.count("SNAPSHOT_APP_ID:") == 1
guard = release.split(identity, 1)[1].split(mint, 1)[0]
assert "HAS_SNAPSHOT_APP_ID: ${{ env.SNAPSHOT_APP_ID != '' }}" in guard
assert "HAS_SNAPSHOT_APP_PRIVATE_KEY: ${{ secrets.XD_SNAPSHOT_APP_PRIVATE_KEY != '' }}" in guard
assert '"$HAS_SNAPSHOT_APP_ID" != "true" || "$HAS_SNAPSHOT_APP_PRIVATE_KEY" != "true"' in guard
action = release.split(mint, 1)[1].split(stale, 1)[0]
assert "if: github.ref == 'refs/heads/master' && env.SNAPSHOT_APP_ID != ''" in action
assert "id: snapshot_app_token" in action
assert "shell: bash" in action
assert "XD_SNAPSHOT_APP_ID: ${{ env.SNAPSHOT_APP_ID }}" in action
assert "XD_SNAPSHOT_APP_PRIVATE_KEY: ${{ secrets.XD_SNAPSHOT_APP_PRIVATE_KEY }}" in action
assert "run: bash scripts/ci/mint-snapshot-publisher-token.sh" in action
assert "uses: actions/create-github-app-token@" not in action
issuer = (root / "scripts/ci/mint-snapshot-publisher-token.sh").read_text(encoding="utf-8")
assert '--argjson iss "$XD_SNAPSHOT_APP_ID"' in issuer
assert 'permissions:{contents:"write",workflows:"write"}' in issuer
assert 'select([.repositories[]?.full_name] == [$repo])' in issuer
token = "GH_TOKEN: ${{ steps.snapshot_app_token.outputs.token || github.token }}"
assert release.count(token) == 4, "preflight, ref probe, publish and post-publish dispatch must share the scoped token"
assert release.count("GH_TOKEN: ${{ github.token }}") == 2, "attestation check and stable publish keep original token"
assert release.index(token) < release.index(marker)
assert token in release.split(marker, 1)[1].split("      - name: Log in to GHCR for channel promotion", 1)[0]
assert token in release.split("      - name: Publish rolling snapshot prerelease", 1)[1].split("      - name: Assert distribution assets", 1)[0]
assert token in release.split("      - name: Notify bounded queued-CI prune after verified Snapshot publication", 1)[1].split("      - name: Publish GitHub Release", 1)[0]

# Only a positively verified superseded master may be classified as a benign
# non-publish. All floating-channel mutation steps are gated by its exact output.
stale_header = release.split(stale, 1)[1].split(marker, 1)[0]
assert "id: snapshot_eligibility" in stale_header
assert 'echo "publish=true" >> "$GITHUB_OUTPUT"' in stale_header
assert 'echo "publish=false" >> "$GITHUB_OUTPUT"' in stale_header
assert release.count("steps.snapshot_eligibility.outputs.publish == 'true'") == 5, "four floating-channel steps plus one publish-only cleanup notifier"
for step, condition in (
    ("Probe snapshot Git ref authorization before release mutation",
     "if: github.ref == 'refs/heads/master' && steps.snapshot_eligibility.outputs.publish == 'true'"),
    ("Log in to GHCR for channel promotion",
     "if: github.ref != 'refs/heads/master' || steps.snapshot_eligibility.outputs.publish == 'true'"),
    ("Promote successful server images",
     "if: github.ref != 'refs/heads/master' || steps.snapshot_eligibility.outputs.publish == 'true'"),
    ("Publish rolling snapshot prerelease",
     "if: github.ref == 'refs/heads/master' && steps.snapshot_eligibility.outputs.publish == 'true'"),
    ("Notify bounded queued-CI prune after verified Snapshot publication",
     "if: github.ref == 'refs/heads/master' && steps.snapshot_eligibility.outputs.publish == 'true'"),
):
    step_start = "      - name: " + step + "\n"
    assert release.count(step_start) == 1, step
    step_header = release.split(step_start, 1)[1].split("\n      - name:", 1)[0]
    assert condition in step_header.split("        run: |", 1)[0], step
assert 'if: startsWith(github.ref, \x27refs/tags/v\x27)' in release, "stable release remains independent"

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
elif method == "GET" and "/compare/" in endpoint:
    event("compare")
    if os.getenv("TEST_COMPARE_ERROR"):
        print("gh: compare unavailable (HTTP 503)", file=sys.stderr)
        sys.exit(22)
    print(os.getenv("TEST_COMPARE_STATUS", "ahead"))
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

# Execute the same shell script GitHub Actions runs. The mock API records
# reads and refuses to silently turn errors or diverged refs into green jobs.
classification_script = textwrap.dedent(
    release.split(stale, 1)[1].split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
)

def run_classification_case(status="ahead", snapshot=OLD, compare_error=False):
    with tempfile.TemporaryDirectory(prefix="xdrive-snapshot-classify-") as tmp:
        rootdir = Path(tmp)
        binpath = rootdir / "bin"
        binpath.mkdir()
        gh = binpath / "gh"
        gh.write_text(MOCK_GH)
        gh.chmod(0o755)
        statepath = rootdir / "state.json"
        statepath.write_text(json.dumps({
            "snapshot": snapshot, "scratch": None, "events": [],
        }))
        outputpath = rootdir / "github-output"
        env = {
            **os.environ,
            "GITHUB_REPOSITORY": "lazyxu/xdrive",
            "GITHUB_SHA": NEW,
            "GITHUB_OUTPUT": str(outputpath),
            "TEST_SNAPSHOT_STATE": str(statepath),
            "TEST_COMPARE_STATUS": status,
            "PATH": str(binpath) + os.pathsep + os.environ["PATH"],
        }
        if compare_error:
            env["TEST_COMPARE_ERROR"] = "1"
        result = subprocess.run(
            ["bash", "-e", "-u", "-o", "pipefail", "-c", classification_script],
            env=env, cwd=rootdir, text=True, capture_output=True,
        )
        output = outputpath.read_text() if outputpath.exists() else ""
        return result, json.loads(statepath.read_text()), output

for relation, expected in (
    ("ahead", "publish=true\n"),
    ("identical", "publish=true\n"),
    ("behind", "publish=false\n"),
):
    result, state, output = run_classification_case(status=relation)
    assert result.returncode == 0, (relation, result.stdout, result.stderr)
    assert output == expected, (relation, output)
    assert state["events"] == ["read", "compare"], (relation, state)
    assert state["scratch"] is None
    if relation == "behind":
        assert "::notice title=Superseded Snapshot" in result.stdout
    else:
        assert "Superseded Snapshot" not in result.stdout

for invalid in ("diverged", "unknown", ""):
    result, state, output = run_classification_case(status=invalid)
    assert result.returncode != 0, (invalid, result.stdout, result.stderr)
    assert output == "" and state["events"] == ["read", "compare"]

result, state, output = run_classification_case(compare_error=True)
assert result.returncode != 0 and output == "" and state["events"] == ["read", "compare"]
result, state, output = run_classification_case(snapshot="not-a-commit")
assert result.returncode != 0 and output == "" and state["events"] == ["read"]

print("Snapshot Git ref preflight and benign-stale mock: current, superseded, bad ancestry/API, permission denial passed")
