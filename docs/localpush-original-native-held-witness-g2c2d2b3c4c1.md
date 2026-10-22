# G2c2d2b3c4c1 — owning Agent-held original native witness foundation

Already merged: #2332 proves the same original owning native Writer Claim and
strongly identified native file descriptor can stay held throughout the
first-file authenticated HTTP CAS/SQL callback; #2354/#2359 provide only
PRIVATE, UNROUTED Server SQL/CAS terminal INSERT and readback primitives.

This scoped step changes the existing real first-file Agent Commit to compute
a **private HMAC-SHA256 correlation digest** inside both held OS windows. The
HMAC binds the original OS SecretStore operation request key to exact
Owner/Device/Root/session/Source revision/target, Stage, Operation UUID and
generation, original native inode-derived key, snapshot, path and content.
A changed key, operation, generation, Stage, file, Root or login produces a
different digest or a fail-closed error. The original staged bytes and owning
Desktop Backup-only first-file semantics are unchanged. Tests verify the
correlation, input denial and JSON/IPC privacy; existing Linux/Windows OS
live-lock tests remain prerequisites.

IMPORTANT: A matching HMAC does **not** independently prove a remote OS kernel
lock or trusted native file descriptor. Whoever possesses the original secret
could recompute it. This is *Agent-only proof-source preparation*, not a
production authenticated native-to-Server terminal. No HTTP handler, Client
transport, Renderer/Web/IPC or SourceRun receives it. Never convert a
caller-supplied digest or held boolean directly into the private Server
`originalClaimHeld` flag. The next separately reviewed work must bind genuine
live Agent producer to exact device-authenticated original-operation
SQL/CAS-pinned Server mutation, lost-ACK readback and crash recovery, then
physical-CANCEL quiescence. No Stage/key/Writer retirement or second file is
safe yet.

All code security/Go Windows/Linux/PostgreSQL/Web/Desktop/Final Gate CI applies.
Inaccessible production security acceptance is **按用户决定跳过（未验收）**,
not a source-development or merge gate.
