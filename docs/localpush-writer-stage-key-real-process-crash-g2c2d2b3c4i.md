# G2c2d2b3c4i — real owning-Agent OS process crash after Writer/Stage/Key reservation

This Stage-1, non-production fault-injection regression runs a **real
separate Linux/Windows OS child process** using the xDrive Agent test
binary. That child first obtains the original `localpushwriter.Begin`
kernel lock and permanent Source-wide marker, then reserves the O_EXCL
Stage admission and mints the original 32-byte SecretStore request key.
Only after all three have persisted does it signal its readiness.

While the child holds its original lock, the parent verifies that a
competing Writer, Stage and request key are denied. It then forcibly
terminates the child (not `Claim.Close`) and recreates the exact
owner/Source/Root/native Writer and Stage/Key admission calls from a
fresh process context. **None** may return success even though the
kernel released the OS lock. The original private Writer quarantine,
O_EXCL Stage bytes and OS-private request key remain unchanged. Drift
in session, Source revision or target cannot bypass the Source-wide
stable admission slot.

This is a real **OS process-kill** test for the *local* Agent lifetime
and three durable reservations, not an actual networked Server crash,
in-flight HTTP ACK loss, SQL/CAS terminal replay, proof that remote
writes have quiesced, or a successful physical-COMMIT/CANCEL. No
production runtime code, Stage cleanup, new key, public API or second
file is enabled. A local OS lock becoming free is explicitly NOT
permission to retry or declare `retirement_safe`.

The test is Linux/Windows only and uses ephemeral fake account/Root
identifiers, an isolated `0700` Agent configuration and disabled
external Secret Service for the test fixture. The raw key is never
printed or sent over IPC. CI must run actual Go Linux/Windows with
race, authentic PostgreSQL API Race and all existing Final Gate
dependencies. Inaccessible production acceptance stays
**按用户决定跳过（未验收）**, with controlled source-level
security and non-production tests mandatory.

**Remaining critical Stage 1:** independently trusted owning
Agent→Server original fd/Writer Claim proof, real same-transaction
`physical-commit`, independently quiesced physical-CANCEL, and actual
HTTP lost-ACK/Agent+Server process restart readback. Only then may
Stage/Key/Writer retirement or file #2 be considered.
