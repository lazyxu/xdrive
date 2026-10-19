# L03-G2b1 · Owning-Agent Stage ↔ Operation immutable SQL binding transport

## Scope and purpose

This phase exposes the **existing** `bindBoundLocalPushOperationStage` PostgreSQL transaction to an authenticated owning Agent. The production HTTP route adds a real, permission-checked transport and the Go Client adds strict response verification. It is a prerequisite for a future production first-leaf physical CAS/SQL writer; it does not itself complete or start a backup.

`POST /api/v1/sources/:id/local-staging/:stageID/operation-bind` uses `localPushOperationNoStore` followed by `requireLocalSourceExecutor()`. Every request must have an authenticated owner session, the unrevoked enrolled owning Device credential, the exact bound Root ID/fingerprint and Source revision, and a still-valid paused Local Push Source and physical Stage. The maximum request body is 512 bytes. It contains only a canonical Base64URL 32-byte original request key, the exact Operation UUID and generation. All fields are checked again by the already-reviewed Server SQL transaction with the held operation/Stage/Source lock order.

The real PostgreSQL operation-Stage correlation is immutable. Same-identity replay is allowed without modifying the original bound timestamp; conflicting key, stage, generation, device, target, Source revision or missing migration denies the transaction. The original raw request key must never enter URL, logs or SQL plaintext; only its separately hashed digest is persisted.

The Server returns Source ID/revision, Stage/Operation IDs, generation and `state="bound"`. It MUST return all flags false: `commit_supported`, `backup_complete`, `authoritative`, `missing_inference_safe`, `retirement_supported`. It publishes **no Node, ContentBlob, SourceItem, SourceRun, FileVersion, active backup, Mirror deletion, local key retirement or canonical file bytes**.

The private `Client.BindLocalPushOperationStage` transports the exact original key only over the already authenticated Server connection. It validates UUIDs, key nonzeroness, `If-Match`, `ETag`, `Cache-Control: private, no-store`, a 1024-byte bounded JSON response, complete allowlisted body with no unknown or trailing fields, and every false authority flag. Private return data uses `json:"-"` fields to avoid accidental Renderer or Web exposure.

## Validation

A PostgreSQL-backed Gin integration covers an existing authentically staged candidate and current keyed Operation, SQL binding and byte-stage preservation; repeat requests must be idempotent, unauthorized/foreign device, missing proof, stale revision, malicious query/body, unsupported media type and wrong Operation are denied. Verify no new Node, SourceItem or SourceRun. Client httptest covers authenticated request headers, wrong response status/ETag/cacheability/identity, true authority flags, extra/oversized/trailing JSON and cancellation. All tests must pass this commit's entire source-exact GitHub CI (real PostgreSQL API Go Race, Linux/Windows Go/Web/Desktop, rootless, packages/images, one-commit Final Gate), plus current GitHub clean, before merge.

## Remaining production gates

This G2b1 route is **SQL binding only**, not the G2b2 native-held production write driver. The existing first-leaf CAS/SQL writer remains unexposed. G2b2 must separately prove owning native file liveness and a real physical write authorization for the exact Stage/Operation; G2c must handle lost reply after COMMIT, durable cancellation/exclusion and native request-key retirement. Production SourceRun execution, automatic schedule, multiple files, >64 MiB chunks, NAS Push, Mirror deletion, Windows/Linux 100k and ≥4 GiB E2E remain unavailable until their own release gates are met.
