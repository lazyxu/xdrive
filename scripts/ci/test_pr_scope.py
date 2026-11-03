#!/usr/bin/env python3
"""Test the allowlist and its fail-closed edges without third-party libraries."""
import unittest

from classify_pr_scope import classify_paths


class PRScopeTest(unittest.TestCase):
    def test_docs(self):
        self.assertEqual("docs", classify_paths([
            "AGENTS.md", "docs/history/AGENTS-2026-10-27-before-consolidation.md",
        ]))

    def test_android(self):
        self.assertEqual("android", classify_paths([
            "android/app/src/main/kotlin/Drive.kt",
            "android/app/src/androidTest/java/DriveAppTest.kt",
            "docs/android-ios-pwa-ui-parity.md",
        ]))

    def test_pwa(self):
        self.assertEqual("pwa", classify_paths([
            "web/src/PwaInstallDialog.tsx",
            "desktop/tests/pwa-install-dialog-race.cjs",
        ]))

    def test_pwa_advisory_observers_have_narrow_fast_scope(self):
        # These PRs touch only nonauthoritative PWA UI activity hints.
        self.assertEqual("pwa", classify_paths([
            "web/src/pwaPeerActivity.ts",
            "desktop/tests/pwa-update-peer.cjs",
        ]))
        self.assertEqual("pwa", classify_paths([
            "web/src/pwaWorkloadSafety.ts",
            "desktop/tests/pwa-update-workload.cjs",
            "desktop/tests/pwa-peer-denied-capability-getters.cjs",
        ]))
        self.assertEqual("pwa", classify_paths([
            "web/src/pwaPeerActivity.ts",
            "web/src/pwaWorkloadSafety.ts",
        ]))

    def test_pwa_sensitive_or_cross_host_changes_require_full_ci(self):
        for paths in [
            ["web/src/pwaPeerActivity.ts", "web/src/App.tsx"],
            ["web/src/pwaPeerActivity.ts", "web/src/pwaOfflineDirectory.ts"],
            ["web/src/pwaWorkloadSafety.ts", "web/src/pwaTransferSafety.ts"],
            ["web/src/pwaPeerActivity.ts", "web/src/pwaDeviceEvidence.ts"],
            ["web/src/pwaPeerActivity.ts", "web/src/pwaSafeReadRetry.ts"],
            ["web/src/pwaPeerActivity.ts", "web/src/downloadSink.ts"],
            ["web/src/pwaPeerActivity.ts", "web/src/transferTransport.ts"],
            ["web/src/pwaPeerActivity.ts", "web/src/mediaBinaryProgress.ts"],
            ["web/src/pwaPeerActivity.ts", "assets/icon/web/sw.js"],
            ["desktop/tests/pwa-update-peer.cjs"],
            ["desktop/tests/pwa-update-workload.cjs"],
            ["desktop/tests/pwa-update-peer.cjs", ".github/workflows/ci.yml"],
            ["web/src/pwaWorkloadSafety.ts", "internal/auth/session.go"],
            ["web/src/pwaPeerActivity.ts", "ui/shared/src/mui/XDriveApp.tsx"],
        ]:
            with self.subTest(paths=paths):
                self.assertEqual("full", classify_paths(paths))

    def test_offline_release_publisher_only_uses_narrow_scope(self):
        publisher = "scripts/ci/mirror-server-to-share.py"
        regression = "scripts/ci/test-mirror-server-to-share.py"
        self.assertEqual("offline-release", classify_paths([publisher]))
        self.assertEqual("offline-release", classify_paths([publisher, regression]))
        self.assertEqual("offline-release", classify_paths([regression, publisher]))

    def test_offline_release_never_weakens_critical_or_cross_domain_checks(self):
        publisher = "scripts/ci/mirror-server-to-share.py"
        for sensitive in (
            "scripts/offline/xdrive_offline.py",
            "scripts/offline/delivery_descriptor.py",
            "scripts/offline/build-five-packages.sh",
            "scripts/xdrive-share-update.py",
            "scripts/ci/mirror-clients-to-share.py",
            "scripts/ci/test-mirror-clients-to-share.py",
            "scripts/ci/classify_pr_scope.py",
            "scripts/ci/test_pr_scope.py",
            ".github/workflows/offline-packages.yml",
            ".github/workflows/ci.yml",
            ".github/workflows/release.yml",
            "deploy/install-server.sh",
            "scripts/test-release-attestation-contract.py",
            "web/src/api.ts",
            "android/app/build.gradle",
            "AGENTS.md",
            "docs/installer.md",
        ):
            with self.subTest(sensitive=sensitive):
                self.assertEqual("full", classify_paths([publisher, sensitive]))
        self.assertEqual("full", classify_paths(["scripts/ci/test-mirror-server-to-share.py"]))
        self.assertEqual("full", classify_paths([publisher, "scripts/ci/../test.py"]))
        self.assertEqual("full", classify_paths([publisher, "/absolute/path"]))
        self.assertEqual("full", classify_paths([]))

    def test_offline_release_jobs_and_final_gate_are_explicit(self):
        from pathlib import Path
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        for job in ("offline-release-tests", "offline-security-contract"):
            self.assertIn(f"  {job}:\n    needs: pr-scope\n", workflow)
            self.assertIn(f"      - {job}\n", workflow.split("\n  final-gate:", 1)[1])
        self.assertIn(
            'elif $scope == "offline-release" then accepted(["offline-release-tests", "offline-security-contract"])',
            workflow,
        )
        self.assertIn("full|docs|android|pwa|offline-release", workflow)
        self.assertIn("python3 scripts/ci/test-mirror-server-to-share.py -q", workflow)
        self.assertIn("python3 -m unittest discover -s scripts/offline -p 'test_*.py'", workflow)

    def test_unknown_and_cross_domain_fail_closed(self):
        for paths in [
            [], ["desktop/tests/pwa-install-dialog-race.cjs"],
            [".github/workflows/ci.yml"],
            ["scripts/ci/classify_pr_scope.py"],
            ["web/src/api.ts"], ["ui/shared/src/mui/MediaGallery.tsx"],
            ["internal/api/router.go", "docs/api.md"],
            ["web/src/pwaInstall.ts", "internal/auth/browser_cookie.go"],
            ["android/app/src/main/kotlin/Drive.kt", "web/src/api.ts"],
            ["docs/asset.md", "scripts/server-restore.sh"],
            ["README.md", ".github/workflows/release.yml"],
            ["docs/script.sh"], ["docs/config.yml"],
            ["docs/run_test.py"], ["docs/archive/config.json"],
            ["docs/AGENTS.md", "internal/api/router.go"],
            ["docs/../internal/auth.go"],
            ["docs/copied.md", "internal/auth/original.go"],
        ]:
            with self.subTest(paths=paths):
                self.assertEqual("full", classify_paths(paths))


if __name__ == "__main__":
    unittest.main()
