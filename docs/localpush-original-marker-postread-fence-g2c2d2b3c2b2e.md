# G2c2d2b3c2b2e — original Writer marker post-read identity fence

The real owning Windows/Linux Desktop Backup-only one-shot first-file upload (<=64 MiB, #2212) stays enabled in source. This is a private read-only recovery hardening slice, independent from Agent restart status #2315 and without any new upload privilege.

The existing OS-private Writer recovery reader previously verified the original marker inode at open time, then read the expected marker bytes. It now **also** Lstats the exact original claim pathname and stats the still-open descriptor **after** reading, requiring the same file identity, regular type, expected size, POSIX private mode and valid private parents. A different inode containing byte-for-byte identical marker text is rejected. No marker, Stage, request key, SQL/CAS row or SourceRun is created or retired by this reader.

A native Linux test holds the genuine original marker open while replacing its pathname with a new same-content inode and verifies rejection; it also covers missing-path rejection and preservation of original marker bytes. The Windows branch compiles the invariant, but an open-handle rename fixture is skipped when not portable; platform-specific reparse and installed Windows checks remain unverified.

**Not solved:** this instantaneous recheck is NOT proof of remote HTTP/SQL quiescence, a terminal physical COMMIT/CANCEL, authorization to retry, automatic backup, second file, per-file SourceRun, Stage/key retirement or completed backup. Same-user adversarial filesystem changes after this check remain out of scope and must never be elevated to durable terminal authority.

This Draft PR requires its own exact-head Linux/Windows Go, real PostgreSQL API Race, Desktop/Web and build artifact CI with Final Gate before any merge. Production environment security acceptance: **按用户决定跳过（未验收）**, not a code/CI/PR blocker. Source security checks remain required.
