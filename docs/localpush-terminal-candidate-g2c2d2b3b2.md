# G2c2d2b3b2 — original-operation SQL decision-slot + physical CAS candidate

## Accepted live baseline

- `#2212` already enabled a manually initiated real owner-device Windows/Linux Desktop first-file `<=64 MiB` Backup-only Stage -> CAS/SQL upload. It stays enabled. An uploaded first leaf remains `PENDING`; the whole Source backup is **not** complete.
- `#2222` added the private `LocalPushFileTerminal` schema and Source-wide COMMIT/CANCEL exclusion read; **no production file-terminal INSERT** exists.
- `#2274` added original OS-native Writer held read-only historical SQL/CAS recovery, but released OS locks by themselves cannot prove remote physical cancellation.

## Scoped B3b2 implementation

Provide an **unrouted Server-private** `observeBoundLocalPushHistoricalPhysicalTerminalCandidate` using the existing genuinely authenticated historical physical first-leaf read. Its new selector mode holds **original Operation UPDATE** (not a transient SHARE) under the existing Owner SHARE -> Device UPDATE -> Source UPDATE -> Root SHARE -> Operation UPDATE -> immutable Stage binding SHARE -> file-terminal vacancy -> canonical SQL COMMIT SHARE -> physical CAS pin path.

While the same PostgreSQL transaction is live, require an EMPTY Source-wide `LocalPushFileTerminal` table slot and reject any later Operation generation. The original operation UUID/generation/request-key digest, Stage/snapshot/path/content, Owner/session/device/Root and original canonical Node/SourceItem CAS receipt must all match. The physical CAS callback rehashes the genuine local store bytes before the transaction is committed. Any missing table, foreign key, changed Source/device, previously recorded terminal, missing original SQL COMMIT or missing/corrupt CAS is DENIED. Default existing historical observations retain their old read-only semantics.

The result is a private unexported-field advisory snapshot; its JSON is `{}`. The SQL locks and physical CAS pins are gone when it returns. **This result must never be submitted later as an authoritative decision, reused as a writer ticket, treated as a Native witness, or used to retire a Stage/key**. A future terminal recorder must repeat all checks under the **same retained write transaction**, with an independently held original-native witness and proof of remote writer quiescence for physical CANCEL.

No new routes, IPC, SourceRun, scheduler, second file, credential retirement or public write privilege. Do not convert `expired`/`aborted` into physical cancellation. Mirror/NAS and Web/foreign Desktop remain read-only/unavailable for Push mutation.

## Verification and next work

New true PostgreSQL + physical Local CAS integration tests check the original committed path, no terminal insert, no SourceRun, SourceItem still pending, JSON privacy, negative wrong key/Stage/generation/Owner/revoked device/cancelled context, missing physical CAS/table/COMMIT and existing terminal. Node source contract ensures default route/Agent IPC remains unreachable and prohibits mutators. Complete source-exact Go Linux and Windows, true PostgreSQL API Race, Web/Desktop, image/build/installer artifacts and Final Gate are required before merge.

Next: combine owner-device Agent's verified held OS original with a **durable** authenticated same-transaction terminal COMMIT, physical-CANCEL-vs-COMMIT exclusion and independently verified remote quiescence; then separately implement audited Stage/key retirement, multi-file SourceRun, and automatic scheduler. Do not misstate advisory B3b2 as production terminal completion.

Production-installed environment security acceptance: **按用户决定跳过（未验收）**. It never blocks source code, CI, review or merge; do not request production access, credentials, Cookie/JWT/AK, HAR, production packet capture or owner manual production signoff. Source-level authorization, native and PostgreSQL/CAS integrity tests remain mandatory.

## Source projection regression and exact-head CI correction

The initial CI #39560601147 rejected the positive real PostgreSQL/CAS candidate because the existing `checkLocalPushStageScopeTx` selected only `kind`, `direction`, `status`, `revision` and target, **not `sync_mode`**. The new Backup-only check therefore read Go's empty zero value and denied a valid Backup Source. The corrected current Source projection explicitly includes `sync_mode`, preserving all existing Source/Root checks. A negative Mirror-mode case and a Node source contract guard this field. The superseded RED CI must not be treated as acceptance; the rebuilt exact HEAD requires fresh full CI including real PostgreSQL API Race and Final Gate.
