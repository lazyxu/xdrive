# Local Push v2 · original native descriptor into the shared upload engine

Parent: #2419 persists the original per-file Plan before HTTP. This incremental child introduces an **Agent-private, still unactivated** Linux/Windows stream bridge. It is not a new CAS writer, physical cancellation protocol, SourceRun or production multi-file Runner.

## Contract

- Accept only the original Plan recovered from its private O_EXCL journal; validate Device/Root/Source/target and CURRENT Inventory again. A newly supplied Operation UUID is rejected before any HTTP.
- Open the top-level regular original through the existing OS-native Root-scoped opener (openat2 + RESOLVE_BENEATH/no symlinks on Linux; native handle + reparse-point validation on Windows). Hold **the same descriptor** during the entire ordinary bound upload.
- SHA-256 hash the **held descriptor** before HTTP; validate persisted Root/current Inventory, path-to-descriptor identity, strong single-link native key, size and mtime. Recheck and rehash directly before the first byte after the admit/bind network round trips.
- Pass a single controlled offset reader, not a renderer path or generic filesystem opener, into the already-merged localpushcommon.UploadDurableOne. The existing ordinary UploadSession -> chunks -> CAS/Node/FileVersion/Finalize is the only byte writer. The ordinary uploader's Close does not prematurely close our held native descriptor.
- Recheck the exact same descriptor's full content hash, path identity, Root and CURRENT Inventory after the immutable original SQL receipt has been reconciled. If local bytes or the current scope drift, return UNCERTAIN even if Server already committed. Never recreate an Operation or infer physical cancellation.
- This first native stream is intentionally limited to an existing persisted top-level file <=64 MiB. Tests are a controllable fake durable transport plus real OS filesystem/native handle. **Actual HTTP/PostgreSQL/CAS process E2E is still a separate required step.**

## Explicit exclusions and next dependency

This source is not invoked by Desktop/IPC or automatic workers. It cannot retire source-wide legacy Stage/SecretStore/Writer markers, lift the existing Server legacy quarantine, authorize a second file, claim backup_complete/current_cas_verified/retirement_safe or infer Mirror deletions. The next PR must connect this helper to the real owning Agent only after a fully authorized private Source+target decision and legacy quarantine, and exercise it against genuine HTTP/PostgreSQL/CAS on Linux and Windows. A committed SQL result may be read remotely by the transport without native reopen; this stricter native helper currently requires a still-readable local original and thus must not be the only restart-reconciliation route.

Test requirements: exact-head Linux/Windows Go + race, PostgreSQL API Race, full Web/Desktop/artifact CI and Final Gate. Keep the complete cumulative AGENTS and other owners' work. Production-only inaccessible safety acceptance stays **按用户决定跳过（未验收）** and never blocks source/CI/merges. Code-level Owner/Device/Root/native/SQL/CAS negative tests remain mandatory.

## Owning Agent private integration (still unrouted)

The owning Agent additionally has an unexported uploadLocalCommonFirstLeafPrivate entry in cmd/xdrive-agent. It uses its already registered device secret and native bound Root, applies the current own-device Backup-only Source/rules, fails closed if any old native Stage/operation-key/Writer marker or legacy stage directory survives, selects only one top-level strong eligible file from a fully verified inventory, then persists that file's original Plan and invokes UploadVerifiedCommonNativeOne with the genuine *client.Client* and Device/Root proof. A session change after the remote call returns UNCERTAIN.

This is source-level Agent composition, **not a Desktop control path**: the method has no IPC handler, no scheduled worker or direct UI call. The Server still independently denies any old SQL claims and any wrong Owner/Device/Root/revision. No remote write can be enabled by merely changing a UI flag. Next: genuine HTTP+PG/CAS native E2E and exact method-specific authorization/fault tests, followed by a separately reviewed owning-only activation.

## Genuine native-to-HTTP/PostgreSQL/CAS regression (CI candidate)

The `internal/api/local_push_common_native_http_e2e_integration_test.go` regression uses the package's isolated PostgreSQL schema fixture plus actual LocalCAS storage, a real original Linux/Windows Root native Inventory journal, a real owner JWT and enrolled Device/Root proof, and an actual Gin HTTP router. A thin HTTP test proxy counts operations and, in the negative variant, permits the original Finalize to commit while suppressing **all** successful Finalize ACKs. The Go Client must read the immutable original Operation receipt instead of trusting a retry's generic Session projection. The test directly checks physical CAS bytes, immutable SHA-256/size, one Node and Operation, no duplicate upload/bind on replay and no new FileVersion.

**Evidence limit:** This is new test source to be run by accurate-head CI; its existence does not mean the test has passed. No real Agent subprocess kill, installed Desktop, SourceRun, Windows power-loss fsync proof, file B or production safety acceptance is claimed. The next review must independently validate native test compilation on both platforms and genuine PostgreSQL/CAS execution before activating any owning-agent IPC.
