# G2c2d2b3c1 · physically pinned original CAS pre-COMMIT window

## Source baseline and dependency

- Parent [#2280](https://github.com/lazyxu/xdrive/pull/2280) is the independent B3b2 **private, read-only** original Operation UPDATE / file-terminal vacancy / genuine physical CAS candidate. It must complete its own exact-head full CI and merge before this child can be rebased onto complete master and merged.
- The already merged [#2212](https://github.com/lazyxu/xdrive/pull/2212) keeps **manual owning Windows/Linux Desktop Backup-only first regular file <=64 MiB** Stage → canonical CAS/SQL enabled. No complete SourceRun, second file or scheduled backup exists yet. [#2222](https://github.com/lazyxu/xdrive/pull/2222) installed only the immutable SQL terminal slot/guards; #2274 installed native held Writer historical read.
- This B3c1 increment is a **native Local CAS storage primitive only**. It does **not** implement the terminal SQL INSERT/COMMIT, remote physical CANCEL, original native-file/Writer cross-host proof or request-key/Stage retirement. It creates no Server or Agent route, no Desktop IPC and no user-visible controls.

## Exact new execution window

Implement `storage.Local.InspectPinnedLocalPushHistoricalCASBeforeCommit(ctx, casKey, expectedSize, callback)` under a *single existing canonical CAS file descriptor and nonblocking shared shard lock*. A caller must first obtain/retain SQL Owner/Device/Source/Root/original Operation/CAS locks in their prescribed order, and separately hold and verify the strong original native descriptor.

1. Validate canonical CAS SHA key, size 0..64 MiB, available context and callback. Acquire the cooperative CAS shared OS shard with **try-lock**, not a blocking inversion under SQL locks; reject busy without invoking callback.
2. Verify exact canonical path/inode/size/mtime and hash actual bytes against the SHA **twice before invoking any callback**. A corrupt/missing/busy CAS or canceled context never calls the callback.
3. Only after two full hash checks, invoke one callback **while the same CAS descriptor and shard lock remain held**. A future transaction owner may perform a bounded original-operation SQL COMMIT here, but this helper itself does no SQL or terminal write.
4. Recheck exact inode and bytes after callback and release every lock/descriptor. If callback already committed SQL but returns an error, the caller context cancels, post-hash changes, or close fails, the result is **UNCERTAIN**. It must be reconciled against the original durable operation, never converted into physical cancellation, "not committed", or permission to mint a new Stage/key.

The extra SHA read is intentionally limited to the *already enabled <=64 MiB first-file scope*. Before raising limits to >=4GiB or 100k, collect matched baseline/after physical throughput numbers and revisit hashing cost.

## Tests and exclusions

Native Go tests exercise an original Stage removed after CAS canonicalization, a second Local Store instance blocked from deleting the CAS under callback, callback exactly once, bad canonical key/size, same-size CAS modification, pre-cancellation, cancellation/error in callback, post-callback corruption detection and release of pins on failure. The original historical read-only inspector is **unchanged**, including its before/after checks.

A successful storage callback still does **not** prove a trusted original OS file, SQL terminal decision, cross-host writer quiescence, complete backup, safe file removal or Stage/key retirement. A future B3c2 phase must integrate independently authenticated original Agent native proof and retained Server SQL lock with an actual durable terminal record and idempotent replay; physical-CANCEL needs its own independent quiescence protocol.

## Branch and merge discipline

This child is exactly ONE scoped commit on the latest accepted B3b2 parent; do not treat parent CI as child CI. After #2280 exact-head full CI/Final Gate merge, rebuild this child as ONE work commit on the complete new master with cumulative AGENTS. Require its own genuine Linux+Windows Go/Race, real PostgreSQL API Race, Web/Desktop, Rootless/images/packages/artifacts, Final Gate, and fresh clean mergeability before Ready/rebase merge.

Production security acceptance: **按用户决定跳过（未验收）** permanently. Never request production host, credentials, cookies, JWT, HAR or manual production sign-off or block source/CI/PR on it. Code-level Owner/Device/Root/native/SQL/CAS tests remain mandatory.


## Additional process-isolated CAS pin regression

A real separately started Go test process now attempts an **exclusive OS shard try-lock** while `InspectPinnedLocalPushHistoricalCASBeforeCommit` holds the original shared file/lock during the callback. It must observe `busy`; after the callback and descriptor close it must observe `free`, and the original Store must be able to delete the CAS. This is stronger than two Store instances sharing one Go process and exercises Linux/Windows lock behavior under the existing cross-platform Go CI. It does not provide SQL terminal INSERT, native-original/remote quiescence proof, key retirement or multi-file backup.


## Explicit callback-entered uncertainty result

A return error **after callback entry** now wraps the exported typed sentinel `storage.ErrLocalPushCASPrecommitOutcomeUncertain` with `errors.Join` while retaining the underlying cause (cancellation, callback failure, physical post-hash error, descriptor-close error). An error **before callback entry** must never carry that marker. Even a callback error can follow a durable SQL COMMIT, so the future caller must query its ORIGINAL immutable operation rather than infer rollback, issue a new key/Stage, or declare physical CANCEL. All native/OS and Go negative tests assert this distinction. No new active Server writer or transport is introduced.

## Nonblocking CAS busy is an explicit failure, never a false success

If `TryOpenPinnedCAS` reports contention as `(nil,false,nil)`, this private **pre-COMMIT** helper translates that result into `storage.ErrLocalPushCASPrecommitBusy`, retaining `matched=false` and never entering a callback. This is deliberately stricter than the existing read-only historical observer's non-authoritative busy signal. Native Local Store tests hold a competing real OS exclusive CAS shard, verify the callback did not run, ensure no UNCERTAIN marker (no commit attempt), then release the shard, retry the private inspection, and delete physical CAS to prove no leaked pin. It does not create a new SQL terminal writer or expand production Push permissions.
