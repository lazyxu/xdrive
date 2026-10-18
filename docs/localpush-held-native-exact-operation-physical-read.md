# L03-G0-c2c3b9 — Held CURRENT native original across exact historical SQL/CAS read

**Prerequisite:** L03-G0-c2c3b8 #2081 exact owning-Agent device/Root-protected
read-only HTTP/Go Client transport is merged, with full exact-head CI and
branch cleanup verified.

The prior private owning-Agent read checkpoint held a genuine Windows/Linux
original native descriptor, but correlated it only with the latest *reserved*
operation or a generic Stage CAS receipt. The new c2c3b8 Server read instead
requires the ORIGINAL OS-private 32-byte key and immutable UUID/generation
with the exact Stage/SQL COMMIT row and physically pinned CAS. These pieces
must be observed together without inventing an upload or a key-retirement
authority.

## Implementation

This phase adds a NEW **UNROUTED owning-Agent read-only** operation
`inspectLocalBoundBackupHeldHistoricalOperationPhysical`. It loads the
owner's current Server/account/Agent Source and real enrolled device Root;
loads the OS-private persisted Stage recovery hint; derives the true
single-leaf CURRENT path and exact committed snapshot/content SHA256 and size.
It then calls `WithHeldCurrentOriginalReadCheckpoint` to securely open
the genuinely original strong-identity file descriptor, rehash before and
after the remote read and verify CURRENT journal/Root provenance.

Inside that SAME still-open original descriptor, the Agent loads the
original OS-private request key and MAC-bound saved prepared Operation
UUID/generation, calls the c2c3b8 read-only HTTP endpoint, checks exact
Stage/Source/revision/UUID/generation/PENDING node identities and every
non-authoritative flag, then revalidates Source, Root, Session, saved request
key, prepared receipt and local Stage hint. Unlike an admission check,
**historical COMMIT recovery does NOT demand that the old 30-second operation
remain reserved**. Its status may have expired after a real SQL commit.

The returned native and Server observations are unexported JSON-redacted
Go structures. Tests exercise a real Linux/Windows strong-identity
CURRENT fixture, exact local original key forwarding and callback ordering,
JSON redaction, and fail-closed missing Stage, foreign reply, elevated
flags, Source/Session switch, Root revocation, canceled request and
same-size original mutation. The Desktop/Router source contract excludes
all new methods from Agent IPC, Renderer and Web.

## Hard NO-GO

Even simultaneous native-fd and pinned Server-CAS observations are **not a
distributed atomic write/abort lease**. OS file handles cannot be sent
as Server transaction locks. After both pins release, the original may
change and the CAS may be collected. A-B-A mutation, Server SQL COMMIT
reply loss and cancellation races remain. This observation is NOT
backup-complete, SourceRun, physical cancel proof, OS key/claim retirement,
permission to create another generation or Mirror deletion evidence.

No new HTTP route, Server writer, Agent IPC, Electron/Web controls,
SourceRun, scheduled/manual Runner, automatic retry, local_folder activation
or NAS Push management. Pull unchanged. Private Stage <=64MiB,
Web/Mobile/PWA and other Desktops strictly read-only. No native installed
Windows/Linux 1k/10k/100k >=4GiB end-to-end backup or GitLab claim.

Next requires a separately reviewed durable, cross-process
commit-versus-cancel/lease protocol and verified physical recovery before
running a real backup job or retiring any original key.
