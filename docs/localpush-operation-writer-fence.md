# L03-G0-A2b2b2c2c3a — transaction-held local operation writer fence

**Accepted prerequisite:** #2017 c2c2 corrected one-work HEAD
`07aa0ab7dfa60a4c8980f14b7b31572d3bac4fc1` completed
[full CI #39089960618](https://github.com/lazyxu/xdrive/actions/runs/39089960618)
with 76 jobs (25 passed / 51 conditionally skipped / final-gate green),
was Ready/Rebase merged as `b48e027f45677d224839ad1b99b06b625267c9f2`,
and its related remote branch was independently removed.

## Exact gap

A durable `aborted` or `expired` Server **reservation** (c2c1/c2c2)
does not itself fence a physical CAS/SQL writer, and definitely does not
attest a complete original-file backup, canceled SourceRun, or key-retirement
eligibility. The existing true physical first-leaf writer is private and
CI-only; its CAS pin and SourceItem PENDING receipt still do **not** carry an
authenticated operation UUID/generation to the canonical SQL commit.
Never interpret a time-limited reservation as evidence of physical quiescence.

## Scoped Server-only precommit interlock

New UNROUTED `validateCurrentLocalPushWriterFenceTx` receives an already
existing **caller-owned GORM transaction**, authenticated owning Agent
context, exact Source ID/revision, original nonzero 32-byte request key and
UUID/generation. It takes locks in Owner SHARE → Device UPDATE → Source
UPDATE → Root SHARE → latest operation UPDATE order; no Stage/CAS/Node
locks may precede it. Inside the same caller transaction it checks current
unrevoked Owner/device/Root, current Source revision/target, canonical
request-key digest in constant time, exact latest generation, strictly
`reserved` with no aborted timestamp, an **actual PostgreSQL
`clock_timestamp()`** inside the original 30-second lease, and the
**absence of an immutable terminal receipt** for the same generation.
Missing terminal table, missing row, stale/foreign/forged input, invalid
clock, canceled request or contradictory state denies rather than falling
back to the owner JWT.

Any future authorized original-byte/CAS/SQL writer MUST invoke this gate
**before Stage/CAS/Node locks**, keep the same SQL transaction and intent
UPDATE lock through its durable commit, and invoke it AGAIN immediately
before that final COMMIT. Abort, concurrent future generation and terminal
recording follow compatible SQL locks, so a concurrent abort cannot pass
the held writer and retroactively authorize new writes. This helper's
success is NOT an upload permit; it is only one necessary SQL precommit
condition. Physical native Root handle attestation, real file content
identity, object-store pin lifetime, CAS integrity, canonical SourceItem
and FileVersion association with operation UUID/generation, durable
SourceRun/cancel provenance, crash recovery and post-commit verification
must be reviewed and integrated separately.

## Validation, preserved NO-GO and next stages

Two independent PostgreSQL pools verify current-key rechecks, absent
state mutations, foreign/forged/revoked/rotated Device/Owner/Root/Source,
older generations, wrong/reused key, invalid database clock, terminal
contradictions, missing migration and cancellation. An explicit
two-pool hold-vs-abort fixture forces the second Server's abort to
fail on Context timeout while the first transaction retains its latest
operation UPDATE lock; abort succeeds only after that transaction closes.
A separate test advances DB expiry **inside** the same transaction and
requires the precommit recheck to deny. Node/SourceItem/SyncRun must
remain untouched; the isolated fixture does not create the File table, and
this helper performs no canonical file mutation. Static Desktop contract forbids exporting this
internal helper via Web/Renderer/Agent IPC, Router or scheduler.

This change has **no production caller**, no new route, no database
schema, no actual commit or uploader, no SourceRun, no mirror deletion,
no persistent writer lease, and never deletes/rotates/retires a native
SecretStore key/claim. Existing `local_folder` activation remains hard
denied, temporary Stage remains <=64 MiB; Web/Mobile Web/PWA/foreign
Desktop read only; NAS Push unsupported, Pull unchanged. Linux/Windows
CI and PostgreSQL two-pool tests are not physical installed Desktop,
100k-file native upload or >=4 GiB real backup acceptance.

**Next c2c3b:** bind this transaction-held operation fence to an
independently witnessed original-file/CAS/SQL writer within the same
physical+SQL commit protocol (source-first lock order and revocation
audit). **Next c2c3c:** only after durable writer quiescence, real
commit/cancel receipts, crash/lost-ACK replay and strict no-generation
races can a separate owning Agent request-key retirement protocol be
considered. No premature `retirement_supported=true`.

Deliver using exactly ONE scoped work commit, its own complete exact-HEAD
Go Linux/PostgreSQL Race/Windows/Web/Desktop/Rootless/image/artifact/
single-commit/final-gate CI, clean Ready/Rebase and verified short-lived
branch cleanup. No GitLab or native installed hardware validation claimed.
