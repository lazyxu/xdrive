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
    # GitHub's --clobber updates matching assets; it does NOT remove old names.
    state["assets"].update({
        Path(p).name: "sha256:" + hashlib.sha256(Path(p).read_bytes()).hexdigest()
        for p in paths
    })
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
        assets = [
            {"id": int(hashlib.sha1(n.encode()).hexdigest()[:12], 16), "name": n, "digest": v}
            for n, v in state["assets"].items()
        ]
        if os.getenv("TEST_WRONG_REMOTE_DIGEST") == "1":
            for asset in assets:
                if asset["name"] == "install.sh":
                    asset["digest"] = "sha256:" + "0" * 64
                    break
        event("metadata")
        print(json.dumps({"assets":assets}))
        sys.exit(0)
    if "/releases/assets/" in endpoint:
        if "--method" not in args or args[args.index("--method") + 1] != "DELETE":
            sys.exit("unrecognized asset mutation")
        if os.getenv("TEST_FAIL_DELETE") == "1":
            sys.exit(43)
        asset_id = int(endpoint.rsplit("/", 1)[-1])
        matching = [
            name for name in state["assets"]
            if int(hashlib.sha1(name.encode()).hexdigest()[:12], 16) == asset_id
        ]
        if len(matching) != 1:
            sys.exit("unknown release asset ID")
        deleted_name = matching[0]
        del state["assets"][deleted_name]
        event("delete:" + deleted_name)
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

def run_case(label, existing=True, prior_assets=None, **switches):
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
            "assets": (prior_assets if prior_assets is not None else {
                "xdrive-source-agent-linux-amd64": "sha256:" + "1" * 64,
                "xdrive-source-agent-linux-arm64": "sha256:" + "2" * 64,
                "xdrive-source-agent-linux-armv7": "sha256:" + "3" * 64,
            }) if existing else {},
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
assert sorted(event for event in state["events"] if event.startswith("delete:")) == [
    "delete:xdrive-source-agent-linux-amd64",
    "delete:xdrive-source-agent-linux-arm64",
    "delete:xdrive-source-agent-linux-armv7",
]
assert chr(96) + NEW + chr(96) in state["notes"]
assert state["title"] == "xDrive snapshot " + NEW[:12]

for key in ("TEST_FAIL_UPLOAD","TEST_WRONG_REMOTE_DIGEST","TEST_STALE_SOURCE","TEST_MOVE_REF","TEST_FAIL_DELETE"):
    bad, state = run_case(key, **{key:"1"})
    assert bad.returncode != 0, (key, bad.stdout, bad.stderr)
    assert "patch" not in state["events"], (key, state["events"])
    assert state["exists"], "Existing Release must never be removed"
    if key != "TEST_MOVE_REF":
        assert state["tag"] == OLD, (key, state["tag"])
    if key == "TEST_STALE_SOURCE":
        assert "upload" not in state["events"]
    if key == "TEST_WRONG_REMOTE_DIGEST":
        assert not any(event.startswith("delete:") for event in state["events"])

# Unrelated stale files must NEVER be pruned by the retirement allowlist.
unknown, state = run_case("unknown-asset", prior_assets={
    "unexpected-other.bin": "sha256:" + "4" * 64,
})
assert unknown.returncode != 0, (unknown.stdout, unknown.stderr)
assert "unexpected-other.bin" in state["assets"]
assert not any(event.startswith("delete:") for event in state["events"])
assert state["tag"] == OLD

# The versioned SPK cleanup contract remains intact.
spk, state = run_case("old-spk", prior_assets={
    "xdrivenas-armada38x-0.1.0-8748.spk": "sha256:" + "5" * 64,
    "xdrivenas-armada38x-0.1.0-8748.spk.sha256": "sha256:" + "6" * 64,
})
assert spk.returncode == 0, (spk.stdout, spk.stderr)
assert sorted(event for event in state["events"] if event.startswith("delete:")) == [
    "delete:xdrivenas-armada38x-0.1.0-8748.spk",
    "delete:xdrivenas-armada38x-0.1.0-8748.spk.sha256",
]
assert state["tag"] == NEW

# Missing optional platforms must not leave older Commit packages on a
# floating Snapshot. A same-Commit Bundle, not old Snapshot assets, is the
# authoritative immutable download channel.
old_optional_names = [
    "xdrive-linux-amd64.deb",
    "xDriveSetup-amd64.exe",
    "xDrive-unsigned.ipa",
    "xDrive-unsigned.ipa.sha256",
    "xdrive-backup-linux-amd64.tar.gz",
    "xdrive-backup-windows-amd64.zip",
    "xdrive-android-12-release.apk",
]
stale_optional = {
    name: "sha256:" + format(i + 1, "064x")
    for i, name in enumerate(old_optional_names)
}
optional, state = run_case("stale-optional-platforms", prior_assets=stale_optional)
assert optional.returncode == 0, (optional.stdout, optional.stderr)
assert state["tag"] == NEW
assert set(state["assets"]) == {"install.sh", "SHA256SUMS.txt"}
assert sorted(event for event in state["events"] if event.startswith("delete:")) == [
    "delete:" + name for name in sorted(old_optional_names)
]
assert state["events"].index("metadata") < state["events"].index("patch")

# A bad exact-source upload is not authorization to delete last-good client
# assets. The Git ref and old asset set must stay untouched on digest failure.
corrupt, state = run_case(
    "bad-new-digest-preserves-optional",
    prior_assets=stale_optional,
    TEST_WRONG_REMOTE_DIGEST="1",
)
assert corrupt.returncode != 0, (corrupt.stdout, corrupt.stderr)
assert state["tag"] == OLD
assert set(state["assets"]) == set(stale_optional) | {"install.sh", "SHA256SUMS.txt"}
assert not any(event.startswith("delete:") for event in state["events"])

