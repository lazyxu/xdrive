# Local Push v2 — bind the ordinary upload Session before any byte

## Current result

PRs #2394, #2395 and #2400 are merged. They establish one ordinary
`/uploads` CAS/Node/FileVersion writer, durable Server-private per-file
`LocalPushCommonUploadOperation`, exact owning-device admission, binding and
original SQL receipt replay.

This change closes the Go **transport** gap without implementing another
upload/physical-commit engine. No existing owning Agent IPC production path
has been switched on.

## Same original file Operation

- The owning Agent's trusted native Inventory planner persists a canonical
  Operation UUID BEFORE any HTTP attempt. `localpushcommon.Plan.ResumeKey()`
  deterministically derives `lp2_` from Server/account/session, owning
  Device/Root, Source/revision, native file identity, SHA/size and target.
- The Go Client calls the private Owner+Device+Root `admit` endpoint.
  Current Source, Root binding and historical legacy SQL quarantine are
  rechecked on the Server. If identical work is already committed, private
  `receipt` returns the original NodeID/revision/content SHA without
  reading an expiring UploadSession or mutable current Node.
- For reserved/bound work, the Client calls **the existing**
  `StartUpload`; its new opt-in session gate calls the authenticated private
  `bind` endpoint for EXACTLY that active UploadSession before the first
  upload chunk or any Finalize. A missing/denied bind fails closed.
  Ordinary uploads call the same engine with no gate and retain their old
  behavior.
- The existing generic chunk/retry/finalize path writes CAS, Node and
  FileVersion. The merged #2395 hook persists the original committed
  Operation within the SAME SQL finalizer.
- The Agent checks original private `receipt` before claiming a file-level
  commit. If HTTP or Finalize ACK is lost, it checks the same original
  Operation again. A committed exact result may be recovered even when the
  generic HTTP result is unavailable/stale; otherwise the file remains
  `UNCERTAIN`. Do not mint a replacement Operation, assume cancellation
  or release a legacy Stage/Key/Writer.
- The bounded serial two-file adapter accepts file B ONLY after A has a
  matching immutable original committed SQL result. Unit mocks cover this
  ordering and fail-closed stop; they are **not** real Agent/E2E evidence.

## Boundaries and next required work

The new Go Client receipts have `json:"-"` private fields, strict explicit
negative authority flags, exact Source ETag, no-store response requirements
and canonical UUID/SHA validation. There is no public Web/Mobile or foreign
Desktop Push control, no raw local paths/tokens in the response.

This is an **inert library/transport** increment. It does not wire real
local native scanning/file descriptor lifetime or a persistent per-file
Agent plan journal to this bridge. Neither an OS-lock witness nor an ordinary
HTTP ACK is a remote kernel-lock attestation, and no such special remote
proof is required by the simplified common upload architecture.

Before activating multi-file backups:
1. Persist immutable per-file Planner Operations and native-open/close/digest
   evidence in the owning Agent; pre/post source identity checks must reject
   local file replacement and mutation.
2. Fail closed on old Agent-local O_EXCL Stage/SecretStore/Writer claims and
   old Source-wide Server SQL quarantine; migrate only with audited exact
   per-original-operation readback, no blanket deletion or timer inference.
3. Nonproduction E2E with genuine Server PostgreSQL/CAS and Linux/Windows
   owning Agents: one A/B run, lost Start/Chunk/Finalize ACK, Agent/SRV crash
   after bytes but before acknowledgement, 403 revoke, 429/503 retry and
   Source/Root changes. Assert no duplicate Node/FileVersion, unverified
   terminal, or unauthorized foreign-device write.
4. Only then connect real SourceRun/queue, bounded concurrency, nested
   directory ancestor ACLs, schedule/watchers, reboot recovery and performance
   BEFORE/AFTER. Web/Mobile remain readonly for foreign backups.
5. No `backup_complete`, `retirement_safe` or `current_cas_verified`
   claims arise from this transport; only the authenticated SQL original
   file Operation may be described as committed.

Production-only inaccessible security acceptance is **按用户决定跳过（未验收）**,
not a code, CI or merge blocker. Controllable source-level Owner/Device/Root,
PostgreSQL/CAS, native safety and race tests remain mandatory.
