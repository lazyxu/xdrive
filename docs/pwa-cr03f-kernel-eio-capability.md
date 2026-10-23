# CR03f F0 · Real Linux block EIO capability probe (2026-10-23)

This is an isolated, **capability-only prerequisite**, not an IndexedDB or
production behavior acceptance. Existing #2388 real browser QuotaExceeded,
#2412 native LevelDB corruption, #2415 real POSIX EACCES, and #2422 EROFS
are separate evidence with separate error classes.

An ephemeral GitHub Ubuntu Runner creates a **new 64 MiB private sparse
loopback image** inside RUNNER_TEMP, maps it through its own dm-linear target,
verifies a direct kernel block read, switches the same private mapping to
device-mapper target "error", and requires a genuine direct I/O failure
containing "Input/output error". After restoring dm-linear, direct I/O must
again succeed and the mapping/loop image must be cleaned by an EXIT trap.
No production disk device, mountpoint, data source or path is accepted.
Only an anonymous exact-head JSON report is archived.

If the runner lacks dmsetup/loopback kernel privileges or reports any other
error, the workflow **must fail RED**. A successful run would only qualify
this runner for a later actual real Chromium IndexedDB failure/peer-purge E2E
using a disposable mounted filesystem. Until *that* separate E2E is proven,
the Issue #2348 **kernel EIO P1 behavior remains NOT TESTED**, and the test
does not represent EROFS or iOS/Android/Windows OS device behavior.

Inaccessible production-only safety acceptance remains 按用户决定跳过（未验收）.
This test has no product Go/Web/SW/IndexedDB modifications. Same-head
specialty/full CI and a clean one-work commit are required before merging.

## 2026-10-23 · Prior failed contract and current evidence gate

At original HEAD `69581fc2`, the independent EIO specialty failed in its
source-contract step before any Linux block-device test ran. The contract
incorrectly searched the **workflow YAML** for the word `losetup` even though
Ubuntu `util-linux` supplies that executable and the exact `sudo losetup`
invocations reside in the isolated Bash script. This repair preserves the
genuine EIO requirement and tightens the assertions to check actual
`losetup`/`dmsetup` calls in the script, plus the workflow's package setup.

This repair alone **does not** establish Linux kernel EIO capability.
The new accurate-HEAD native specialty must create its own disposable device,
prove direct-read `Input/output error`, restore and release the mapping.
If hosted runners cannot provide loopback/device-mapper, keep the result RED
and mark block-EIO `NOT VERIFIED`. Never replace it with injected JS errors
or a failed `EACCES`/`EROFS` test. Previous generic Desktop suite had the
same faulty source assertion and must also rerun.

## 2026-10-23 · Second diagnostic CI source-oracle fix

At test HEAD `0db70964`, the native workflow again stopped in the
**source-contract** stage (2/3 passed): a misplaced assertion referenced the
`key` loop variable outside its iteration. This was `ReferenceError: key is
not defined` and **never exercised a block device**. Restore the workflow
assertion inside its original loop and keep the Bash invocation checks in a
separate loop. No native script, kernel fault, or product code changes; exact
HEAD test-only CI must rerun. EIO remains unverified until a real direct I/O
operation returns kernel `Input/output error` on the private mapper.
