# L03-F2d8c3b2t — pinned OS-handle native identity parity

**State:** purely private, read-only Local Push provenance strengthening; prerequisite #1919 completed 76-job exact-head CI and Ready/Rebase merge. Does **not** turn on user-visible local-folder backup.

## Design and implementation

- The previous L03-F2d8c3b2s held a directory handle through CURRENT journal and path checks, but its native birth/volume/inode identity was still read by reopening a **path**. That is a separate raceable OS read.
- Add an internal, non-serializable native digest read **from the already-open pinned directory fd/handle**, with the existing inventory SHA256 key domain. Linux uses fd-relative `statx(AT_EMPTY_PATH)` and requires strong birth time + matching directory/inode; Windows uses `GetFileInformationByHandle` for the *same* open handle, requiring a real directory and rejecting reparse points. Other platforms fail closed.
- Validate the pinned strong native identity against the previously sealed two-generation inventory, **both** independent path identity reads, and a final handle identity read. Any mismatch denies the observation and returns no private file details.
- Extend native Linux/Windows test to compare the pinned handle identity with the existing inventory key and reject a closed handle or invalid Root. Add Desktop source contract verifying this remains local, not REST/IPC/Renderer/Web.

## Explicit NO-GO

Only a point-in-time LOCAL identity witness is established: the OS handle is closed before any Server challenge consumption or SQL transaction. An original directory might still be replaced after release, and temporary A-B-A substitutions, physical power loss, a stolen device credential and cross-process/Server/SQL authority are not addressed. Neither this witness nor the previously consumed one-use challenge authorizes a pending directory writer. Production `local_folder` Runner, manual Start/Cancel, scheduler, recursive backups, FileVersion/SourceRun completion, Mirror deletion, >=4GiB or real 100k installed Desktop E2E remain blocked. Stage <=64MiB and foreign Desktop/Web/Mobile Web read-only boundaries are unchanged.

## Validation gate and next step

One scoped work commit on frozen accepted master, exact-head full GitHub Go/Linux/API real PostgreSQL Race, Go Windows, Web/Desktop, image/artifact, single-commit and final-gate required before Ready/Rebase merge. No local Go 1.25 clone, physical Linux/Windows installed test, or GitLab run claimed. After green gate, verify remote work branch cleanup; next independent stage must define a genuinely fail-closed native/Server transaction protocol with durable recovery, not reuse an ephemeral identity as commit authority.
