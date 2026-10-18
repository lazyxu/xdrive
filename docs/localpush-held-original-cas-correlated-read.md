# L03-G0-c2c3b2b2 — held native original + historical CAS read-only correlation

**Scope:** A PRIVATE, unrouted owning-Agent observation. This phase combines
previously merged #2035/#2029 physical Stage→CAS/SQL evidence with #2037/#2046
real native CURRENT-file descriptor and prepared current-operation observation.

The Agent verifies a locally persisted Stage recovery hint for an exact
current Source/revision, Root, first-leaf path key, CURRENT snapshot SHA256,
file SHA256 and size (at most 64 MiB). The read-only CAS/SQL historical
receipt is fetched via the existing owning-device authenticated Go Client
**inside** the original native descriptor callback, after the first exact
`reserved` UUID/generation observation. The Agent then repeats the
`reserved` status check, checks the unchanged Stage hint and Source/Root/
account before the callback releases the descriptor. The native helper
rehashes that SAME descriptor and verifies CURRENT and Root again afterward.
The resulting observation and CAS receipt are unexported and JSON-redacted.

This does **not** establish Stage↔operation provenance. The Stage recovery
hint predates and does not carry the Server operation UUID/generation. The
historical CAS observation and latest Server operation are independent
snapshots, not one distributed transaction. CAS may be unpinned by the time
the native descriptor closes; the native file can change immediately after.
A-B-A and revocation/lease races remain. Never infer backup completion,
SourceRun, transferred bytes, safe cancellation, key/claim retirement,
Mirror deletion or authority to start a next generation.

**HARD NO-GO:** This PR adds no Server route, Agent IPC, Electron/Web control,
normal Router call, uploader, source activation, SourceRun or scheduler.
`local_folder` remains paused/Run denied; private Stage cap remains <=64 MiB.
Web/Mobile Web/PWA and other Desktop remain strictly observer-only; NAS Push
placeholder and Pull are unchanged.

**Validation:** native Linux/Windows fixture covers genuine strong Root,
CURRENT, the same fd double-hash, positive scoped callback ordering, JSON
redaction, missing/mismatched Stage, wrong or elevated CAS receipt, operation
expiry after CAS read, session change, mid-window bytes mutation, Root removal
and cancellation. The physical receipt transport is injected in these native
tests; no installed cross-process native-fd→PostgreSQL atomicity, 1k/10k/100k
or >=4 GiB E2E is claimed. The shared Desktop source contract prevents IPC
or renderer exposure.

**Next:** Bind the actual current operation UUID/generation and original
native-held content provenance to the canonical physical Stage/CAS/SQL writer
under server-held operation locks; then separately prove durable
commit-vs-cancel exclusion, crash recovery and safe credential retirement
before any production executor or Desktop Start/Cancel controls.
