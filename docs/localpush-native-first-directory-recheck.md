# L03-F2d8c3b2l — Private first-directory native CURRENT verification

**Status:** bounded candidate, not an operational local Push feature. Parent #1879 L03-F2d8c3b2k completed exact-head 76-job CI and was rebase-merged as master `d401455603412cd863e18fbf2b4a88d7cd81a29c`.

## Why

The parent Server-only `commitBoundLocalPushFirstDirectory` can atomically create a direct-child cloud Node and pending SourceItem, but cannot prove the owning physical device actually observed the same local directory. A user-supplied name and a Root ID are not trusted native filesystem evidence.

## Scope

Add `localpush.RecheckLocalFirstDirectoryNative`, an **on-demand private read-only library precondition**. It requires a locally persisted approved OS RootGrant tied to the exact account/server/device/source/Root and strong native identity, source-revision-bound two-generation advisory evidence, a canonical single-component directory name, and a full integrity-verified CURRENT journal. Only one nonignored, strong, directory-kind native identity in <=500-record streaming batches may match. Independently inspect the real directory twice around rereading both sealed generations and Root grant. Canceled, weak, replaced, missing, symlink/reparse, tampered, rotated, foreign and ambiguous cases fail closed. This function does not authenticate a live Server device credential: a future owning Agent must do that before and after the read.

The returned observation has `json:"-"` for **every field**. `NativeObserved` may be true, while `BackupComplete`, `CommitSupported`, `Authoritative`, and `MissingInferenceSafe` are always false. This is not a native-handle-to-Server-SQL lifetime proof; a filesystem change can still occur after the observation. No HTTP route, Agent IPC, Renderer, Web/Mobile Web, scheduler, SourceRun, Node, SourceItem, CAS, FileVersion or Mirror-delete mutation is wired.

## Verification / next

Go Linux/Windows native tests exercise two complete generations and physical directories, persisted/missing grants, invalid claims, native replacement/symlink, stale generation, swapped Root and cancellation, including JSON privacy. CI must cover Windows/Linux Go API/race, Web/Desktop, images/artifacts, single-commit and final-gate on **this exact new HEAD**. Do not activate `local_folder` or call the Server first-directory writer based on this observation. A separate future phase must establish fully authenticated owning-Agent current-native-to-Server-SQL provenance and crash-safe recovery, then L05-L07 scheduler/Runner and installed-device 100k and >=4GiB E2E.
