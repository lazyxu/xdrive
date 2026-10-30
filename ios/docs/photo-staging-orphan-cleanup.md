# iOS PhotoKit original staging: conservative orphan cleanup

This is an independent stacked Draft PR on #3243. It does not modify
#3243 while its exact-head IPA and full CI execute.

## Failure and ownership boundary

PhotoKit still, video and Live Motion originals are temporarily exported to
`temporaryDirectory/xdrive-photo-export-<UUID>` before the existing
Owner/Root-verified UploadSession/CAS writer runs. Normal completion and
handled cancellation delete the staging folder. **Force-quit, OS process kill
or crash before the defer/catch may leave large original bytes on the phone.**
These files are private temporary cache and never authoritative cloud receipts.

## Recovery

A new, explicitly authorized native stage performs at most **16**
best-effort cleanup removals. The remover accepts **only** canonical
`xdrive-photo-export-<UUID>` directory basenames with a modification age
older than **48 hours**. It rejects symlinks, foreign/invalid names,
unreadable metadata, nested directories, unknown files and any folder that
contains something other than exporter-generated `resource-0`,
`resource-1` or `original-live-pair.zip`. A newer or active export
cannot be deleted by an ordinary scan pass. Actual lock-screen and
FileProtection behavior are left unchanged.

No encrypted V1/V2 journal, persisted Device grant, PWA cookie, PhotoAsset
metadata, CAS Node, source file, server settings or user-selected file path
is ever touched. Failure to enumerate or remove private temp directories
does **not** make an original upload count as failed/successful: the normal
SHA/session/Owner receipt path remains authoritative.

## Validation

The helper is a standalone Foundation-only Swift unit whose executable
fixture creates old UUID-owned still/Live folders, a recent active folder,
a foreign prefix, an invalid UUID, an unknown child and a symlink.
The fixture passed locally under Swift 5. A Node source contract confirms
the bounded ownership and that cleanup is invoked before a new exporter
staging directory is created.

This is not a measured disk-space gain, a promise that iOS always wakes
for cleanup, or an automatic operation without a user-authorized Photos
backup request. Exact stacked-head iPhoneOS IPA and full CI remain to be
run after #3243. Physical iPhone/SideStore/storage-pressure acceptance:
**跳过（未验收）**.
