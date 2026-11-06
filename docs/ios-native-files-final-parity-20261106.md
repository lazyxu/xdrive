# iOS Native Files — final P0/P1 parity follow-up (2026-11-06)

## Scope and dependency

This change is the **one additional** iOS Files parity PR after existing [#3965](https://github.com/lazyxu/xdrive/pull/3965), and reuses #3965's grouped Server directory indexes, bounded inline folders, Quick Access, operation history and read-only Viewer return semantics. It must merge only after #3965 passes its **own exact-HEAD iOS Unsigned IPA, full CI and Final Gate**, and #3965 merges to master. Retarget this PR to master only after the parent is merged and compare all affected source, DTO, test and workflow inputs. No direct master pushes, no unrelated Photos/Server API changes and no second CAS/upload/move writer.

## Audited P0 / P1 scope

| Owner priority | What was already implemented | This follow-up |
| --- | --- | --- |
| P0 folder/Viewer navigation | #3953 retains verified NavigationLinks/thumbnail rows on push/pop; #3965 avoids read-only Viewer reload | Keep already verified rows on same-owner sort/regroup, suppress fast progress stripe and refresh only after confirmed management/restore mutations; read-only Locate/Properties/Version History does not trigger an unconditional reload |
| P0 large directories and regressions | 64-row authenticated Server Range, four-page sliding window, reverse-page merging, original-owner thumbnail checks | New source contracts for 10k/100k window logic, same-scope atomic refresh, delayed feedback, cancellation, drag race; no unbounded client list/thumbnail prefetch |
| P1 #3965 group/inline/Quick Access/undo | Complete implementation and tests on #3965 (not master until accepted) | Preserve those functions and their required checks; fix the displayed parent name for an inline child's management sheet |
| P1 Browse home | #3958 Saved Search, #3965 verified Favorites and Quick Access | Owner-verified tag shortcuts on Browse home, explicit loading/retry and full-index filter-only Search |
| P1 Native/PWA interaction parity | Existing sort, clipboard, copy/move, version, tags, list/grid and selection | Native system drag for one verified list/grid item to a folder with process-only provider + nonce + confirmed Server atomic move; full Server **Select All ≤200** using 64-row requests; retained-list loading, busy/error feedback and cancellation |

## Security and integrity rules

- **Old list remains only for an identical verified Owner/root/folder/query/filter scope.** New-Owner/different-folder reads clear old rows and mutation controls are disabled until the Server page is confirmed. A 300 ms feedback task cannot commit stale state after epoch cancellation.
- Read-only panels do not cause a network reload. Confirmed Server changes still reload and re-prove current Owner, Node/revision and folder. The management sheet receives the *actual inline child parent*, never the outer Browse folder as the destination label.
- Drag provider contains only an opaque **process-local** UUID nonce (no bearer, byte contents, node path or writable external drop). The current Owner, exact captured Node/revision, verified destination, nonce, admissibility and explicit confirmation are all checked again before the **existing Server atomic batch Move**. No automatic retry of an unknown ACK. Arbitrary external drops are not trusted.
- The bounded Select All button is available only for **200 or fewer actual Server directory entries**. Fetch every counted 64-item Range; reject total mismatch, duplicate/missing IDs, wrong parent, changed visible revision, Owner change or superseded selection. Cancellation must preserve the previous selection and never synthesize success.
- Tag shortcuts use the canonical Owner Server `/api/v1/search` with `tag_id` and no local-window filtering or independent tag index.

## Automated regressions

`desktop/tests/ios-native-files-final-parity.cjs` is required by `.github/workflows/ios-unsigned-ipa.yml` and asserts retained rows/cancel epochs, navigation/reload eligibility, delayed feedback, Owner/source parent names, browse tag routing, drag provider nonce and confirmed atomic operation, 64-row full-range selection, and existing bidirectional window/thumbnail identities.

Existing #3965 Swift/Foundation grouping, inline and Quick Access tests plus all #3953 and #3958 tests remain mandatory. Source-contract assertions are not evidence that SwiftUI itself compiles or that a gesture was performed on a physical iPhone.

## Merge and acceptance

- Exact-HEAD iOS Native Unsigned IPA compile and required Swift/source checks: **pending CI**.
- Full applicable CI, Final Gate, review/mergeability: **pending CI**.
- No quantified latency or memory improvement is claimed; performance requires same-source/same-runner paired results to make a numerical claim.
- Real iPhone gesture, screenshot, accessibility and latency: **跳过（未验收）**, not added to the actionable automated backlog.

Do not merge if #3965 is still Draft/failed, if a required check is queued/failed/skipped, or if retargeting changes production source or test contract semantics without revalidation.
