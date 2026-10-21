# L03-G2c2d2b2c — read-only original Writer Claim correlation

## Accepted product state

Merged #2212 and #2241 already enable a **manual owning Windows/Linux Desktop one-file Backup-only upload** (first-level file, <=64 MiB), with the original O_EXCL Writer Claim held across authenticated HTTP Stage, immutable Operation COMMIT and historical SQL/CAS/native reconciliation. This increment does not remove that capability or grant Web/foreign Desktop mutation.

## Why this step exists

After an Agent crash, `flock`/`LockFileEx` is released but the original marker remains quarantined (negative process test #2245). B3 replay will need to identify the **exact original immutable native writer slot**, rather than mistakenly using a fresh session, changed target, or new key as evidence.

New internal `localpushwriter.ReadOriginalWriterQuarantine(ctx, originalScope)` is **read-only and fail-closed**: it checks the established private directory, exact same server/account/device/Source slot and *original* session/Root/revision/target/native-key/content correlation digest; opens a regular private file without following a symlink as evidence; reads at most one byte beyond expected marker length; compares exact content; returns no marker bytes/identifiers. Missing, malformed, replaced, public-readable or different-scope markers are denied. No directories/files are created or deleted, no OS claim is recreated, and there is no API/IPC or server write.

## What a positive read DOES NOT prove

This is merely a correlation to one pre-existing local O_EXCL marker. It does **not** prove that a remote HTTP writer has quiesced, that SQL committed, that a physical CANCEL happened, or that the original native file is still identical. It does **not** grant a new Stage/Operation/key, permit request-key retirement, update SourceRun, or activate retries, multi-file or scheduling. A live writer on Windows may prevent the read entirely; denial is correct. Physical negative and positive outcomes remain UNKNOWN until the original Operation/Stage/key, replayed immutable SQL and physical CAS plus independent current native evidence are jointly established under the Server lock ordering.

## Tests and acceptance

The isolated Go tests exercise no-file/no-creation, exact positive marker after Close, changed original session and target, cancellation, trailing bytes, no repeat Begin, POSIX world-readable marker and symlink swap. Tests are **not** production-installed proof. First merge #2245 after its own full exact-head CI and fresh clean state; reconstruct this child as a one-work commit on complete then-current master, run **its own** real Go Windows/Linux, PostgreSQL API Race, Desktop/Web, packages/rootless/Final Gate CI, and merge only after success. User-directed production-environment security acceptance remains **SKIPPED (NOT VERIFIED)**, not a development/PR/CI blocker.
