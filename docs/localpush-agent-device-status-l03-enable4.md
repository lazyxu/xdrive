# L03-Enable-4 · owning Agent first-file device registration isolation

## Accepted baseline and rationale

Parent #2257 adds a read-only Agent first-file job status for the genuine manual Windows/Linux first-file Backup-only <=64MiB Stage → CAS/SQL upload. Its in-memory job key previously contained only Server/account/session/Source. On re-enrollment to a **different local DeviceID** under the same login and Source, the status reader could otherwise correlate with the original device's process job. The real upload still independently validates device/Root/Source; this change closes the narrower **status and join** identity gap without opening a new writer.

## Changes

- Add the **currently OS-registered canonical device UUID** to the in-process job key. Read from the existing per-Server/account local registration only; do not enroll, rotate, repair or contact a different device. A missing, invalid or changed registration fails closed.
- Read and validate registration before both start/join and status lookup, then re-read registration and account/session after the operation/read. A re-enrolled device cannot read the previous job or join it. The existing source-wide in-process block still rejects a second physical job even when the registration changes.
- Protect both running and completed in-process observations; device UUID remains private, absent from IPC status JSON. Preserve all four redacted states, explicit refresh and fail-closed unknown status. Web/Mobile Web/foreign Desktop remain read-only.
- Add Go tests for changed/invalid registration, direct job observation isolation and no duplicate task; a Node source contract checks the owning-Agent-only bridge. No new public Server endpoint, Stage/COMMIT/CANCEL/retry, SourceRun, key retirement, scheduled upload or backup completion.

## Acceptance

This is a **single stacked work commit** on parent #2257 until parent accurate-head CI and rebase merge. Then restack this child on complete current master retaining all exact scoped file blobs, obtain its own full exact-head Windows/Linux/real PostgreSQL Race/Web/Desktop/packages/Rootless/Final Gate, fresh clean mergeability, and rebase merge. Tests are code-level; no physical production deployment or >=4GiB/100k performance is claimed.

Production-environment security acceptance: **按用户决定跳过（未验收）**. Never request production credentials, access, HAR or human acceptance, and never treat it as code/CI/PR gate. Continue source authorization/native/SQL/CAS verification.
