# L03-F2d8c3b2r — owning native CURRENT advisory seal → durable Server consumption

**Status:** private, non-operational provenance bridge. Predecessor #1910 passed complete 76-job CI and merged its PostgreSQL one-use challenge table and private issuer/consumer. This phase deliberately does **not** promote a read-only native observation or consumed nonce to executable Local Push.

## Implementation

- The owning Agent now has a **private, unrouted** \`sealOwnLocalBoundBackupFirstDirectoryNative\` helper. It accepts only an existing Server-issued non-JSON challenge with the exact Owner, Source, revision, cloud target, enrolled device, Root UUID/fingerprint, and current two-generation native directory selector. The Agent verifies the bound paused Source and owning credential **before and after** fresh native CURRENT observation and refuses drift, revocation, account/session changes, altered target, changed ignore/schedule policy or mismatched Root grant.
- The native reader uses existing sealed CURRENT/PREVIOUS evidence, full checked inventory, actual OS directory strong identity and double stat checks. Only then may the Agent's OS-private device credential seal the observation. Every returned field remains \`json:"-"\`; no raw Root path, token, nonce, file name, digest or source-specific item detail can leak to Renderer/Web.
- Real isolated PostgreSQL/Gin integration composes the accepted native fixture with the accepted private Server issuer and **one-time consumer** across a real directory. The complete read→seal→consume sequence changes only the private challenge state. Positive tests assert **zero Node/SourceItem/SyncRun** mutations, replay denial and terminal consumed receipt. Separate native replacement and post-seal device revocation tests prove fail-closed behavior.
- Agent injected-reader tests cover two Server scope reads, exact challenge Target/Device/Root/revision checks, native verification errors, revocation/token drift, target drift, canceled context, HMAC verification and JSON redaction. Desktop source-contract test forbids exposing the helper through REST, Agent IPC, Electron Main/Preload or Web.

## Security limitation

**There is no production challenge transport and no native filesystem handle held atomically across Server PostgreSQL.** The issuance and consumption are PRIVATE Go routines; no new route or Agent IPC is registered. An already valid MAC may remain cryptographically valid after an on-disk directory is replaced; a fresh filesystem recheck only narrows, but cannot eliminate, that time-of-check/time-of-use gap. This phase never calls the CI-only directory writer and does not create a cloud Node, SourceItem, FileVersion, Blob, durable SourceRun or CAS reference. A consumed nonce is **not** a backup receipt, native-handle attestation or write capability.

Production \`local_folder\` activation, manual run/cancel and automatic scheduler stay **hard denied**; private Stage <=64 MiB, Mirror two-complete-scan/24h/trash-only safeguards and foreign Desktop/Web read-only policy are unchanged. Existing Yike/Synology Pull and legacy NAS stay untouched.

## Acceptance and next step

Require exactly one work commit on a frozen GitHub master, complete exact-HEAD Go Linux/API PostgreSQL Race, Go Windows, Web/Desktop, images/artifacts, single-commit and final-gate CI before Ready/Rebase merge. After merge verify the scoped work branch is deleted; never disturb unrelated PRs.

Next, implement an explicitly private **transaction-bound native-handle lifetime and authorization protocol**, with crash-safe challenge/Node/SourceItem recovery and durable one-run receipts, before any production Local Push route, real recursive upload, Desktop Start/Cancel, >64 MiB/4 GiB streaming or installed Windows/Linux 100k acceptance can be enabled.
