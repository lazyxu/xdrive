# L03-G2b2a — Authenticated first-file physical CAS/SQL COMMIT over production HTTP

## Purpose and scope

The operator authorized implementation of a production-grade Local Push Runner. G1e, G2a and G2b1 are already merged. G2b2a connects a narrow, **real** authenticated Server physical/SQL first-file commit transport and a private Go Client, without making the device backup feature runnable from Web/Desktop controls.

Only one NEW 0–64 MiB file directly under an authorized `local_folder/push` Source's existing cloud target is supported. **Backup mode only**; the Source remains paused and has no active SourceRun. Mirror, NAS, directory traversal, overwrite, large-file chunking, background scheduling and whole-backup completion remain disabled. The Server must use a concrete `storage.Local` backend and rejects missing/unsupported persistence or incorrect stage/operation metadata.

## Transport and actual durable writes

`POST /api/v1/sources/:id/local-staging/:stageID/operation-first-leaf-commit` is registered behind `localPushOperationNoStore` and `requireLocalSourceExecutor()`. A valid request carries exactly the owning Agent's authenticated current owner JWT and registered unrevoked device token, exact Root ID/fingerprint, `If-Match` Source revision and a strict bounded JSON body: one normalized first-leaf name, the OS-private original 32-byte request key (canonical Base64URL), current Operation UUID and generation. No key or native leaf is placed in URL/query/log/response.

The handler performs a **read-only, held SQL transaction preflight** of the current live, non-aborted, non-terminal Operation and exact native Source/Root/Stage identity. The stage's saved immutable path hash MUST equal the Server-derived canonical first-leaf path. Only paused Backup mode is admitted. All remaining calls independently recheck their own transaction scopes and return an opaque denial on drift:

1. `quarantineBoundLocalPushCASPrepareIntent` — immutable Stage CAS quarantine for this candidate.
2. `prepareQuarantinedBoundLocalPushNewCAS` — physically materialize matching canonical CAS bytes under cooperative nonblocking OS shard leases.
3. `reserveBoundLocalPushQuota` — durable owner/Stage quota hold, physical contents rechecked under SQL/CAS locks.
4. `bindBoundLocalPushOperationStage` — exact key, UUID/generation, owner/Device/Root/Source/Stage and immutable database binding. This is the same implementation exposed by G2b1.
5. `commitBoundLocalPushFirstLeafWithCurrentOperation` — final same-Operation physical Stage/CAS pins plus Owner→Device→Source→Root→Operation→Stage/Node/CAS SQL locks, immutable `LocalPushFirstLeafOperationCommit`, ContentBlob, Node, File and **PENDING** SourceItem in one held PostgreSQL COMMIT. Existing first-leaf writer and its quota/replay/cancel fences remain the sole canonical mutation implementation.

Each step is idempotent within its documented identity scope. Failure after any precommit step leaves quarantine/staging/hold evidence for explicit recovery; it NEVER starts a new operation or claims that the data is backed up. An already committed Stage can only replay its exact original live key/UUID/generation. Aborted, revoked, expired, stale or mismatched operations cannot mint or complete another canonical first file. A lost SQL COMMIT HTTP acknowledgment is **ambiguous**: the owning Agent must use G1e's immutable exact-key historical read with fresh physical CAS and native-original checks, never invent a retry generation or remove the OS-private request key.

The bounded private reply carries NodeID/SourceItemID for correlation, `sql_committed=true`, `cas_observed=true`, `state=first_leaf_committed_pending_native_confirmation`. All safety completion flags remain false: `native_verified`, `backup_complete`, `authoritative`, `missing_inference_safe`, `retirement_supported`. SourceItem remains PENDING; **no SourceRun is created or finished**.

The `Client.CommitLocalPushFirstLeafWithOperation` method requires an owning Agent proof, a canonical exact Stage ID, request key, current UUID/generation and safe single relative leaf. It verifies status 201 (new) or 200 (same-key replay), strict ETag and private no-store, bounded allowlisted JSON and the required positive/negative flags. All fields on the Go return type are `json:"-"`; the private operation is never wired to Electron/Main/Preload, generic Source, Web, Mobile Web or a foreign Desktop.

## Tests and release discipline

- Genuine PostgreSQL/Gin test verifies authorization denials, path/key/generation/revision mismatch, no unauthorized SQL mutation, real physical CAS bytes, immutable SQL commit, original SourceItem PENDING and no SourceRun, and exact same-key replay without additional CAS refs.
- Linux/Windows native test creates an actual OS-approved strong Root and immutable CURRENT journal; streams a real original file into authenticated Gin Stage, then calls the new private client over HTTP **while the original native fd is still open and double-hashed after the network operation**. It starts from an unprepared Stage and proves the route's full physical CAS/SQL preparation sequence and replay; no in-process direct writer fixture is used for the final HTTP COMMIT.
- Client httptest denies forged/omitted response fields, mismatched identity, cacheability, misleading backup success, unsafe unknown JSON, status/ETag/size and cancelled contexts. Desktop static regression asserts no UI/foreign-device power and leaves legacy CI-only unkeyed writer gated as before.
- Exactly one independent work commit on the complete frozen master. Full source-exact 77+ GitHub CI with real PostgreSQL Go API Race, Go Linux/Windows, Web/Desktop, Rootless, images/packages, single-work commit and Final Gate must pass. Fresh GitHub clean state required before Rebase Merge; remove merged work branch.

## Remaining production Runner gates

This phase **materially performs one physical canonical file write** with authorized Agent credentials and original-key binding but is NOT a runnable, complete backup product. An HTTP request cannot independently attest the Agent's concurrently open local file descriptor; the Linux/Windows test demonstrates the **future Agent Driver's responsibility** rather than granting this Server endpoint magical OS attestation. G2b2b must wire `internal/localpushrunner.RunFirstLeaf` to actual Agent native-held secure Stage/operation/client/reconciliation transport, retaining the OS-private key and session throughout; G2c must resolve durable post-COMMIT cancellation, crash recovery, key retirement and SourceRun state. No automatic background scheduler, Mirror deletion, NAS Push or verified 100k/≥4GiB installed native acceptance is claimed.
