#!/usr/bin/env python3
"""Exercise the real YAML rolling-Snapshot shell against a fake gh Release API."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap

root = Path(__file__).resolve().parents[1]
workflow = (root / ".github/workflows/release.yml").read_text()
section = workflow.split("      - name: Publish rolling snapshot prerelease\n", 1)[1]
body = section.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
script = textwrap.dedent(body)
OLD = "a" * 40
NEW = "b" * 40

MOCK_GH = r'''#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import sys

state_path = Path(os.environ["TEST_RELEASE_STATE"])
state = json.loads(state_path.read_text())
args = sys.argv[1:]

def event(name):
    state["events"].append(name)
    state_path.write_text(json.dumps(state))

def save():
    state_path.write_text(json.dumps(state))

def put_assets(paths):
    state["assets"] = {
        Path(p).name: "sha256:" + hashlib.sha256(Path(p).read_bytes()).hexdigest()
        for p in paths
    }
    save()

if args[:2] == ["release", "view"]:
    sys.exit(0 if state["exists"] else 1)

if args[:2] in (["release", "upload"], ["release", "create"]):
    files = [item for item in args if item.startswith("release/")]
    if not files:
        sys.exit("no mock release asset files")
    if args[1] == "create":
        state["exists"] = True
        state["tag"] = os.environ["GITHUB_SHA"]
        event("create")
        put_assets(files)
        sys.exit(0)
    event("upload")
    if os.getenv("TEST_FAIL_UPLOAD") == "1":
        # A partial, interrupted per-file replacement must leave tag unchanged.
        state["assets"][Path(files[0]).name] = (
            "sha256:" + hashlib.sha256(Path(files[0]).read_bytes()).hexdigest()
        )
        save()
        sys.exit(22)
    put_assets(files)
    sys.exit(0)

if args[:2] == ["release", "edit"]:
    assert state["exists"]
    assert "--notes" in args and "--title" in args
    state["notes"] = args[args.index("--notes") + 1]
    state["title"] = args[args.index("--title") + 1]
    event("edit")
    sys.exit(0)

if args[:1] == ["api"]:
    endpoint = next((x for x in args if x.startswith("repos/")), "")
    if "/git/ref/tags/snapshot" in endpoint:
        state["ref_reads"] += 1
        if os.getenv("TEST_MOVE_REF") == "1" and state["ref_reads"] > 1:
            state["tag"] = "f" * 40
        save()
        if "--jq" in args:
            print(state["tag"])
        else:
            print(json.dumps({"ref":"refs/tags/snapshot","object":{"sha":state["tag"]}}))
        sys.exit(0)
    if "/compare/" in endpoint:
        print("diverged" if os.getenv("TEST_STALE_SOURCE") == "1" else "ahead")
        sys.exit(0)
    if "/releases/tags/snapshot" in endpoint:
        assert state["exists"]
        assets = [{"name":n,"digest":v} for n,v in state["assets"].items()]
        if os.getenv("TEST_WRONG_REMOTE_DIGEST") == "1" and assets:
            assets[0]["digest"] = "sha256:" + "0" * 64
        event("metadata")
        print(json.dumps({"assets":assets}))
        sys.exit(0)
    if "/git/refs/tags/snapshot" in endpoint and "--method" in args:
        assert args[args.index("--method") + 1] == "PATCH"
        state["tag"] = next(a.split("=",1)[1] for a in args if a.startswith("sha="))
        event("patch")
        sys.exit(0)
    if "/releases?per_page=" in endpoint or "/git/matching-refs/tags/snapshot-" in endpoint:
        # Existing workflow legacy-cleanup inventory is intentionally empty.
        sys.exit(0)
sys.exit("unexpected gh call: " + " ".join(args))
'''

def run_case(label, existing=True, **switches):
    with tempfile.TemporaryDirectory(prefix="xdrive-snapshot-publish-") as tmp:
        p = Path(tmp)
        (p / "release").mkdir()
        (p / "release" / "install.sh").write_bytes(b"installer from new commit\n")
        (p / "release" / "SHA256SUMS.txt").write_bytes(b"manifest from new commit\n")
        bin_dir = p / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text(MOCK_GH)
        gh.chmod(0o755)
        no_delay = bin_dir / "sleep"
        no_delay.write_text("#!/bin/sh\nexit 0\n")
        no_delay.chmod(0o755)
        statefile = p / "state.json"
        statefile.write_text(json.dumps({
            "exists":existing,"tag":OLD if existing else "",
            "assets":{"old.txt":"sha256:" + "1" * 64} if existing else {},
            "events":[],"ref_reads":0,"notes":"","title":"",
        }))
        env = {
            **os.environ,
            "GITHUB_SHA":NEW,"GITHUB_REPOSITORY":"lazyxu/xdrive",
            "TEST_RELEASE_STATE":str(statefile),
            "PATH":str(bin_dir) + os.pathsep + os.environ["PATH"],
        }
        env.update(switches)
        completed = subprocess.run(
            ["bash","-e","-u","-o","pipefail","-c",script],
            env=env, cwd=p, capture_output=True, text=True,
        )
        return completed, json.loads(statefile.read_text())

ok, state = run_case("existing-success")
assert ok.returncode == 0, ok.stderr
assert state["exists"] and state["tag"] == NEW
assert set(state["assets"]) == {"install.sh","SHA256SUMS.txt"}
assert state["events"].index("upload") < state["events"].index("metadata") < state["events"].index("patch")
assert "release" not in state["events"]
assert chr(96) + NEW + chr(96) in state["notes"]
assert state["title"] == "xDrive snapshot " + NEW[:12]

for key in ("TEST_FAIL_UPLOAD","TEST_WRONG_REMOTE_DIGEST","TEST_STALE_SOURCE","TEST_MOVE_REF"):
    bad, state = run_case(key, **{key:"1"})
    assert bad.returncode != 0, (key, bad.stdout, bad.stderr)
    assert "patch" not in state["events"], (key, state["events"])
    assert state["exists"], "Existing Release must never be removed"
    if key != "TEST_MOVE_REF":
        assert state["tag"] == OLD, (key, state["tag"])
    if key == "TEST_STALE_SOURCE":
        assert "upload" not in state["events"]

new_release, state = run_case("first-snapshot", existing=False)
assert new_release.returncode == 0, new_release.stderr
assert state["exists"] and state["tag"] == NEW
assert "create" in state["events"] and "metadata" in state["events"]
assert "patch" not in state["events"], "Initial Snapshot creates its own tag"
print("snapshot publication E2E mock: existing/new, upload failure, digest mismatch, stale source and moved tag passed")
