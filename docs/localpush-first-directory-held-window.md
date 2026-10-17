# L03-F2d8c3b2w — private held-directory read window and fail-closed teardown

**Status:** Agent-local read-only lifecycle prerequisite, after #1937. No production Local Push upload route, SourceRun, write receipt, automatic scheduler or remote mutation capability.

## Scope and implementation

The existing `RecheckLocalFirstDirectoryNative` captures the strong native identity and sealed CURRENT/PREVIOUS journal while holding an OS handle, but closes that handle before returning an observation. The new **package-private** `recheckLocalFirstDirectoryNativeHeld` accepts a local read-only callback and keeps the same opened directory handle alive for the callback's entire duration. The exported compatibility method simply calls the helper with no callback; its return contract is unchanged.

Before the callback it checks the exact stored Root grant, current two-generation sealed evidence and inventory, live pathname identity and the *opened handle's* strong Linux/Windows native identity. The callback sees only `LocalFirstDirectoryNativeObservation` (all fields excluded from JSON), never the OS file descriptor, device token, Root path or a write capability. Afterwards it checks context cancellation, the stored Root grant, sealed evidence integrity, pinned pathname identity, and pinned strong native identity again. The handle is closed by a `defer` on every exit. Callback rejection remains privately sanitized; `context.Canceled` and `context.DeadlineExceeded` propagate.

Native physical tests exercise successful private read-only callback, Root grant removal while the handle is held, concurrent context cancellation, error redaction, rotated CURRENT evidence, and Linux same-name directory replacement (Windows may deny rename of an open directory). None generates cloud Node, SourceItem, FileVersion, CAS, SourceRun or any authoritative backup-complete bit.

## Critical limitations

An OS file descriptor does not make remote Server PostgreSQL transaction execution atomic: the handle remains on the Agent machine and there is no authenticated cross-machine holder/transaction protocol, durable Server prepare/commit receipt, lost-response recovery or crash-safe cancellation. A strong read-only identity key cannot guarantee contents are immutable, cannot prevent temporary A-B-A or races after the callback, and is **not** proof to consume an advisory nonce or call `commitBoundLocalPushFirstDirectoryTx`. This helper stays unrouted and has **no** production caller that writes. No authority is given to Desktop B/Web/Mobile Web, NAS Push or the scheduler. `local_folder` active/run gates remain off; private Stage <=64MiB, Mirror delete disabled, existing Pull unaffected.

## Acceptance and next step

Maintain exactly ONE scoped work commit on a frozen master. Require full exact-HEAD GitHub Go Linux/API real PostgreSQL Race, Go Windows/Desktop/Web/images/artifacts/single-commit/final-gate CI before Ready/Rebase merge; then verify branch cleanup. A successful local held callback proves only a bounded **local** lifetime. Next stage must implement independent device-bound Server admission and reliable intent/abort/recovery across process boundaries, without promoting advisory evidence to backup authority. No installed 100k, >=4GiB or physical power-loss acceptance is claimed.
