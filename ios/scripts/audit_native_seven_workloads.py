#!/usr/bin/env python3
"""Verify all requested native iOS performance categories and honest evidence.

A development catalog can have outstanding work. Only truly measured families
may be labeled verified; Chromium, synthetic Owner and aggregate app-mount
metrics can never satisfy a feature-specific native workload contract.
"""
import json
import math
from pathlib import Path
import sys

REQUIRED = {
 "p0-gallery-files-all-child-transitions": "P0",
 "p0-files-search-sort-group-viewer-return": "P0",
 "p0-gallery-scroll-map-place-wall": "P0",
 "p1-notes-clipboard-transfers-settings-children": "P1",
 "p1-100k-files-photos": "P1",
 "p1-image-video-live-pdf-viewer": "P1",
 "p1-1gib-4gib-transfers": "P1",
}
UNVERIFIED = {"instrumented_unverified", "not_measured", "dependency_pending"}
BOOLEAN_METRICS = {"sha256_verified", "resumed_verified"}

def audit(obj):
    if obj.get("schema") != 1 or obj.get("platform") != "ios-native":
        raise ValueError("Unsupported native iOS performance catalog")
    families = obj.get("families")
    if not isinstance(families, list) or len(families) != len(REQUIRED):
        raise ValueError("Missing required seven native performance families")
    ids = [x.get("id") for x in families]
    if len(set(ids)) != len(ids) or set(ids) != set(REQUIRED):
        raise ValueError("Missing or duplicate native family")
    verified = 0
    for family in families:
        fid = family["id"]
        if family.get("priority") != REQUIRED[fid]:
            raise ValueError("Incorrect P0/P1 classification: " + fid)
        metric_names = family.get("required_metrics")
        if (not isinstance(metric_names, list) or len(metric_names) < 4
                or len(set(metric_names)) != len(metric_names)):
            raise ValueError("Missing native metric requirements: " + fid)
        status = family.get("status")
        if status in UNVERIFIED:
            if family.get("evidence") or family.get("verified"):
                raise ValueError("Unverified family claims measurement: " + fid)
            if not isinstance(family.get("outstanding"), list) or not family["outstanding"]:
                raise ValueError("Unmeasured native family has no blockers: " + fid)
            continue
        if status != "verified":
            raise ValueError("Unrecognized native workload status: " + fid)
        evidence = family.get("evidence")
        if not isinstance(evidence, dict):
            raise ValueError("Missing real native evidence for: " + fid)
        if evidence.get("runtime") != "ios-native" or evidence.get("synthetic_owner"):
            raise ValueError("Chromium or synthetic Owner cannot verify: " + fid)
        sha = evidence.get("source_sha", "")
        fixture = evidence.get("fixture_sha256", "")
        if not (isinstance(sha, str) and len(sha) == 40
                and all(c in "0123456789abcdef" for c in sha)):
            raise ValueError("Missing exact native source SHA: " + fid)
        if not (isinstance(fixture, str) and len(fixture) == 64
                and all(c in "0123456789abcdef" for c in fixture)):
            raise ValueError("Missing real fixture fingerprint: " + fid)
        if not all(evidence.get(key) for key in ("raw_xcresult_url", "device",
                                                "os_version", "network_conditions")):
            raise ValueError("Missing original device/raw native evidence: " + fid)
        samples = evidence.get("samples")
        if not isinstance(samples, dict) or set(samples) != set(metric_names):
            raise ValueError("Missing metrics for complete native family: " + fid)
        for name, series in samples.items():
            if not isinstance(series, list) or len(series) < 3:
                raise ValueError("Native metrics require >=3 samples: " + name)
            if name in BOOLEAN_METRICS:
                if any(x is not True for x in series):
                    raise ValueError("Unverified byte/resume integrity: " + name)
            elif any(isinstance(x, bool) or not isinstance(x, (int, float))
                     or not math.isfinite(x) or x < 0 for x in series):
                raise ValueError("Invalid numeric native sample: " + name)
        verified += 1
    return {"families": len(families), "verified": verified,
            "not_verified": len(families)-verified}

def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: audit_native_seven_workloads.py CATALOG_JSON")
    report = audit(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    print("IOS_NATIVE_SEVEN_WORKLOADS families=%s verified=%s not_verified=%s" %
          (report["families"], report["verified"], report["not_verified"]))

if __name__ == "__main__":
    main()
