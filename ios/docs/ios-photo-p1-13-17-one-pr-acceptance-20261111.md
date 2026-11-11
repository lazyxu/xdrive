# iOS Photos P1 #13–17 — one PR: code hardening vs real-device acceptance

This plan is deliberately one candidate PR, against the existing incremental
PhotoKit → Owner/Device/Source/Target → UploadSession/CAS → current Node receipt
architecture. It does **not** create a second uploader or claim that A/B/C
tests prove real signed iPhone or physical NAS behavior.

Related real-device issue: [#4249](https://github.com/lazyxu/xdrive/issues/4249).
All items below remain **D: NOT RUN** until signed physical evidence exists.
Use one source commit for iOS build and record the running Server commit.

| ID | Source / automated gate in this PR | Physical completion evidence still required |
|---|---|---|
| 13 | PhotoKit read-only production 256/64 scanner probe; finite 10k/100k sample policy, cancellation and generation fences | On separate real iPhone libraries of about 10k and 100k, record actual photo count, wall time, first/slowest page, process high-water RSS, scroll/page latency (Instruments or screen capture), return and cold-launch/resume; no IDs/photos or tokens in logs |
| 14 | 10k/100k deterministic Focused cursor/repeat/unknown-ACK/restart policy regression, existing owner/current target checkpoint; no unsafe automatic cursor advance | Real long foreground Focused session, cancellation at a partial 20-upload window, app restart, same Owner/target, screen lock/unlock, queue-first and exact Node receipts before cursor reuse; collect actual iOS behavior, no lock-screen continuity guarantee |
| 15 | Owner-scoped live `processing` state on the task page, preserved exact active ID when an unknown ACK pauses; `needsReconciliation` label has no false green status, existing waiting/failed/confirmed statuses retained | Observe real pending → uploading → verified or waiting-iCloud/failed; interrupt Finalize ACK and confirm exactly that current Owner's item shows pending-review, never second upload until read-only receipt proof |
| 16 | Completed in-memory whole-library audit shows explicit `as-of` timestamp; historical receipt tally remains separate and never divided by current local PhotoKit count | Real full read-only audit (every current media + current managed Node revision), version/Owner invalidation and as-of timestamp; no stale 100% after editing or server/target changes |
| 17 | Independent read-only mounted-storage checksum+Live manifest+part CRC and optional actual ffmpeg full-decode verifier; synthetic corruption/duplicate/path negatives in CI | Independently open the actual deployed NAS/CAS original *outside the uploader*, match current authenticated Node size+SHA-256, use `--decode` for HEIC/video/Live still + motion, confirm iPhone/desktop playback and record redacted proof |

## Exact signed-device measurement (#13)

1. Install the separately Apple-signed xDrive IPA; record app full Git commit, iOS
   version, hardware model and current PhotoKit Full Access. Record actual
   authorized media count and whether photos are local or iCloud-only.
2. On the native **相册元数据** screen use **实测当前授权图库的完整扫描**.
   It walks the production stable 256-slot scanner and 64-slot pages, capturing
   wall time, first-page and slowest-page read duration, and process-wide
   historical peak RSS (not an isolated PhotoKit allocation). No media IDs,
   GPS, bytes or private paths are retained; cancel/PhotoKit changes invalidate
   the result. Repeat for **10k and 100k real libraries**.
3. Separately measure actual interactive scroll frames and gallery/tab return
   with Instruments/XCTest videos, and cold-launch/resume after app restart.
   The read-only metadata probe **does not** measure those UI interactions.
4. Preserve the exact observed values rather than pre-filling thresholds or
   claiming that a synthetic 100k arithmetic test is a real 100k photo scan.

## Focused and status (#14–16)

- While Focused is active, cancel after 20 new originals or an uncertain ACK.
  Only a completely scanned 256-slot window without unavailable/ambiguous items
  can create a resumable boundary. On restart revalidate PhotoKit token,
  current Owner/Device/Source/Target, and all current Server receipts.
- The task page shows a RAM-only `processing` overlay only for the running
  exact local PhotoKit ID in the current displayed Owner. A stopped upload
  with an unknown receipt keeps that same ID as `needsReconciliation`.
  This is a visual warning, not a new durable queue state or evidence of
  a successful write. Other rows never inherit the state.
- On full audit completion, the visible `as-of` time is bound to the
  completed current-Node readback. Leaving the page, changing Owner, losing
  photo permission or entering background clears the live green result.
  Historical audit snapshots explicitly remain historical.

## Deployed NAS independent restore (#17)

With a mounted **real deployed** NAS/CAS file (or an independently exported
readback of those same deployed bytes), obtain **fresh** current Server
Owner/Source/Target/Node revision, original SHA-256 and byte count. Do not paste
credentials, Node IDs, GPS, raw media, personal paths or tokens into a PR.

```sh
python3 ios/scripts/verify-nas-photo-original.py \
  --file /mounted-real-nas/example-original.zip \
  --expected-sha256 <current-node-64-hex-sha> \
  --expected-bytes <current-node-byte-count> \
  --kind live --decode
```

For a standalone HEIC use `--kind image --decode`; for a large video use
`--kind video --decode`. `--decode` requires a working ffmpeg decoder and
fully decodes each component, including both Live resources. Without it the
script proves bytes (and, for Live, complete ZIP/store/manifest/CRC), **not**
playability. A successful local test with synthetic content cannot prove
NAS retention or real HEIC codec support. Confirm playback separately.

The verifier does not access upload credentials, mutate the NAS, delete
originals, or infer the origin of the file path: the operator must establish
that it is truly the deployed storage file and preserve the redacted source
and mount evidence. Record PASS/FAIL/NOT RUN for each physical test in #4249.

## Release gates

- Exact candidate HEAD: full CI / Final Gate, Swift pure-policy/SQLite,
  Go+PostgreSQL current Node/CAS integration, unsigned IPA build and actual
  iPhone Simulator backup-page tests must complete without failures.
- Run the new NAS verifier synthetic rejection suite in Linux CI.
- **Do not merge solely because tests are queued**. Physical signed iPhone,
  10k/100k timing, Focused lockscreen and real NAS restore remain `NOT RUN`
  in #4249 after a green code PR and must not be reported as product-proof.
- No request for unconditional locked-screen backup, Apple Photos deletion,
  APNs or a separate writer is introduced by this PR.
