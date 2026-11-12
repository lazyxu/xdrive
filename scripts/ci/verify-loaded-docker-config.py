#!/usr/bin/env python3
"""Cryptographically verify docker save of the just-loaded tag, in one stream.

Docker 29 may report an OCI index in inspect .Id instead of its config digest.
The saved image config digest binds rootfs diff IDs and image metadata.
"""
import hashlib
import json
import re
import sys
import tarfile

CONFIG_NAME = re.compile(r"(?:blobs/sha256/)?[0-9a-f]{64}(?:\.json)?\Z")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")


def fail(message):
    raise SystemExit("Docker loaded config verification failed: " + message)


def verify():
    if len(sys.argv) != 3 or not IMAGE_ID.fullmatch(sys.argv[2]):
        fail("expected image reference and SHA-256 config ID")
    image, exported = sys.argv[1:]
    expected = exported[7:]
    manifest = None
    configs = {}
    try:
        with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as stream:
            for member in stream:
                if member.name == "manifest.json":
                    if manifest is not None or not member.isfile() or not 0 < member.size <= 2 * 1024 * 1024:
                        fail("invalid or duplicate manifest")
                    manifest = json.load(stream.extractfile(member))
                elif CONFIG_NAME.fullmatch(member.name):
                    if member.name in configs or not member.isfile() or not 0 < member.size <= 4 * 1024 * 1024:
                        fail("invalid or duplicate image config")
                    configs[member.name] = hashlib.sha256(stream.extractfile(member).read()).hexdigest()
    except (OSError, ValueError, KeyError, tarfile.TarError) as exc:
        fail(str(exc))
    if not isinstance(manifest, list) or len(manifest) != 1 or not isinstance(manifest[0], dict):
        fail("expected exactly one Docker image")
    record = manifest[0]
    tags = record.get("RepoTags")
    if not isinstance(tags, list) or image not in tags and "docker.io/" + image not in tags:
        fail("wrong Docker image tag")
    config = record.get("Config")
    if not isinstance(config, str) or not CONFIG_NAME.fullmatch(config):
        fail("unsafe config path")
    named = config.rsplit("/", 1)[-1].removesuffix(".json")
    if named != expected or configs.get(config) != expected:
        fail("loaded config SHA-256 disagrees with exporter")
    print("Verified re-saved Docker image config SHA-256 " + exported)


if __name__ == "__main__":
    verify()
