# Native iOS Photos uncertain-receipt review (stacked follow-up)

## Relationship to current Photos MVP

This PR targets the **#3268 development branch**, not master; do not modify or
invalidate #3268's already-running iOS IPA or complete CI. The parent native
foreground auto scheduler pauses on an uncertain create/upload/finalize ACK
but otherwise had no native recovery control. This follow-up uses the
already-shipped encrypted Owner/Device ledger and **read-only** native
reconciler from the Web bridge: no second uploader, no new Server API and
no transfer of Web/PWA cookies to native Swift.

## Safety gates

- Status reads use the existing Keychain identity only; they never generate
  a new encryption namespace. An inaccessible/missing journal is not proof
  that a paused schedule can be resumed.
- A capped 20-operation batch uses the *same global original-run gate*
  as foreground and BG originals, held from before the first Owner check to
  the end of the batch; no concurrent source writes.
- Every record is checked with a fresh native Owner-root verified token and
  existing HMAC resume proof, then checked against the exact current Owner
  Node SHA/revision before the sealed journal may transition to confirmed.
  A missing/expired/ambiguous session never justifies a new write.
- Cancellation, UI disappearance and Owner switch invalidate displayed
  counts, release the gate and leave unknown ACKs in the encrypted ledger.
- Resuming a paused foreground schedule requires a separate explicit native
  confirmation, a newly verified exact Owner, **zero** pending entries from
  the existing authenticated ledger, same local emergency-stop generation,
  current PhotoKit access and an active foreground scene.
- The schedule store's existing configure path retains the previous window
  index and PhotoKit epoch, so the next foreground check is due rather than
  silently claiming previously skipped files were copied.
- The old separately approved BG grant is *not* implicitly restored or
  modified. It is unrelated to a foreground-only pause.

## Deliberate limitations

This remains an observation-only recovery UI. It **does not** finalize an
active session, upload missing chunks, delete uncertain operations, mark
missing sessions as safe to retry, or bypass prior protected receipt
checks. If 20 oldest records remain unresolved, the user may need further
Server/device investigation; all remain on disk.

Required gates: exact-HEAD macOS unsigned IPA, CI Final Gate, native source
contract tests and real device Owner A→B→A, suspended/expired access token,
crash/lost-ACK tests. Real device acceptance is **跳过（未验收）** until observed.
