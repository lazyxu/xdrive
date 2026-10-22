# G2c2d2b3c4d — pinned original Stage hint across owning-Agent recovery

## Current dependency state

The earlier #2319/#2327/#2332 and #2354/#2359/#2362 slices are merged. The owning Desktop currently performs one real original first-file (0–64 MiB, Backup-only) upload and a nonauthoritative original Operation SQL/CAS readback. The private Server physical-COMMIT SQL writer and terminal replay remain **UNROUTED**; the owning-Agent HMAC is correlation, NOT remote native lock attestation.

## Scoped implementation

- Verify the immutable OS-private Stage recovery hint by pathname **and the same opened inode**, bounded JSON payload and strict permissions. Recheck the original descriptor, pathname, file bytes, modification time and private parent directories before and after use.
- `WithHeldLocalOriginalRecoveryHint` holds that original descriptor through the *real* owning-Agent `Reconcile` HTTP/SQL/CAS readback, nested inside the current native-original read window and live Writer Claim if required. An identical-content replaced hint, in-place change, canceled callback, wrong device/Root or changed grant fails closed as an uncertain observation. The local disk reader and listing use the same pinned-validation logic.
- Add genuine Linux/Windows native tests for pinned callback, substitution and cancellation, plus an Agent source contract test to prevent future detachment before network. Do not enlarge public IPC or Web permissions.

## Safety boundary and remaining order

An OS-private Stage hint is not a remote physical Writer lock, a terminal, a retry ticket or a 2nd file admission. This change does **not** open `physical-COMMIT` on a production route, invent `physical-CANCEL`, change `SourceItem` to synced, start a `SourceRun`, retire a key/Stage/Writer, launch file #2 or activate watcher/cron. A privileged adversary capable of restoring file identity and timestamps, or concurrent in-place modifications, requires stronger OS/Agent trust; this check never claims independent hardware attestation.

Next: independently authenticated owning Agent-to-Server *same original Operation* terminal channel → transactionally pinned `physical-COMMIT` and exact lost-ACK replay → genuine physical cancellation/quiescence → safe retirement and file 2 → bounded multi-file Runner → SourceRun and auto-sync.

Production-environment-only security acceptance: **按用户决定跳过（未验收）**; non-production OS, Owner/Device/Root, SQL/CAS, Go Linux/Windows and source-exact CI are mandatory.
