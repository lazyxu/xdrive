# Local Push v2 · durable original file checkpoint inside common upload finalize

Implementation status: **unrouted / not yet runtime-activated**. Parent #2394 must first pass its own exact-head full CI and merge; this is the next dependency slice.

## Why

The ordinary xDrive UploadSession is already durable for its limited 24-hour lifetime, and its finalizer atomically commits CAS/Node/FileVersion with its Session state. But neither that session's expiration nor a current Node DTO can be a permanent original Push result. This slice introduces **one Server-private SQL checkpoint per immutable file Operation**. No second file-byte writer or native kernel-lock attestation subsystem is added.

## SQL contract

`xd_local_push_common_upload_operations` records an immutable `operation_id`, Owner + Owner session, owning Device/Root and fingerprint, Source and Source revision + expected target root, exact target/create-or-overwrite revision, immutable SHA/size and stable nonsecret `lp2_` resume identity. Session binding and committed NodeID/NodeRevision live on the same private row. Operation and resume identities and bound UploadSession IDs have unique constraints; nullable session binding allows admission before upload starts. No local absolute path, OS handle, raw device token or SecretStore key is stored.

When a bound `lp2_` Session reaches the **existing** `finalizeUploadSession` transaction, `persistLocalPushCommonUploadFinalizedTx` independently checks Owner session, current nonrevoked Device, current paused Backup-only local Source revision/target root, LocalSourceBinding Root fingerprint, immutable target and current canonical File/SHA/size. Only then it writes `state=committed`, original `result_node_id`, original `result_node_revision` and `committed_at` **inside the same SQL transaction**. A false/absent/stale binding, stale revision, content mismatch, or revoked identity rejects the entire finalizer, not a standalone terminal. Ordinary uploads never access this new table. Immediate generic CAS fast path is disabled for `lp2_` until binding is complete; generic conflict skip is not a committed Push file.

An already committed row must remain independent of future changes to the Node and the 24-hour Session janitor. Lost ACK recovery must later read the immutable original row through an owning Device/Root/Source-private read route. Current general `GET /uploads/:id` and `FinalizeUpload` reply can project current mutable Node and must NOT be used as post-retention Push proof.

## Tests and limitations

- Postgres fixture exercises original transaction rollback, one immutable commit, refusal of second terminal, content drift, Owner session change, Source revision drift, device revoke and Root change.
- Pure Go guards ensure ordinary uploads bypass the new private check and an unbound `lp2_` session cannot become authoritative.
- The first binding hook only accepts immediate children of the immutable Source target directory. Nested directory targets are intentionally **not** authorized by this checkpoint until a separately reviewed ancestor/Owner scope query is added; do not bypass this by trusting a caller supplied parent ID.
- No owning Agent device admission or bind route exists **yet**. The DB fixture intentionally inserts a synthetic private binding to test the transaction logic; this cannot justify `backup_complete=true`, `retirement_safe=true`, Stage/Key/Writer cleanup, file B, SourceRun or automatic backup.
- Follow-up must expose a **private device-bound Source admission/bind/replay** that creates/binds the row before ordinary upload finalize, ties actual native verified Inventory to immutable target and survives missing ACK / Agent and Server process restart. Runtime only switches after this plus old in-flight Stage/key quarantine migration and cross-platform SQL/CAS E2E.

Production-environment security acceptance: **按用户决定跳过（未验收）**; controllable nonproduction Owner/Device/Root/native/SQL/CAS tests, exact-head CI, and Final Gate remain mandatory.
