#!/usr/bin/env python3
"""Deterministically plan reusable, content-addressed xDrive offline components.

Conservative on purpose: Media Worker compiles the shared Server Go tree, so
any runtime Go change invalidates the Worker even when FFmpeg is unchanged.
A component is reusable only when its trusted previous fingerprint and
declared compatibility contracts match, not merely when a Docker tag matches.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

COMPONENTS = ("app", "postgres", "media-worker", "ai-runtime", "ai-models")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
IMAGE_ID = re.compile(r"^sha256:[a-f0-9]{64}$")
ROOT = Path(__file__).resolve().parents[2]
CONTRACT_FILE = "scripts/offline/contracts.json"
RUNTIME_FILES = (
    "services/photo-face-analyzer/Dockerfile",
    "services/photo-face-analyzer/requirements.txt",
    "services/photo-face-analyzer/analyzer.py",
    "services/photo-face-analyzer/creative.py",
)
MODEL_FILE = "services/photo-face-analyzer/fetch_models.py"


def digest_inputs(entries: list[tuple[str, bytes]]) -> str:
    h = hashlib.sha256()
    for path, contents in sorted(entries):
        h.update(path.encode("utf-8") + b"\0" + str(len(contents)).encode("ascii") + b"\0")
        h.update(contents)
    return h.hexdigest()


def files_at(root: Path) -> list[str]:
    paths = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"]).split(b"\0")
    return sorted(p.decode("utf-8") for p in paths if p)


def load_contracts(root: Path) -> dict[str, int]:
    v = json.loads((root / CONTRACT_FILE).read_text("utf-8"))
    expected = {"postgres_major", "media_worker_api", "photo_intelligence_api", "model_runtime_api"}
    if not isinstance(v, dict) or set(v) != expected or any(type(x) is not int or x < 1 for x in v.values()):
        raise ValueError("invalid offline compatibility contract")
    return v


def analyze(root: Path, postgres_id: str, previous: dict | None) -> dict:
    if not IMAGE_ID.fullmatch(postgres_id):
        raise ValueError("PostgreSQL image ID must be an exact sha256 Docker ID")
    paths = files_at(root)
    contracts = load_contracts(root)
    checks = {
        "app": lambda p: (
            not (p.endswith(("_test.go", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"))
                 or "/tests/" in p)
            and (p in ("Dockerfile", "go.mod", "go.sum", "deploy/install-server.sh",
                       CONTRACT_FILE, "scripts/ci/build-metadata.sh",
                       "scripts/ci/client-artifact-version.sh",
                       "scripts/ci/gitlab-caddy-image.sh")
                 or p.startswith(("cmd/", "internal/", "web/", "ui/", "deploy/"))
                 or p.startswith(("scripts/server-", "scripts/caddy-", "scripts/xdrive-server-host")))
        ),
        "media-worker": lambda p: (
            p in ("Dockerfile", "go.mod", "go.sum", "deploy/MediaWorker.Dockerfile", CONTRACT_FILE)
            or p.startswith(("cmd/", "internal/"))
            or p == "scripts/ci/test-media-worker-image.sh"
        ) and not p.endswith("_test.go"),
        "ai-runtime": lambda p: p in (*RUNTIME_FILES, CONTRACT_FILE),
    }
    fingerprints = {}
    for component, pred in checks.items():
        data = [(p, (root / p).read_bytes()) for p in paths if pred(p) and (root / p).is_file()]
        if not data:
            raise ValueError(f"no fingerprint inputs: {component}")
        fingerprints[component] = digest_inputs(data)

    # The models' identity depends on their declared, pinned bytes, not the
    # downloader's retry logic or an unrelated code-only change.
    source = (root / MODEL_FILE).read_text("utf-8")
    weights = re.findall(r'"sha256":\s*"([a-f0-9]{64})"', source)
    if len(weights) < 10:
        raise ValueError("expected pinned model/license SHA-256 values not found")
    fingerprints["ai-models"] = digest_inputs([
        ("pinned_model_and_license_sha256", "\n".join(weights).encode("ascii")),
        ("model_runtime_contract", str(contracts["model_runtime_api"]).encode("ascii")),
    ])
    fingerprints["postgres"] = digest_inputs([
        ("postgres_image_id", postgres_id.encode("ascii")),
        ("postgres_major", str(contracts["postgres_major"]).encode("ascii")),
    ])
    old_fingerprints = previous.get("fingerprints", {}) if isinstance(previous, dict) and previous.get("schema") == 2 else {}
    if not isinstance(old_fingerprints, dict):
        old_fingerprints = {}
    changed = [c for c in COMPONENTS if old_fingerprints.get(c) != fingerprints[c]]
    return {
        "schema": 1,
        "fingerprints": fingerprints,
        "changed": changed,
        "reused": [c for c in COMPONENTS if c not in changed],
        "contracts": contracts,
        "postgres_image_id": postgres_id,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", type=Path, default=ROOT)
    p.add_argument("--postgres-id", required=True)
    p.add_argument("--previous", type=Path)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    previous = None
    if args.previous and args.previous.exists():
        previous = json.loads(args.previous.read_text("utf-8"))
        if not isinstance(previous, dict):
            raise ValueError("previous manifest must be a JSON object")
    result = analyze(args.repo, args.postgres_id, previous)
    args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", "utf-8")
    print(f"[offline] changed: {','.join(result['changed']) or 'none'}")
    print(f"[offline] reused: {','.join(result['reused']) or 'none'}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"xDrive offline planning failed: {exc}", file=sys.stderr)
        sys.exit(1)
