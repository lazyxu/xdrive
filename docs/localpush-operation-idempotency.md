# L03-G0-A2b1 — private idempotent admission of a Local Push operation

**Delivery:** One child work commit stacked above G0-A2a PR #1959.
Non-operational Server-private prerequisite only. There is NO production
Go Client, native Agent IPC, Electron, Web/Mobile Web, Browser or REST caller.

## Why

G0-A1 allocates a Server-generated operation UUID and generation. G0-A2a
observes an already known exact UUID. If the first response was lost, a blind
second reservation would not distinguish a new operation from a retry. A
durable idempotency key is necessary, but NOT sufficient, before activating
any device backup runner.

## Design

The private reserveBoundLocalPushOperationIntentWithKey helper requires
exactly 32 nonzero bytes. A future owning native Agent must generate these
using its OS CSPRNG and persist/reuse the SAME key for ambiguous retries.
The current product has NO such producer or transport. The keyed helper
fails closed for nil, zero or malformed-length keys; the existing unkeyed
Server-private method remains for legacy tests and internal callers.

Only a domain-separated SHA-256 request digest is stored as a nullable
field with a per-Source unique index. Preexisting unkeyed operation rows
retain NULL digests and can coexist. A digest/UUID is a correlation ID,
NOT a bearer capability, authorization, native Root proof, original
content proof, durable upload authorization or backup receipt.

Within the exact original Owner SHARE -> Device UPDATE -> Source UPDATE ->
Root SHARE transaction, the Server checks live account session, unrevoked
credentialed owning device, approved Root fingerprint, Source revision,
status and cloud target. Replaying a key returns the existing latest
UUID/generation ONLY if still live and reserved, and does not prolong its
PostgreSQL-clock 30s lease. An aborted, expired, older-generation or
changed-scope key can NEVER allocate a fresh operation. Another key cannot
replace a still-live reservation. After expiry/abort only a NEW key may
advance the durable generation. Historical rows remain as ABA fences.

No raw key, OS path, file name, user secret, CAS hash or content is stored.
The Server cannot establish actual key entropy: future native Agent
session/key lifetime and OS-handle binding demand a separate protocol.

## Tests and release gates

Isolated PostgreSQL two-pool tests exercise lost-reply same-key replay,
eight parallel retries, unique Source/digest index, cross-generation ABA,
different-key preemption denial, abort/expiry, corrupted/short/zero keys,
foreign Owner, forged device and rotated session, JSON redaction and
unchanged Node/SourceItem/SourceRun counts. Desktop source tests prohibit
any REST, Go Client, Agent IPC, Electron or Web exposure.

This stacked branch needs its OWN accurate-head GitHub Linux,
PostgreSQL API/Race, Windows, Web/Desktop, images/artifacts, single-commit
and final-gate CI before Ready/rebase merge; do not conflate its CI with
the predecessor PR. Actual installed Desktop/Windows/Linux 100k and >=4GiB
end-to-end and GitLab delivery are not claimed.

**Hard NO-GO:** Source local_folder activation, SourceRun and production
first-file commit remain disabled; Stage <=64 MiB, other Desktop and
Web/Mobile Web read-only, Mirror deletion off, NAS Push unsupported.
Next G0-A2b2 must independently bind authenticated native owning Agent,
live OS handle lifetime and one recoverable Server prepare/abort/commit
receipt before any real backup execution or UI operation port opens.
