# L03-F2d8c3b2u — atomic private challenge consumption inside a caller's SQL transaction

**Status:** Server-private, NOT executable Local Push. Prerequisite #1927 passed exact-head full CI and was Ready/Rebase merged. This is an authorization/recovery building block, NOT physical OS-handle-to-PostgreSQL atomicity.

## Why this contract is needed

Previously the owning Server consumed an issued, short-lived private first-directory challenge in its own PostgreSQL transaction. Any *future* independently committed PENDING directory or SourceItem write could fail **after** the nonce was already irreversibly consumed, leaving an ambiguous split receipt. This phase only extracts the same exact Owner / session / enrolled device / Root / Source revision / target / challenge row locks and HMAC / DB-clock checks into an unexported **caller-transaction-scoped** method.

## Implementation

- Add `consumeBoundLocalPushFirstDirectoryChallengeTx(tx, c, challenge, seal)` in `internal/api`. This method does not begin or commit a transaction: all locks, compare-and-swap and consumption occur inside the already-provided transaction. Nil transaction and forged/revoked/stale scope fail closed.
- The existing `consumeBoundLocalPushFirstDirectoryChallenge` private entry point wraps the new primitive with its original explicit single DB transaction and identical failure response; there is no API or model change.
- Real isolated PostgreSQL two-pool regressions prove a downstream test-only Node write and consumed challenge are **both** rolled back on injected failure, a second consume within the same outer transaction is refused and aborted, and the nonce remains usable exactly once after rollback. Verify no SourceItem or SourceRun appears.
- Keep Desktop source contracts asserting no Router/Go Client/Agent IPC/Electron/Web usage or exposure.

## Explicit non-goals / hard NO-GO

The HMAC is an **advisory** fingerprint of a previously observed local directory. An opened Linux/Windows handle exists in the owning Agent but is not held by the Server PostgreSQL transaction, and a strong identity cannot prevent path replacement after release. Therefore this transaction primitive must NEVER be directly connected to `commitBoundLocalPushFirstDirectory` or activated solely because the challenge was consumed. No production route, Agent IPC, Renderer button, native-to-SQL write, actual upload, file version, durable SourceRun, scheduler, Mirror delete or NAS Push is added. Existing 64 MiB temporary Stage and cross-device/Web/Mobile Web read-only constraints stay unchanged.

## Next executable milestone

Build a separately reviewed, time-bounded, fail-closed owning-Agent native lifetime/Server operation protocol with independent revocation, cancellation and replay controls. Only when physical CURRENT identity, Server authorization and SAME durable SQL unit are bound and crash-recoverable can pending directory/first file/SourceRun be enabled. Full Linux/Windows installed 100k and >=4GiB tests remain required.

## Merge gate

Exactly ONE scoped work commit on fixed master; own full exact-HEAD Go API/PostgreSQL Race, Linux, Windows, shared Desktop/Web, image/artifact, single-commit/final-gate CI required before Ready/Rebase. No local Go 1.25, actual GitLab or installed hardware acceptance claimed.
