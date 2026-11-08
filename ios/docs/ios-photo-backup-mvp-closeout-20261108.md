# iOS Photos incremental backup: one-PR MVP closeout

Repository: `lazyxu/xdrive`; target PR [#4126](https://github.com/lazyxu/xdrive/pull/4126). Baseline merged [#4104](https://github.com/lazyxu/xdrive/pull/4104). Do **not** rewrite accepted UploadSession/CAS/Node receipt authorization, a live queued/green PR solely to consolidate, or the protected original staging/ledger.

## Scope and verified evidence boundaries

| Priority | Workstream | Code delivered in #4126 | What is not yet an accepted result |
| --- | --- | --- | --- |
| P0 | BG continuity | On protected-data availability, check current scoped managed grant, photo permission, stop fence, no active task, and zero pending receipts before *requesting* another ordinary BGProcessing window. No writer runs from a lock/unlock notification. | The OS may never start a pending task; original staging and ledger remain protected while locked. Forced quit is not bypassed. |
| P0 | Incremental queue counts | `summary()` requires matching secure PhotoKit change token and Full authorization; a lagging replay returns **unknown**, not false zero. | Current cloud Node proof is distinct from local queue state. |
| P0 | Task pagination | Each bounded page checks Owner/permissions, a start and finish PhotoKit generation, and for the change queue a replay-caught-up witness. Invalidate old UI and verification on transitions. | A screenshot/source regex is not hardware acceptance. |
| P0 | Recovery regression | Persistent SQLite reopen/old-dated import/edit/delete/stale settlement/expired-history reconciliation tests, plus existing real platform CI and unknown-ACK gates. | Only an authenticated final Node readback can settle a possibly committed UploadSession. |
| P1 | Per-photo state | Optional, explicitly triggered, eight-at-a-time **read-only** original SHA + managed Node audit in the 64-item library task page. Proofs are invalidated on PhotoKit or Owner change; no new writer. | Unopened rows remain `待核验`; no fake green checks. |
| P1 | Background diagnostics | Non-secret per-Owner last observed BG reason and time (locked data, permissions, pending receipts, history recovery, network preflight, expiration, bounded success). | No OS-delivery guarantee or inferred "never started" from missing telemetry. |
| P1 | Whole-library summary | Save an **as-of** count only after every authorised item was individually checked for the same verified managed target. Show the historical timestamp. | Cannot label a stored snapshot today's cloud coverage without revalidating every live Node and original. |
| P2 | iOS original free-space deletion | **Not enabled.** Existing safe thumbnail-cache cleanup remains available. | Actual Apple Photos deletion may propagate via iCloud to other devices; requires an irreversible-action UX and a durable protected Server retention guarantee covering each verified original/Live pair through deletion. A simple historical ACK or timestamp is not sufficient. |
| P2 | APNs silent wakeup | **Not enabled.** Keep OS-approved BGProcessing and foreground catch-up as the functional mechanism. | APNs requires supported signed entitlements, registration/Owner-scoped revocation, provider credentials and fail-closed scheduling. Silent pushes are low-priority and may be throttled/undelivered; unsigned SideStore builds do not prove APNs delivery. |

## Invariants

1. No new UploadSession writer, no Owner-root fallback, no change to Keychain `WhenUnlocked` / FileProtection.complete for original files or AES-GCM ledgers.
2. Do not delete iPhone originals in response to a historical local `confirmed` queue entry, an incomplete full-library scan, or a cloud preview. The runtime does not issue `PHAssetChangeRequest.deleteAssets`.
3. A PhotoKit token from before an edit/deletion or old-dated import does not authorize the next positional cursor; a lost/expired history token requires explicit foreground whole-library scope consent.
4. A network failure before a possible write may schedule a bounded later attempt, but an ambiguous create/finalize or a revoked Device/BG grant pauses. Do not reset unknown-ACK state to `pending` by refreshing UI.
5. No PhotoKit identifiers, original bytes/GPS, raw JWT, managed upload grant or Device secret in diagnostic UserDefaults or historical audit counts.

## Validation before merge

- Exact current PR HEAD: native macOS Xcode/iOS unsigned IPA; Swift queue/policy fixtures; Node source contracts; applicable Go API and SQL/CAS/Owner/Device tests; complete CI and Final Gate.
- For previous frozen HEAD, a source-contract failure was observed because new non-secret diagnostic lines appeared immediately before the previously asserted fail-closed branches. Update the assertions **to require the diagnostic plus original pause/permission guard**, not remove those guards.
- Physical iPhone with PhotoKit/iCloud, sleep/locked data, APNs and production NAS: **跳过（未验收）**. Do not state that these have passed.

## Release semantics

`MVP backed up` means a specific current original passed an exact authenticated managed Node and SHA receipt readback. `BGProcessing completed` means one OS-admitted *bounded window*, not all iPhone assets or a guaranteed schedule. `历史整库核验` is a timestamped retrospective and cannot be displayed as live coverage. Leave #4126 Draft until exact HEAD required CI and Final Gate are successful.
