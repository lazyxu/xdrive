# Frozen historical artifacts from divergent iOS branch #4205

Original branch: `fix/ios-gallery-files-4205-ci-contracts-visual-regressions-20261109` at exact Git commit `fb3b6e22df05390cb7ec76b926a7ee3fb937758e`. This directory is a **non-executable, byte-identical preservation area**. All seven files that were absent from successor #4260 are copied through their exact Git blob SHA, **not** reimplemented or silently ignored. `.snapshot` extension prevents auto-discovery as active workflow, JS tests, Swift UI tests or Python scripts.

| Original path | Original Git blob SHA | Archived path |
|---|---|---|
| `.github/workflows/ios-offline-owner-autopop-diagnostic.yml` | `fd587f3cdc716d9dea27be8ddfb85c1bb27e5887` | `.github/workflows/ios-offline-owner-autopop-diagnostic.yml.snapshot` |
| `desktop/tests/ios-native-autopop-workflow.cjs` | `af8f05268507ce2d0d497197a797af51aed2bca9` | `desktop/tests/ios-native-autopop-workflow.cjs.snapshot` |
| `desktop/tests/ios-native-files-recovery-initializer.cjs` | `e1d40ddd40e9afb3065e98e859a0dcd6ba1e14ad` | `desktop/tests/ios-native-files-recovery-initializer.cjs.snapshot` |
| `desktop/tests/ios-native-gallery-files-reload-frame-audit.cjs` | `75718ba674e2c7993d75b2c9deab266569247db6` | `desktop/tests/ios-native-gallery-files-reload-frame-audit.cjs.snapshot` |
| `ios/UITests/XDriveIOSOfflineAutoPopUITests.swift` | `6945cc4cf96810ffa9353aaaaa4c190c23a99e38` | `ios/UITests/XDriveIOSOfflineAutoPopUITests.swift.snapshot` |
| `ios/scripts/monitor-native-autopop.py` | `b7601102b2a9159c5cdc85758d5e46dc0a826f33` | `ios/scripts/monitor-native-autopop.py.snapshot` |
| `ios/scripts/prepare-native-autopop-smoke.py` | `7c50a6bac3fa4c8193b87aa36a7644885da25ce9` | `ios/scripts/prepare-native-autopop-smoke.py.snapshot` |

## Why they are deliberately not activated

- Offline native AutoPop tests compare current candidate no-Session recovery against a deliberately modified historical B9 fixture. The old candidate source guard requires `XDriveIOSNativeFilesNoSessionChild`, but current code moved to `XDriveIOSNativeFilesNoSessionRoute`. Re-enabling the old workflow verbatim would cause a false red CI on current source and two unnecessary macOS runners per PR.
- The former no-Session recovery initializer test depends on a `fileprivate init` and background Retry path not present in current SwiftUI routing. Current policy must fail closed rather than restore unauthorized Retry solely to satisfy a stale regex.
- The reload/frame-audit test and watch scripts need updated, real Simulator case scopes and modern PhotoKit/Owner epochs before becoming release gates.
- Historical paths alone do not establish actual first-frame timing or a successful XCTest outcome.

Related [active preservation suite](../../../../desktop/tests/ios-native-4205-preserved-regressions.cjs) and [reconciliation ledger](../../ci/ios-gallery-files-4205-preservation-audit.md).

**Cleanup rule:** Continue to retain the old branch while the remaining divergent product source changes and nontrivially different XCUITests are audited. After semantic coverage, exact-HEAD CI and Final Gate on successor PRs, use GitHub Actions SHA-leased pruning only.