# Similar-looking unapproved assets are never treated as known signed builds.
unsafe, state = run_case("unknown-android-debug-asset", prior_assets={
    "xdrive-android-debug.apk": "sha256:" + "7" * 64,
})
assert unsafe.returncode != 0
assert "xdrive-android-debug.apk" in state["assets"]
assert state["tag"] == OLD

new_release, state = run_case("first-snapshot", existing=False)
assert new_release.returncode == 0, new_release.stderr
assert state["exists"] and state["tag"] == NEW
assert "create" in state["events"] and "metadata" in state["events"]
assert "patch" not in state["events"], "Initial Snapshot creates its own tag"
print("snapshot publication E2E mock: Source Agent/SPK/old optional client cleanup, unknown asset refusal, digest/partial failure and exact tag guard passed")


# GHCR source regression: execute the *actual* image-push shell without a
# registry, with deterministic concurrent Docker stubs. Failed pushes cannot
# become a green Snapshot; worker must start only after other pushes finish.
push_marker = "      - name: Push exact CI-produced images in parallel\n"
assert workflow.count(push_marker) == 1
push_body = workflow.split(push_marker, 1)[1].split("        run: |\n", 1)[1]
push_body = push_body.split("\n  server-deploy:", 1)[0]
push_script = textwrap.dedent(push_body)
MOCK_DOCKER = r'''#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$TEST_DOCKER_DIR/events.log"
[ "$1" = tag ] && exit 0
[ "$1" = push ] || exit 32
case "$2" in
  *xdrive-media-worker:*) image=xdrive-media-worker; limit=${TEST_FAIL_WORKER:-0} ;;
  *xdrive-server:*) image=xdrive-server; limit=${TEST_FAIL_SERVER:-0} ;;
  *xdrive-caddy:*) image=xdrive-caddy; limit=${TEST_FAIL_OTHER:-0} ;;
  *xdrive-photo-face:*) image=xdrive-photo-face; limit=${TEST_FAIL_OTHER:-0} ;;
  *) exit 33 ;;
esac
printf 'start:%s\n' "$image" >> "$TEST_DOCKER_DIR/events.log"
[ "$image" = xdrive-media-worker ] || /bin/sleep 0.02
file="$TEST_DOCKER_DIR/$image.count"
count=0
if [ -f "$file" ]; then read -r count < "$file"; fi
count=$((count + 1))
printf '%s\n' "$count" > "$file"
if [ "$count" -le "$limit" ]; then
  printf 'error:%s\n' "$image" >> "$TEST_DOCKER_DIR/events.log"
  exit 1
fi
printf 'done:%s\n' "$image" >> "$TEST_DOCKER_DIR/events.log"
'''

def run_ghcr_case(worker_fail=0, server_fail=0):
    with tempfile.TemporaryDirectory(prefix="xdrive-ghcr-push-") as tmp:
        p = Path(tmp)
        bin_dir = p / "bin"
        bin_dir.mkdir()
        docker = bin_dir / "docker"
        docker.write_text(MOCK_DOCKER)
        docker.chmod(0o755)
        sleep = bin_dir / "sleep"
        sleep.write_text("#!/bin/sh\nexit 0\n")
        sleep.chmod(0o755)
        env = {
            **os.environ,
            "GITHUB_SHA": "a" * 40,
            "GITHUB_REF_TYPE": "branch",
            "GITHUB_REF_NAME": "master",
            "GITHUB_REPOSITORY_OWNER": "lazyxu",
            "TEST_DOCKER_DIR": str(p),
            "TEST_FAIL_WORKER": str(worker_fail),
            "TEST_FAIL_SERVER": str(server_fail),
            "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
        }
        run = subprocess.run(
            ["bash", "-e", "-u", "-o", "pipefail", "-c", push_script],
            env=env, capture_output=True, text=True, timeout=30,
        )
        return run, (p / "events.log").read_text().splitlines()

good, events = run_ghcr_case()
assert good.returncode == 0, good.stderr
assert len([event for event in events if event.startswith("tag ")]) == 4
assert len([event for event in events if event.startswith("push ")]) == 4
assert events.index("start:xdrive-media-worker") > max(
    events.index("done:" + image)
    for image in ("xdrive-server", "xdrive-caddy", "xdrive-photo-face")
), events
assert "sha-" + "a" * 12 in "\n".join(events)
for image in ("xdrive-server", "xdrive-caddy", "xdrive-photo-face", "xdrive-media-worker"):
    assert events.count("done:" + image) == 1, events

recover, events = run_ghcr_case(worker_fail=2)
assert recover.returncode == 0, recover.stderr
assert events.count("start:xdrive-media-worker") == 3
assert events.count("done:xdrive-media-worker") == 1
assert all(events.count("start:" + name) == 1 for name in
           ("xdrive-server", "xdrive-caddy", "xdrive-photo-face"))

bad, events = run_ghcr_case(worker_fail=5)
assert bad.returncode != 0
assert events.count("start:xdrive-media-worker") == 5
assert events.count("done:xdrive-media-worker") == 0
assert "failed to push xdrive-media-worker" in bad.stderr

recover, events = run_ghcr_case(server_fail=2)
assert recover.returncode == 0, recover.stderr
assert events.count("start:xdrive-server") == 3
assert events.count("done:xdrive-server") == 1
assert events.index("start:xdrive-media-worker") > events.index("done:xdrive-caddy")

print("GHCR push mock: worker order, 4x bounded retries, exact immutable tags and fail closed passed")
