# G2c2d2b3a · Original OS Writer Claim held read-only observation

## Existing capability

Own Windows/Linux Desktop already runs a real one-shot Backup-only first <=64MiB file through owning Agent Stage -> CAS/SQL (#2212). Native O_EXCL Writer quarantines a second run; #2245 tests real process death and #2250 reads the same original marker. #2257 adds read-only current Agent job status. **None of these prove remote HTTP/SQL physical CANCEL, terminal replay, or safe new Stage/key issuance.**

## This increment

Add **internal-only** localpushwriter.WithHeldOriginalWriterObservation(ctx, originalScope, inspect), which refuses a missing/changed/corrupt/public/symlink original marker and acquires a NONBLOCKING OS-native lock on the *existing* O_EXCL file before invoking a private read-only callback. Revalidate exact marker content, path inode, safe private parents and context both before and after callback, while the same OS descriptor remains locked. The callback's errors are redacted and all locks/handles released; never create/delete/replace a marker, Root, key, Stage, or SQL row.

Tests distinguish a live owning Writer (locked => callback never runs) from a closed/crashed writer (lock may be acquired). A true Windows/Linux killed subprocess proves the latter while the O_EXCL marker stays permanently quarantined and Begin remains denied. POSIX symlink/perms, altered original scope, cancellation, nil callback, malformed marker and no-file/no-creation fail closed.

## Explicit negative conclusion

**Kernel-lock availability is local process evidence only**, not proof of remote HTTP writer quiescence, remote physical cancellation, canonical SQL/CAS COMMIT, durable file terminal, stage expiration, safe request-key retirement, or permissions to create another generation. No Server/client/Agent production call site is added and no UI, Web/foreign Desktop, scheduler, SourceRun or upload authority is expanded.

Next B3 phase must combine this exclusive original native window with authenticated *original Operation ID + generation + Stage + key* under retained Server Owner/Device/Root/Source/Operation SQL locks and independently reverified physical CAS and native content. Physical commit vs cancel remains fail-closed until truly durable evidence exists.

## Merge and verification

Independent Draft PR with ONE work commit on complete master, full source-exact CI including Linux/Windows Go/real PostgreSQL Race/Web/Desktop/Rootless/images/installers/final-gate and fresh clean mergeability. Existing manually initiated first-file production path must remain unchanged. Production-only security acceptance is **按用户决定跳过（未验收）** by user decision; code-level authorization/native/SQL/CAS tests are mandatory.
