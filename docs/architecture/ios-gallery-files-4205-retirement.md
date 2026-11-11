# iOS Gallery/Files legacy 4205 branch — reviewed retirement

Review date: 2026-11-10. Historical unmerged branch `fix/ios-gallery-files-4205-ci-contracts-visual-regressions-20261109`, immutable audited tip `fb3b6e22df05390cb7ec76b926a7ee3fb937758e`. Canonical in-flight integration: [#4260](https://github.com/lazyxu/xdrive/pull/4260). This review does **not** establish real-device zero flicker, FPS, or an iPhone crash root cause.

## Exact file audit

The historic tip is 50 commits ahead and 54 behind master at the 10:29 UTC checkpoint. These are **Git history counts, not 50 missing features**. The 44 affected paths were compared at Git blob level against master `6b0a874a3a9639a55bf92eb37e1cbc85ace9ce6d` and #4260 `96b84bd501957676ad87aadd7621f50deeda2abb`:

| Relationship of old blob | Paths | Decision |
|---|---:|---|
| Byte-identical to the canonical #4260 blob | 8 | Already retained |
| Byte-identical to accepted master | 1 | Already retained |
| Different from both current trees | 28 | Do **not** merge an obsolete implementation into newer Owner/PhotoKit/Files UI; modern regression semantics are audited below |
| Old-only paths, absent from canonical PR | 7 | Reviewed individually as historical fixtures / obsolete assertions |

The eight exact matches are: `desktop/tests/ios-native-files-collections.cjs`, `ios-native-gallery-files-subroute-lifecycle.cjs`, `ios-native-local-gallery-bounded-retention.cjs`, `ios/XDriveIOS/NativePhotoAlbumBrowser.swift`, `NativePhotoViewerReturnAnchorPolicy.swift`, `NativePhotoWallDensityPolicy.swift`, `ios/tests/NativePhotoViewerReturnAnchorPolicyChecks.swift` and `NativePhotoWallDensityPolicyChecks.swift`. At this snapshot `ios/XDriveIOS/NativeLocalContinuousGallery.swift` was byte-identical to master. This is a point-in-time blob comparison; subsequent branches can advance.

## Seven absent old paths and explicit disposition

- `.github/workflows/ios-offline-owner-autopop-diagnostic.yml`, `desktop/tests/ios-native-autopop-workflow.cjs`, `ios/UITests/XDriveIOSOfflineAutoPopUITests.swift`, `ios/scripts/monitor-native-autopop.py` and `ios/scripts/prepare-native-autopop-smoke.py`: historical *published b9* / synthetic AutoPop experiment, not a production feature. The disposable instrumentation attempted a native SwiftUI dismissal, sometimes confused by transient view identity. Current production no-Session UI is a separately bounded, Back-only route; reinserting the old fixture or a fake Retry/AutoPop into the shipping app would be a regression. Preserve the old SHA in this audit rather than relaunching this obsolete workflow.
- `desktop/tests/ios-native-files-recovery-initializer.cjs`: asserted a former `XDriveIOSNativeFilesNoSessionChild` and `fileprivate init` route. The current implementation uses `XDriveIOSNativeFilesNoSessionRoute` and checks current Owner/Session before constructing a protected File or Trash reader. Its correct modern denial and no-retry behavior is asserted by `ios-native-gallery-files-4205-retirement.cjs`.
- `desktop/tests/ios-native-gallery-files-reload-frame-audit.cjs`: historical album double-invalidation, same-verified-page and frame watch assertions. The new targeted source tests retain single-invalidation, library-revision, generation, and case-scoped frame guarantees, without pinning old Swift formatting or a particular batch of test names.

## 28 changed paths: do not cherry-pick stale code

The old patch modifies older Files root/folder and Recent/Favorites flow, PhotoKit album/Viewer/page lifecycle, UI tests, screenshot tooling, and test source assumptions. Current master/#4260 contain newer implementation paths; a raw merge would regress security admission or undo later tab/scene work. A raw copied `ios-native-navigation-continuity.cjs` is especially inappropriate: the old tip had **184** named structural scenarios versus **94** in #4260 at the snapshot. Many old assertions require retry buttons or old type names that are deliberately no longer present; the smaller newer count is not itself a coverage regression. All **38** historic `XDriveIOSGalleryFilesStabilityUITests` method names appear in #4260's **52** methods. The old `XDriveIOSFilesSessionRecoveryUITests` had 21 methods versus 24 in #4260: 13 names differ or are obsolete and newer tests cover Back-only, no-Session denial and lifecycle under the changed contract. The method-name comparison does not by itself establish identical runtime coverage.

The new `desktop/tests/ios-native-gallery-files-4205-retirement.cjs` adds five current-code regression checks for: (1) protected Files no-Session route and intentional absence of Retry, (2) album single invalidation and grant/revision check, (3) exact-generation bounded PhotoKit handoff plus scanner cleanup, (4) real Gallery/Files UI test entry points, (5) screenshot capture confined to the active XCTest. Source preflight on #4260 `d2be2499bd1026da8264de0207c0686bc5b85252`: **21/21 static predicates matched**. This is **not** a Node, Xcode, Simulator, CI or Final Gate pass.

## Retirement guard and acceptance

The matching entry in `.github/retired-branches.tsv` is intentionally staged **only in canonical PR #4260**, not live master. The trusted cleanup script checks the **exact SHA** `fb3b6e22df05390cb7ec76b926a7ee3fb937758e` and protects master and every branch used as an open PR head/base. It cannot delete an advanced ref. The old branch is not considered safe for automatic deletion *before* #4260's current HEAD passes CI, iOS IPA, relevant native Simulator, Final Gate, and merges to master. Once the parent is merged, the reviewed manifest can be applied by an authorized manual cleanup scan; no actor should delete the branch based on its name or an unchecked claim of equivalence.

Do not resurrect legacy Retry/AutoPop, weaken Owner/PhotoKit fencing, or declare real-device/per-frame flicker acceptance from static tests.
