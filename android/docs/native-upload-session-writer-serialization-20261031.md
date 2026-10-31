# Android native UploadSession: app-process single writer gate

Android Photos/Video backup P0 prerequisite, 2026-10-31.

Android's existing `XDriveApi.uploadFile` is the ONLY Go UploadSession
transport used by SAF files, manual Gallery single-original and the verified
incremental photo batches. A future WorkManager runner must use that same
transport. The Controller's in-memory `fileUploadActive` gate alone cannot
serialize **separate** XDriveApi instances owned by foreground and background
components.

This patch adds a process-wide Kotlin coroutine Mutex at the common
`uploadFile` transport boundary, before POST /uploads. It remains held
through all chunk PUTs, Go finalize, and bounded best-effort abort cleanup.
A concurrent writer suspends before opening any second UploadSession. A
cancelled waiter is never sent; cancellation or failure of the active writer
releases the mutex in a guaranteed `finally` path. No second HTTP client
pipeline, Server or receipt-schema change is introduced.

**Important boundaries:**
- This is in-process arbitration. WorkManager uses the app process by
  default; a future remote/multi-process worker must also acquire an
  OS-level cross-process lease before uploads. No current background
  scheduler or automatic backup is claimed.
- The mutex cannot prove a lost ACK completed; the existing persistent
  original intent journal retains MAY_HAVE_SENT/UNKNOWN_ACK and blocks
  speculative replay. The guard does not mark any original verified.
- No new token storage, crypto, local media metadata persistence, or
  upload permissions.
- Never change running/passed Android Gallery PR HEADs to integrate this
  standalone prerequisite; use a verified developer-branch integration only
  if related CI has not started.

JVM tests verify two concurrent clients cannot enter the write body at
once, queued cancellation does not run, and exceptions release the permit.
Exact PR HEAD Android unit/lint/debug APK/emulator + required Final Gate
remain the merge gate. Actual background worker/device/100k+ acceptance:
**跳过（未验收）**.
