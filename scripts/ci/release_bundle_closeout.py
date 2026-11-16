#!/usr/bin/env python3
"""Read-only R03–R13 Release Bundle closeout ledger.

The ledger checks reproducible receipts and exact-source identity. It NEVER
installs, upgrades, signs, deploys, or declares a physical check passed on
the strength of source tests alone. Real external witnesses are mandatory.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_JSON = 256 * 1024
MAX_ATTACHMENT = 32 * 1024 * 1024

# Each row is independently owned, but ALL code and evidence live in one PR.
# An artifact is *evidence*, not a substitute for actually running the test.
ROWS = {
    "R03": ("P0", "host", (), ()),
    "R04": ("P0", "windows-device", (
        "personal_unsigned_consent", "installer_sha256_verified",
        "agent_exited_before_install", "electron_restarted", "agent_restarted",
        "deliberate_failed_postinstall_check", "rollback_to_last_known_good",
    ), ("xd", "agent", "desktop")),
    "R05": ("P0", "linux-device", (
        "deb_sha256_verified", "policykit_authorized_install",
        "policykit_denial_rejected", "desktop_restarted",
        "interrupted_install_recovered", "failed_upgrade_rolled_back",
    ), ("xd", "agent", "desktop")),
    "R06": ("P0", "host-staging", (
        "missing_client_package", "gitlab_404", "corrupt_client_sha256",
        "client_network_offline", "cache_worker_failure",
        "server_health_only_controls_commit", "failed_server_health_rolls_back",
        "verified_partial_client_cache_remains_usable",
    ), ("server",)),
    "R07": ("P1", "gitlab-runner", (
        "gitlab_fast_forward_without_force", "gitlab_exact_commit_pipeline",
        "release_api_500_idempotent_recovery", "release_metadata_readback",
        "package_bytes_sha256_readback", "gitlab_404_github_digest_fallback",
        "server_gitlab_exact_commit_and_sha_agree",
    ), ("gitlab",)),
    "R08": ("P1", "nas-device", (
        "package_center_upgrade", "spk_sha256_verified",
        "settings_retained", "backup_state_retained",
        "agent_running", "owner_authenticated",
    ), ("agent",)),
    "R09": ("P1", "host", (
        "host_strict_sigstore_required", "trusted_gh_installed",
        "pinned_signer_repo_source_verified", "wrong_signer_rejected",
        "wrong_commit_rejected", "missing_gh_rejects_cache_only",
        "invalid_signature_rejects_cache_only",
        "server_health_independent",
    ), ("server",)),
    "R10": ("P1", "network-staging", (
        "http_404", "http_500", "cancel", "range_resume",
        "download_sha256", "dependency_busy_pauses_bytes",
        "dependency_ready_resumes_without_rate_limit",
        "lock_marker_cleanup", "server_health_independent",
    ), ("server",)),
    "R11": ("P1", "compat-device-matrix", (
        "old_desktop_connected", "old_dsm_connected",
        "old_ios_connected", "old_android_connected",
        "owner_isolation_preserved", "no_forced_client_upgrade",
        "server_health_independent",
    ), ("server",)),
    "R12": ("P2", "signing-device", (
        "apple_developer_signed_ipa", "signed_ipa_installed",
        "android_fixed_release_key", "android_release_apk_installed",
        "no_unsigned_ipa_auto_install", "no_debug_apk_in_bundle",
    ), ("ios", "android")),
    "R13": ("P2", "cli-runtime", (
        "windows_portable_cli_executed", "linux_portable_cli_executed",
        "both_archives_sha256_verified", "no_desktop_in_archive",
        "cli_only_atomic_install_verified", "cli_only_failed_install_rolled_back",
    ), ("windows_xd", "windows_agent", "linux_xd", "linux_agent")),
}


class EvidenceError(ValueError):
    pass


def load_json(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise EvidenceError("missing, symlinked or oversized JSON evidence")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError) as exc:
        raise EvidenceError("invalid JSON evidence") from exc
    if not isinstance(data, dict):
        raise EvidenceError("evidence must be a JSON object")
    return data


def utc_timestamp(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
        return parsed.tzinfo is not None
    except ValueError:
        return False


def actual_attachment(root: Path, relative: str, digest: str) -> None:
    if not isinstance(relative, str) or not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise EvidenceError("missing or malformed attachment digest")
    path = Path(relative)
    if path.is_absolute() or not path.parts or ".." in path.parts or "." in path.parts:
        raise EvidenceError("attachment escapes evidence directory")
    if any(part in ("",) for part in path.parts):
        raise EvidenceError("invalid attachment path")
    cursor = root
    for part in path.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise EvidenceError("symlinked evidence attachment is forbidden")
    if not cursor.is_file() or cursor.stat().st_size > MAX_ATTACHMENT:
        raise EvidenceError("missing or oversized evidence attachment")
    hash_ = hashlib.sha256()
    with cursor.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            hash_.update(block)
    if hash_.hexdigest() != digest:
        raise EvidenceError("evidence attachment SHA-256 mismatch")


def check_live_report(path: Path, commit: str) -> None:
    """R03 can only be established by the existing *real* Host/Owner probe.

    Independent published-source Sigstore verification is NOT sufficient for
    R09: installed Host strict-mode rejection evidence is still required.
    """
    data = load_json(path)
    if data.get("commit") != commit or data.get("release") != "verified":
        raise EvidenceError("live probe source Commit/publication mismatch")
    if (data.get("host") != "verified" or data.get("server_download") != "verified"
            or data.get("guest_denial") != "verified"
            or not isinstance(data.get("host_packages"), int)
            or isinstance(data.get("host_packages"), bool)
            or data["host_packages"] < 1
            or not isinstance(data.get("range_verified_packages"), int)
            or isinstance(data.get("range_verified_packages"), bool)
            or data["range_verified_packages"] < 1
            or not isinstance(data.get("api_packages"), int)
            or isinstance(data.get("api_packages"), bool)
            or data["api_packages"] < 1):
        raise EvidenceError("real Host bytes, authenticated Range, API or guest denial missing")


def check_receipt(path: Path, root: Path, row: str, commit: str) -> None:
    priority, environment, required, commit_fields = ROWS[row]
    del priority
    data = load_json(path)
    if (data.get("schema_version") != 1 or data.get("row") != row or
            data.get("commit") != commit or data.get("environment") != environment or
            data.get("result") != "passed"):
        raise EvidenceError("receipt identity, environment or result mismatch")
    if not utc_timestamp(data.get("executed_at")):
        raise EvidenceError("receipt missing UTC execution timestamp")
    if not isinstance(data.get("operator"), str) or not data["operator"].strip():
        raise EvidenceError("receipt lacks a real witness operator")
    checks = data.get("checks")
    if not isinstance(checks, dict):
        raise EvidenceError("receipt has no checks")
    for key in required:
        if checks.get(key) is not True:
            raise EvidenceError("missing actual scenario result: " + key)
    ids = data.get("observed_commits")
    if not isinstance(ids, dict):
        raise EvidenceError("receipt has no installed/source Commit observations")
    for component in commit_fields:
        if ids.get(component) != commit:
            raise EvidenceError("wrong/missing observed Commit: " + component)
    artifacts = data.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts or len(artifacts) > 32:
        raise EvidenceError("receipt must have trace evidence attachments")
    seen = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str):
            raise EvidenceError("invalid evidence attachment")
        if artifact["path"] in seen:
            raise EvidenceError("duplicate evidence attachment")
        seen.add(artifact["path"])
        actual_attachment(root, artifact["path"], artifact.get("sha256"))


def build_matrix(commit: str, evidence_dir: Path, live_report: Path | None = None) -> dict:
    if not SHA40.fullmatch(commit):
        raise EvidenceError("full lowercase 40-character Commit required")
    if evidence_dir.is_symlink() or (evidence_dir.exists() and not evidence_dir.is_dir()):
        raise EvidenceError("evidence root must be a real directory")
    checks = {}
    for row, (priority, environment, _, _) in ROWS.items():
        receipt = evidence_dir / (row + ".json")
        item = {"priority": priority, "environment": environment,
                "status": "unverified"}
        try:
            if row == "R03":
                if live_report is not None:
                    check_live_report(live_report, commit)
                    item["status"] = "verified"
            elif receipt.exists() or receipt.is_symlink():
                check_receipt(receipt, evidence_dir, row, commit)
                if row == "R09":
                    # Strict installed-Host checks need independent public
                    # signer verification from the same R03 live gate as well.
                    if live_report is None or load_json(live_report).get("sigstore") != "verified":
                        raise EvidenceError("R09 requires an exact-Commit live Sigstore proof")
                    check_live_report(live_report, commit)
                item["status"] = "verified"
        except (EvidenceError, OSError) as exc:
            item["status"] = "rejected"
            # Never print raw report/attachment data or Owner tokens.
            item["reason"] = str(exc)
        checks[row] = item
    counts = {status: sum(x["status"] == status for x in checks.values())
              for status in ("verified", "unverified", "rejected")}
    return {"schema_version": 1, "commit": commit, "checks": checks,
            "summary": counts, "complete": counts["verified"] == len(ROWS)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--live-report", type=Path,
                        help="saved JSON stdout from verify-live-release-bundle.py on a REAL Host")
    parser.add_argument("--output", type=Path, help="write sanitized matrix JSON")
    parser.add_argument("--strict", action="store_true",
                        help="reject ALL incomplete or invalid rows (device gates included)")
    args = parser.parse_args(argv)
    try:
        result = build_matrix(args.commit, args.evidence_dir, args.live_report)
        output = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.output:
            if args.output.is_symlink():
                raise EvidenceError("refusing symlinked output")
            args.output.write_text(output, encoding="utf-8")
        print(output, end="")
        if result["summary"]["rejected"] or (args.strict and not result["complete"]):
            return 1
        return 0
    except (EvidenceError, OSError) as exc:
        print("Release Bundle closeout rejected: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
