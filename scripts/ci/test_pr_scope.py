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
