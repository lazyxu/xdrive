# G2c2d2b3c3a — original-operation SQL/CAS-held private precommit window

## Starting point

The genuine manual owning Windows/Linux Desktop **Backup-only**, single <=64 MiB first-file Push remains enabled in merged source through #2212. Its successful native/SQL/CAS observation is **not** whole-folder backup completion; `backup_complete=false` and `retirement_safe=false`.

B1 (#2222) already supplies a private `xd_local_push_file_terminals` schema, uniqueness indexes and a source-wide writer embargo. B3b2/B3c1/B3c2 supply original-operation UPDATE locks and pinned double-verified CAS. Their current candidate only commits a **read-only** SQL transaction and releases the physical CAS pin. A result returned after releasing those locks cannot become a safe terminal INSERT ticket.

## This narrow source change

- `internal/api/local_push_first_file_sql_receipt.go` retains the original public and private **read-only** call signature through an unchanged wrapper. A separate, unexported transaction hook can execute *inside* the original pinned CAS callback, immediately before the same SQL transaction commits.
- `observeBoundLocalPushOriginalCASWithPrivatePrecommit` is **UNROUTED** and uses only the actual `*storage.Local` double-hash-before-COMMIT inspector. No arbitrary remote CAS inspector or Stage/Node identifier may establish physical truth.
- The hook refuses an absent/weak selector, requires `requireFileTerminalVacant=true`, and inherits exact Owner, current unrevoked Device/Root, paused Backup Source/revision/target, original Operation UPDATE, immutable Stage binding, canonical SQL COMMIT, CAS hash and Blob/Node/SourceItem locks. It runs with the transaction and CAS pin alive, not on an advisory result returned from a previous transaction.
- The hook is intentionally **not wired to a production HTTP handler or Agent call**. A test-only synthetic file-terminal insert verifies SQL transaction coupling, source-wide replay embargo, and unchanged PENDING SourceItem/zero SourceRun; other genuine PostgreSQL/CAS fixtures cover invalid selector/key, missing original COMMIT and callback-error rollback. Failure after entering the callback is classified as **UNCERTAIN**, not physical CANCEL or safe retry.

## Explicitly not finished

A real native Writer witness must still be correlated from the **same owning Agent-held original OS descriptor and private O_EXCL Writer lock**, across an authenticated Server request, to the original Operation/Stage/SQL/CAS transaction. A fabricated digest, success boolean, stale HTTP ACK or released OS lock is not that proof. This PR does **not** expose an endpoint or permit arbitrary callbacks from Renderer/Web/foreign Desktop; it does not emit production `LocalPushFileTerminal` records, retire old Stage/request key or permit second-file/automatic SourceRun/scheduling. Physical-CANCEL quiescence is entirely separate.

Next: define and verify the native witness and original-operation transport; publish one real physical COMMIT inside this same retained transaction and CAS pin; replay lost ACK without duplicate INSERT or false cancellation; audit and separately implement credential/Stage retirement; then bounded multi-file and scheduler.

## Validation

Own exact HEAD full Go Linux/Windows, real PostgreSQL API Race, Desktop/Web/build and Final Gate CI are required before merge. Production-only security acceptance is permanently **按用户决定跳过（未验收）**; never request production account/credentials/HAR or installed-production sign-off, or block code/CI/PR on them. Code-level Owner/Device/Root/native/SQL/CAS and hostile negative tests remain mandatory.
