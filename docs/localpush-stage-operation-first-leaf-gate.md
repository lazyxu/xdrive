# L03-G0-c2c3b4 — mandatory immutable Stage/Operation binding for private first-file writer

The prior c2c3b3 phase records immutable, non-authoritative SQL provenance
between the current operation UUID/generation and one ready first-file Stage.

This phase modifies ONLY the existing UNROUTED operation-aware physical
Stage/CAS/Node/SourceItem SQL prototype. After its current owning-device
operation transaction fence and held Stage lock, but BEFORE CAS/hash/Node
locks, it requires the matching immutable Stage/Operation binding. Inside
the same transaction and while physical CAS and Stage pins remain held, it
rechecks the current operation and the immutable binding again immediately
before SQL COMMIT. Exact same-key replay with the original Stage and
generation may return the same canonical identity; missing migration,
unbound Stage, mismatched operation/key/session/Root/Source revision/target,
drifted CURRENT or content digest, disabled/revoked/expired/aborted operation,
and canceled Context deny without canonical metadata. The older CI-only
non-operation writer is unchanged so its historical coverage remains.

A bound SQL Stage and an operation record do **not** attest native OS file
descriptor continuity or end-to-end byte transfer. This phase does not
create a new Server route, Client API, Agent IPC, Electron/Main/Renderer/Web
control, SourceRun, scanner scheduler or real Push execution. The original
Stage data remains <=64MiB, `local_folder` remains paused and Run hard
denied, Web/Mobile Web/PWA/foreign Desktop remain observer-only, NAS Push
stays unsupported, and Pull is unchanged. No local request-key retirement,
physical abort/cancel completion, Mirror deletion or backup-complete state.

Tests include the real PostgreSQL/current-operation CAS/SQL fixture,
exact-replay, Linux/Windows original Stage path, and independent negatives
for missing row/table, changed operation/session/digest/Root/CURRENT, as
well as the preexisting foreign/revoked/expired/aborted/terminal cases.
The Desktop source contract blocks Renderer/IPC exposure of the private
operation-to-Stage gate. Physical installed Windows/Linux 100k / >=4 GiB
and real network-to-SourceRun acceptance remain future requirements.

Next: Native-held original-file provenance and operation admission must be
linked to the real writer across the Agent/Server boundary. Independently
establish durable commit-versus-cancel exclusion and crash-safe key/claim
retirement before enabling scheduled/manual Push.
