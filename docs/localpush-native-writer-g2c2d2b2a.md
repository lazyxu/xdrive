# L03-G2c2d2b2a — private one-shot native writer claim (foundation only)

## State and scope

This change adds a Go-local reusable native writer claim primitive for Linux and Windows. It is deliberately **not yet wired into the existing owning-Desktop first-file upload**, which remains enabled from merged #2212 and is separately made Agent-process-owned by merged #2229. No Web, foreign-Desktop, NAS, scheduler or generic Source mutation entry point is added.

The private claim is a stable, hashed Server/account/device/Source slot (excluding mutable Root/session/target/revision), exclusively created with O_EXCL and flushed to disk. The holder additionally keeps an OS kernel exclusive, nonblocking file lock (Linux flock, Windows LockFileEx) during a future owning-Agent native write window. Only a derived SHA-256 of the exact immutable Source/Root/native-content scope enters the private marker, not a bearer token, original absolute path, request key or OS native identifier. Private directories reject symlinks and on Linux require mode 0700; the backup Root cannot overlap the Agent config directory.

Creating the marker is a **fail-closed, one-shot quarantine**. A second process, repeated invocation, altered Root/session/revision/target or a restart cannot mint a replacement writer from the same Source slot. Every error after O_EXCL leaves the marker in place, including cancellation, disk failure or a crash. On POSIX the claim and directory are fsynced; on Windows the file is flushed, without asserting a complete power-loss durability guarantee. Close releases the held kernel lock **but never unlinks the marker**.

## Not a physical terminal

Kernel-lock release after process exit says nothing about remote HTTP completion or PostgreSQL/CAS COMMIT. In particular, this primitive is NOT evidence for physical-CANCEL-quiesced, permission to delete Stage or original request keys, file-level idempotent restart, another generation, backup_complete, automatic retry or physical mirror deletion. The stage-admission and original request-key O_EXCL fences in merged master remain authoritative in the currently enabled first-file path.

## Verification / next increment

A standalone isolated Linux Go test executed before PR creation (four tests passed): live second-descriptor lock denial, persistent reuse denial after Close, mutable-identity slot invariance, invalid overlapping Root/cancel refusal and absence of JSON identity leakage. This is local-package evidence only, not xDrive CI/installed-device proof. GitHub exact-head Linux/Windows builds and full CI are required separately.

With #2229 merged, a **separate reviewed integration** must pass the authenticated current owning device+Root+Source/Revision+original native strong identity into NewScope and Begin immediately before the real first-file Runner, hold the claim through bounded SQL/CAS/native reconciliation and Close on every result without ever removing the claim. Then G2c2d2b2 further needs crash-recoverable native writer quiescence proof and B3 needs authenticated SQL+CAS+native terminal replay before any physical CANCEL or key/Stage retirement. Do not accept installed production security approval as an assistant task or code/PR/CI gate.


## Windows exclusive lock CI regression correction (2026-10-20)

The exact-head full CI #39421383246 failed the Windows native writer unit test. An exclusive `LockFileEx` prevents a second file handle from reading its locked byte range, whereas the original Linux test attempted the read while the first writer still held the lock. The regression now checks competing-lock denial while the claim is held, releases the original claim, reads and verifies the permanent quarantine marker, and re-acquires only the released kernel lock. Fatal assertions have cleanup hooks to prevent an active lock from blocking Windows temporary directory deletion. No native lock or source authorization is relaxed. This is not proof of physical CANCEL or a completed backup. Full new exact-head Go Windows/Linux, PostgreSQL Race and Final Gate remain required.
