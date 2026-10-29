# Administrator v1 database-only recovery

The Administrator → System Maintenance → Server Backups view can run a separate
**database-only restore** for a complete legacy v1 snapshot whose Host inventory
explicitly records `file_data_included=false`. This is **not** the ordinary
full-backup restore action and is never offered for v2 or a full v1 generation.

## Behavior

1. The authenticated administrator selects the exact recognized v1 generation.
2. The UI displays the database/file consistency risk and requires typing
   `DATABASE ONLY RESTORE <snapshot-id>`.
3. Server, Agent, Desktop IPC and Host Control independently validate the
   allowlisted action, snapshot identity and confirmation text.
4. Host Control re-resolves the snapshot under the established maintenance and
   scheduled-backup locks, confirms its v1/database-only manifest and runs
   `xdrive-server backup verify`.
5. The existing Host restore path runs `xdrive-server restore SNAPSHOT --yes
   --database-only`, **without** `--no-safety-backup`. It creates the
   pre-restore safety backup, stops the appropriate services, restores the
   PostgreSQL database, preserves online file bytes, and performs its existing
   post-restore integrity verification.

A database-only restore can make PostgreSQL records disagree with the existing
file data (for example, references to objects created after the restored
database snapshot). It does not create the missing file bytes or automatically
resolve metadata inconsistencies. Even if the command reports success, the
operator must inspect deep storage integrity and application behavior. A
historical database-only restore record must **never** be presented as
evidence of complete file-and-database recovery.

## Explicit safety limits

- No arbitrary host paths, Docker flags, SQL text, or process commands are
  accepted from Web, Desktop, or DSM.
- A v2 snapshot, a full v1 snapshot, an incomplete/inconsistent v1 snapshot,
  a stale Host inventory, wrong confirmation, and an unsupported Host are
  rejected before queuing the operation.
- Destructive operations do not automatically retry after an interruption.
  Check the Host's retained operation log and pre-restore safety backup.
- No format migration, compression/Pack enablement, GC or cloud adapter.
- Production environment-only acceptance remains
  **按用户决定跳过（未验收）** if unavailable; this does not waive code
  validation, CI or source-level safety tests.
