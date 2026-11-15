#!/usr/bin/env python3
"""Audit the current Web UI benchmark workflow -> native iOS workload ledger.

This is coverage/provenance auditing, never a claim of native performance
success. Individual entries remain not_verified until real owner-bound iOS
metrics, first pixels / frame traces and original raw evidence exist.
"""
import json
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github/workflows"
SEVEN = ROOT / "ios/performance/native-seven-workloads.json"
MEDIA = "p1-image-video-live-pdf-viewer"
FILES = "p0-files-search-sort-group-viewer-return"
GALLERY = "p0-gallery-scroll-map-place-wall"
ROUTES = "p0-gallery-files-all-child-transitions"
SCALE = "p1-100k-files-photos"
TRANSFER = "p1-1gib-4gib-transfers"


def target_family(name):
    if name == "real-web-desktop-cas-4gib-performance.yml" or name.startswith("pwa-s4"):
        return TRANSFER
    if name == "viewer-first-frame-paired-h264.yml":
        return MEDIA
    if name.startswith("file-explorer-"):
        return MEDIA if ("h264" in name or "jpeg" in name) else FILES
    if name.startswith("gallery-"):
        if "h264" in name:
            return MEDIA
        if name.startswith(("gallery-web-", "gallery-mobile-web-",
                            "gallery-physical-", "gallery-selection-")):
            return GALLERY
        return None
    if name in ("places-p0-17-real-chromium.yml", "places-cell-album-paging.yml"):
        return GALLERY
    if (name == "pwa-ios-p0c-browser-baseline.yml"
            or re.match(r"^pwa-p0c[23]", name)
            or name.startswith(("pwa-p1b", "pwa-p1f"))):
        return ROUTES
    if name.startswith("pwa-p1"):
        if any(k in name for k in ("viewer", "h264", "live-motion", "physical-115k")):
            return MEDIA
        return SCALE
    if name.startswith(("pwa-p2a", "pwa-p4")):
        return SCALE
    return None


def audit(catalog, root=ROOT):
    if (catalog.get("schema") != 1 or catalog.get("platform") != "ios-native"
            or catalog.get("scope") != "page-media-interaction-web-performance-workflows"):
        raise ValueError("Invalid Web-to-iOS performance parity catalog schema")
    workflows = root / ".github/workflows"
    expected = {
        ".github/workflows/" + path.name: target_family(path.name)
        for path in workflows.glob("*.yml")
        if target_family(path.name) is not None
    }
    if len(expected) < 50:
        raise ValueError("Missing source Web performance benchmarks")
    entries = catalog.get("entries")
    if not isinstance(entries, list):
        raise ValueError("Missing Web/native entries")
    actual = [x.get("web_workflow") for x in entries]
    if len(set(actual)) != len(actual):
        raise ValueError("Duplicate Web benchmark workflow")
    missing = set(expected).difference(actual)
    extra = set(actual).difference(expected)
    if missing or extra:
        raise ValueError("Missing or obsolete Web workflow mappings: missing=%s extra=%s"
                         % (sorted(missing), sorted(extra)))
    seven = json.loads((root / "ios/performance/native-seven-workloads.json").read_text(
        encoding="utf-8"))
    families = {f["id"]: f for f in seven["families"]}
    if len(families) != 7:
        raise ValueError("Missing seven native performance families")
    verified = 0
    for entry in entries:
        name = entry["web_workflow"]
        family = entry.get("native_family")
        if family != expected[name] or family not in families:
            raise ValueError("Incorrect native workload family: " + name)
        status = entry.get("native_status")
        if status == "not_verified":
            if entry.get("evidence") or entry.get("verified"):
                raise ValueError("Unverified workflow claimed native evidence: " + name)
        elif status == "verified":
            # No Web/Chromium metrics can count as native, and a whole family
            # must first be independently verified by the seven-workload audit.
            if families[family].get("status") != "verified":
                raise ValueError("Native family has not been independently verified: " + family)
            evidence = entry.get("evidence")
            if not isinstance(evidence, dict) or evidence.get("runtime") != "ios-native":
                raise ValueError("Chromium evidence cannot verify native iOS workflow")
            if not evidence.get("owner_verified"):
                raise ValueError("Real authorized Owner provenance is missing")
            sha, fixture = evidence.get("source_sha", ""), evidence.get("fixture_sha256", "")
            if (not re.fullmatch(r"[a-f0-9]{40}", sha)
                    or not re.fullmatch(r"[a-f0-9]{64}", fixture)):
                raise ValueError("Missing exact source and fixture fingerprints")
            if not all(evidence.get(k) for k in ("raw_xcresult_url", "device",
                                               "os_version", "network_conditions")):
                raise ValueError("Missing genuine raw native evidence")
            samples = evidence.get("samples", {})
            if not isinstance(samples, dict) or set(samples) != set(families[family]["required_metrics"]):
                raise ValueError("Missing required native metric samples")
            verified += 1
        else:
            raise ValueError("Unknown native evidence status: " + name)
    return {
        "web_workflows": len(expected),
        "native_verified": verified,
        "native_unverified": len(expected) - verified,
        "families_with_web_benchmarks": len(set(expected.values())),
        "backend_security_native_only_workflows_out_of_scope": True,
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: audit_native_web_workflow_parity.py CATALOG_JSON")
    catalog = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    report = audit(catalog)
    print("IOS_WEB_NATIVE_WORKFLOW_PARITY tracked=%d native_verified=%d "
          "native_unverified=%d family_count=%d" %
          (report["web_workflows"], report["native_verified"],
           report["native_unverified"], report["families_with_web_benchmarks"]))


if __name__ == "__main__":
    main()
