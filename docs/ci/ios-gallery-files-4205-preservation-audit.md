# Historical iOS Gallery/Files #4205 preservation audit

**Review baseline:** `344f9903ca9fa642427c54e677b51844a4bba262` on `master`. **Original divergent head:** `fb3b6e22df05390cb7ec76b926a7ee3fb937758e` (`fix/ios-gallery-files-4205-ci-contracts-visual-regressions-20261109`). **Active successor:** [#4260](https://github.com/lazyxu/xdrive/pull/4260), whose head may change concurrently.

This is a **non-destructive extraction**, not a wholesale merge of the 50 old commits. A comparison at audit time showed 50 commits ahead / 54 behind master, with 44 changed paths. Exact blob comparison to the then-current successor found **8 identical files**, 1 identical to master, **7 files absent from the successor**, and 28 files with different contents. Blob difference alone cannot prove functionality has been lost.

## What is actually preserved

- `docs/ci/ios-gallery-files-4205-historical-scenarios.json` archives the **184 historical source checks**, their exact patterns, source paths, and original case names, even for obsolete contracts. It is a data record, **not automatically executable or product-authoritative**.
- `desktop/tests/ios-native-4205-preserved-regressions.cjs` reactivates **58 specifically selected historical scenarios (73 individual source assertions)** that matched the exact reviewed master snapshot. Tests run in normal Node CI and fail if those admitted contracts disappear.
- Source assertions do **not** establish actual frame-by-frame smoothness, P50/P95 physical performance, Owner-signed access, or successful XCTest execution. These require dedicated Simulator and device evidence.

## What still needs reconciliation before deleting the old branch

1. Historical native AutoPop experiments: `.github/workflows/ios-offline-owner-autopop-diagnostic.yml`, `desktop/tests/ios-native-autopop-workflow.cjs`, `ios/UITests/XDriveIOSOfflineAutoPopUITests.swift`, `ios/scripts/monitor-native-autopop.py`, and `ios/scripts/prepare-native-autopop-smoke.py`. Their frozen published-b9 fixture intentionally modifies a **disposable copy** of old source; review runner/trigger and permission assumptions before porting.
2. `desktop/tests/ios-native-files-recovery-initializer.cjs` relies on the retired `NoSessionChild` and `fileprivate init` implementation. **Do not restore those symbols or an unauthenticated Retry action solely to satisfy a stale regex**. Re-express the intended Owner authorization checks against today's `NoSessionRoute`.
3. `desktop/tests/ios-native-gallery-files-reload-frame-audit.cjs` may reference old album reload and screenshot instrumentation. Rebase its semantics, not byte contents, on current PhotoKit epoch and capture policy.
4. The old and active successor `XDriveIOSFilesSessionRecoveryUITests.swift` contain distinct no-Session journeys; 13 original test method names were absent in an initial successor name audit. Validate equivalent protected-read behavior before marking migrated; some deliberate no-Retry behavior is stricter now.
5. Old `ios-native-navigation-continuity.cjs` had 184 scenarios versus 94 in the earlier successor snapshot. **126 scenarios are not yet admitted into the new executable suite**; some duplicate newer tests or assert obsolete UI layout. Review per-case semantic equivalence, then preserve useful remaining checks in a future focused PR.
6. `ios/scripts/capture-navigation-smoke-frames.py` and latency scripts differ. Genuine XCTest frame collection and P50/P95 claims must retain tagged timestamps and finite sample limits; source matches alone are insufficient.

**Deletion gate:** Do not delete the old branch until #4260 and this extraction PR are merged, all seven absent-path intents have been reconciled, no unique test or product behavior remains unaccounted for, and a GitHub Actions cleanup run confirms an exact-SHA lease. Historical SHA remains pinned in this ledger for audit.

## Intentional safety boundaries

Never merge old production Swift/Go code wholesale, turn disabled protected reads into authorized reads, re-enable unauthorized no-Session Retry, add test-only synthetic URL or fake taps, or claim UI smoothness from source string checks. Keep native physical/UI validation separate.
