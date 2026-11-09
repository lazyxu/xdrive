"""Execute the actual immutable Bundle publisher with a local GH Release mock.

Never modifies GitHub. Tests first publish, idempotent retries, SHA/tag/asset
mismatch, orphan tags, and manifest-only (Server-only) releases.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[2]
PUBLISHER = ROOT / "scripts/ci/publish-release-bundle.sh"
COMMIT = "a" * 40
OTHER = "b" * 40

MOCK_GH = r'''#!/usr/bin/env python3
import hashlib, json, os, sys
from pathlib import Path

path = Path(os.environ["XD_TEST_PUBLISH_STATE"])
state = json.loads(path.read_text())
args = sys.argv[1:]
tag = "bundle-" + os.environ["XD_TEST_COMMIT"]
def save():
    path.write_text(json.dumps(state))

if args[:2] == ["release", "view"]:
    sys.exit(0 if state["release"] else 1)
if args[:2] == ["release", "create"]:
    if state["release"] or state["tag"]:
        sys.exit(30)
    if len(args) < 6 or args[2] != tag or "--target" not in args:
        sys.exit(31)
    target = args[args.index("--target") + 1]
    if target != os.environ["XD_TEST_COMMIT"]:
        sys.exit(32)
    state["tag"] = True
    state["release"] = True
    state["ref"] = target
    state["assets"] = []
    for entry in args[3:]:
        file = Path(entry)
        if file.is_file():
            body = file.read_bytes()
            state["assets"].append({
                "name": file.name,
                "digest": "sha256:" + hashlib.sha256(body).hexdigest(),
                "size": len(body),
            })
    state["create_count"] += 1
    save()
    sys.exit(0)
if args[:1] == ["api"]:
    endpoint = next((arg for arg in args[1:] if arg.startswith("repos/")), "")
    if endpoint == "repos/lazyxu/xdrive/git/ref/tags/" + tag:
        if not state["tag"]:
            if state.get("tag_probe_error"):
                print("gh: request timed out (network unavailable)", file=sys.stderr)
            else:
                print("gh: Not Found (HTTP 404)", file=sys.stderr)
            sys.exit(22)
        if "--jq" in args:
            print(state["ref"])
        else:
            print(json.dumps({"ref":"refs/tags/" + tag,
              "object":{"sha": state["ref"], "type": "commit"}}))
        sys.exit(0)
    if endpoint == "repos/lazyxu/xdrive/releases/tags/" + tag:
        if not state["release"]:
            sys.exit(22)
        print(json.dumps({"tag_name":tag, "draft":False, "prerelease":True,
                          "assets":state["assets"]}))
        sys.exit(0)
sys.exit("unexpected release mutation/query: " + " ".join(args))
'''


class PublishCurrentCommitBundleTests(unittest.TestCase):
    def run_case(self, mode, with_package=True, wrong_manifest=False,
                 bad_source=False, corrupt_file=False, malformed_filename=False):
        with tempfile.TemporaryDirectory(prefix="xdrive-bundle-publish-") as tmp:
            root = Path(tmp)
            (root / "bin").mkdir()
            (root / "release").mkdir()
            mock = root / "bin" / "gh"
            mock.write_text(MOCK_GH)
            mock.chmod(0o755)
            packages = []
            if with_package:
                data = b"exact-commit-package" * 37
                (root / "release" / "installer.pkg").write_bytes(
                    b"X" * len(data) if corrupt_file else data
                )
                filename = "../installer.pkg" if malformed_filename else "installer.pkg"
                packages.append({"filename":filename, "platform":"linux",
                    "build_commit":COMMIT,"sha256":hashlib.sha256(data).hexdigest(),
                    "size":len(data),"install_mode":"manual",
                    "sources":{
                        "gitlab":("http://gitlab.t-fluid.com:1080/api/v4/projects/"
                                  "xuliang%2Fxdrive/packages/generic/"
                                  "xdrive-build-packages/sha-" + COMMIT + "/installer.pkg"),
                        "github":("https://github.com/lazyxu/xdrive/releases/"
                                  "download/bundle-" + COMMIT + "/installer.pkg"
                                  if not bad_source else "https://evil.example/installer.pkg")
                    }})
            manifest = {"schema_version":1, "commit":OTHER if wrong_manifest else COMMIT,
                        "channel":"master", "artifacts":packages}
            body = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode() + b"\n"
            (root / "release" / "release-bundle.json").write_bytes(body)
            assets = []
            for name in ["release-bundle.json"] + (["installer.pkg"] if with_package else []):
                data = (root / "release" / name).read_bytes()
                assets.append({"name":name, "size":len(data),
                               "digest":"sha256:" + hashlib.sha256(data).hexdigest()})
            if mode == "tampered":
                assets[-1]["digest"] = "sha256:" + "0" * 64
            if mode == "missing-asset":
                assets.pop()
            state = {
                "tag": mode not in ("new", "tag-probe-failure"),
                "release": mode not in ("new", "orphan", "tag-probe-failure"),
                "ref": OTHER if mode == "wrong-ref" else COMMIT,
                "tag_probe_error": mode == "tag-probe-failure",
                "assets": assets,
                "create_count": 0,
            }
            statefile = root / "state.json"
            statefile.write_text(json.dumps(state))
            env = {**os.environ, "GH_TOKEN":"mock-read-write-token",
                   "GITHUB_REPOSITORY":"lazyxu/xdrive",
                   "XD_TEST_COMMIT":COMMIT,
                   "XD_TEST_PUBLISH_STATE":str(statefile),
                   "PATH":str(root / "bin") + os.pathsep + os.environ["PATH"]}
            result = subprocess.run(
                ["bash", str(PUBLISHER), COMMIT, "release"],
                cwd=root, env=env, capture_output=True, text=True, timeout=12,
            )
            return result, json.loads(statefile.read_text())

    def test_first_publish_exact_tag_and_remote_digests(self):
        result, state = self.run_case("new")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["create_count"], 1)
        self.assertEqual(state["ref"], COMMIT)
        self.assertEqual({x["name"] for x in state["assets"]},
                         {"release-bundle.json", "installer.pkg"})

    def test_manifest_only_bundle_without_clients_is_valid(self):
        result, state = self.run_case("new", with_package=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({x["name"] for x in state["assets"]}, {"release-bundle.json"})

    def test_published_bytes_are_immutable_and_retries_idempotent(self):
        result, state = self.run_case("existing")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["create_count"], 0)
        for mode in ("tampered", "missing-asset", "wrong-ref", "orphan", "tag-probe-failure"):
            bad, state = self.run_case(mode)
            self.assertNotEqual(bad.returncode, 0, (mode, bad.stdout, bad.stderr))
            self.assertEqual(state["create_count"], 0, mode)

    def test_manifest_commit_mismatch_never_creates_release(self):
        result, state = self.run_case("new", wrong_manifest=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(state["release"])
        self.assertEqual(state["create_count"], 0)

    def test_malformed_manifest_never_masquerades_as_server_only(self):
        for detail in ("bad_source", "corrupt_file", "malformed_filename"):
            result, state = self.run_case("new", **{detail: True})
            self.assertNotEqual(result.returncode, 0, (detail, result.stdout, result.stderr))
            self.assertEqual(state["create_count"], 0, detail)
            self.assertFalse(state["release"], detail)


if __name__ == "__main__":
    unittest.main()
