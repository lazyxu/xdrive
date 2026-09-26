# Bidirectional Sync Contract

This document defines the synchronization behaviors that xDrive must preserve between the Web/API surface and native clients.

## Required invariants

- The server is the source of truth for node identity, parentage, revision and current content.
- Rename and move preserve node IDs. They must not be implemented as delete-and-recreate.
- Deleted nodes disappear from the active namespace and enter trash according to the server lifecycle.
- Restore preserves node identity and advances revision.
- Historical version restore preserves node identity and advances revision.
- Stale writes and stale deletes must fail with a revision conflict instead of silently overwriting newer data.
- Directory moves preserve descendant identity and parent relationships.
- Empty files and truncate-to-zero are valid synchronized states.
- A completed resumable upload must create exactly one final file.
- Selective-sync exclusions are intentional visibility differences, not convergence failures.

## Continuous CI coverage

| Layer | Direction | Scenario | Primary test |
| --- | --- | --- | --- |
| Real Server + PostgreSQL + LocalStore | Web -> Client | create file/directory, content read | `TestBidirectionalSyncWebToClientLifecycle` |
| Real Server + PostgreSQL + LocalStore | Web -> Client | overwrite, rename+move, delete, trash restore, version restore | `TestBidirectionalSyncWebToClientLifecycle` |
| Real Server + PostgreSQL + LocalStore | Client -> Web | create file/directory, empty file, overwrite, rename+move | `TestBidirectionalSyncClientToWebLifecycle` |
| Real Server + PostgreSQL + LocalStore | Client -> Web | directory-tree move, delete, trash restore, version restore | `TestBidirectionalSyncClientToWebLifecycle` |
| Real Server + PostgreSQL + LocalStore | Both | stale write/delete conflict protection | `TestBidirectionalSyncRevisionConflictsDoNotLoseData` |
| Real Server + PostgreSQL + LocalStore | Client A <-> Client B | create, overwrite, Web rename, delete/trash propagation | `TestBidirectionalSyncTwoClientsConvergeThroughServer` |
| Real Server + PostgreSQL + LocalStore | Client -> Web | Unicode/space names, case-only rename, rapid create/rename/delete | `TestBidirectionalSyncRapidUnicodeAndCaseOnlyOperations` |
| Windows CfAPI | Web -> Client filesystem | create, empty file, overwrite, file rename+move, file delete | `TestWindowsCfAPIE2E` |
| Windows CfAPI | Web -> Client filesystem | directory-tree create, move/rename and delete | `TestWindowsCfAPIE2E` |
| Windows CfAPI | Client filesystem -> Web | create, rename, move, delete, empty file, truncate-to-zero | `TestWindowsCfAPIE2E` |
| Windows CfAPI | Client filesystem -> Web | directory-tree upload/rename/move/delete | `TestWindowsCfAPIE2E` |
| Windows CfAPI | Client filesystem -> Web | resumable large-file upload | `TestWindowsCfAPIE2E` |
| Windows CfAPI | Both | deterministic concurrent-write conflict copy and server winner restoration | `TestWindowsCfAPIE2E` |
| Windows CfAPI | Policy | exclude, always-local, pin/dehydrate and cache policy | `TestWindowsCfAPISelectiveSyncAndCachePolicy` |
| Linux FUSE operation layer | Web -> Client | newly created file lookup, content refresh, rename visibility | `TestLinuxFUSEBidirectionalMutationContract` |
| Linux FUSE operation layer | Client -> Web | rename+move, content write/truncate, unlink | `TestLinuxFUSEBidirectionalMutationContract` |
| Shared resumable-upload client | Client -> Server | interrupted multi-chunk call, new Client instance resumes received chunks and finalizes once | `TestUploadFileResumableResumesAfterInterruptedCallAndClientRestart` |
| Windows CfAPI | Restart / offline | persisted baseline resumes local-only offline edits after provider restart | `TestWindowsCfAPIRestartAndOfflineConflict` |
| Windows CfAPI | Restart / conflict | local offline edit + Web edit converges to server winner plus conflict copy after restart | `TestWindowsCfAPIRestartAndOfflineConflict` |
| Windows state | Persistence | baseline round-trip, policy filtering and corrupt-state rejection | `TestWindowsBaselineStateRoundTripAndPolicyFilter` / `TestWindowsBaselineStateRejectsCorruption` |

The Windows CI E2E gate runs every test whose name begins with `TestWindowsCfAPI`, so both the general bidirectional E2E and selective-sync/cache-policy E2E are required for every PR.

Linux CI does not require a privileged FUSE mount. Instead, the Linux contract exercises the same `linuxNode` / `linuxHandle` operations that back FUSE callbacks against a mutable HTTP server. This keeps Linux CI portable while still verifying Web-visible and client-visible mutation semantics.

## Scenarios kept as separate subsystem tests

The following behaviors are intentionally verified by their dedicated test suites rather than duplicated in every sync contract:

- upload-session chunk hashing, resume and finalize semantics;
- optimistic revision / `If-Match` enforcement;
- file-version retention and restore mechanics;
- trash permanent deletion and CAS reference release;
- transfer retry bookkeeping;
- controller reconnect/repair status transitions;
- storage policy normalization and cache accounting.

## Future expansion

When CI infrastructure permits, add:

1. a privileged Linux FUSE mount E2E using real filesystem syscalls;
2. a full Windows filesystem E2E that kills the provider during an actively transferring chunk (the shared upload client already verifies cross-process resume);
3. a 1,000-file / 100-directory convergence workload in normal CI and a larger nightly workload;
4. multi-device concurrent rename/move conflict scenarios.
