# Local Push native Writer Claim — actual process crash quarantine regression (G2c2d2b2)

## Prerequisites and real capability

This is an independently reviewed **test-only** increment stacked on #2241, after merged #2238. The user-approved **manual owning Windows/Linux Desktop Backup-only first-file <=64MiB real Stage → CAS/SQL** remains enabled. The Agent holds the immutable O_EXCL claim and live OS lock during the real single-file Runner; the UI still reports `backup_complete=false` and `retirement_safe=false`.

## Real OS-process regression

`internal/localpushwriter/writer_process_crash_test.go` launches the platform's actual compiled Go test executable as a separate process; the child creates an authentic Agent-private O_EXCL native Writer marker and holds the Linux `flock` or Windows `LockFileEx` lock. The parent verifies the competing OS descriptor cannot lock it and a second `Begin` fails.

The parent then forcibly terminates the original process **without `Claim.Close`**. It verifies the kernel lock is released, the exact hashed claim marker still exists and contains no original private identity, and **another `Begin` is still denied**. No tests delete the marker, mint a second key, or simulate fabricated physical SQL terminal rows.

## What is NOT proven

A released native lock only indicates that the local locking process ended. It does **not** establish remote HTTP/server writer quiescence, absence of SQL COMMIT, physical CANCEL, recovery safety, lost-ACK replay, authority to retire original Stage/request-key, a complete backup, or safe multi-file/scheduled runs. All ambiguous states remain quarantined. Later independently reviewed native+SQL/CAS terminal proof is mandatory before any retry or retirement.

## Gate

The parent #2241 must pass its complete exact-head CI, be clean and Rebase-Merge first. Rebuild this one-work child against complete then-current master, then run independent actual Linux/Windows native Go tests, authentic PostgreSQL API Race, Web/Desktop, images/rootless/installers, single-commit and Final Gate on its own exact head. This is a source-level cross-process test, **not** evidence from an installed production Agent/Server. Production-environment security acceptance is permanently **SKIPPED BY USER (NOT VERIFIED)** and is never requested or used as a code, PR or CI merge blocker.
