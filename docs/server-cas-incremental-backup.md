# Local CAS + Manifest incremental backups (format v2, opt-in MVP)

This is the local-only backup format for xDrive's immutable, whole-file SHA-256
content-addressed storage. It does **not** introduce S3, a paid service,
consumer cloud credentials, a second chunking algorithm, or a dependency
on restic, Python or rsync.

## Run

```bash
xdrive-server backup --incremental
xdrive-server backup list
xdrive-server backup verify "$HOME/.xd/backups/incremental/snapshots/xdrive-backup-YYYYMMDDTHHMMSSZ"
xdrive-server restore "$HOME/.xd/backups/incremental/snapshots/xdrive-backup-YYYYMMDDTHHMMSSZ" --yes
```

The first command explicitly opts in for one v2 backup. Default manual,
scheduled, pre-upgrade and pre-restore backups remain v1 `blobs.tar`. To
explicitly use **v2 for scheduled backups only**, add to
`$HOME/.xd/config/.env` (or the active `XD_CONFIG_DIR/config/.env`):

```env
XD_BACKUP_SCHEDULE_FORMAT=v2
# Optional: if manual v2 backups use a different local repository
XD_BACKUP_SCHEDULE_REPOSITORY_DIR=/absolute/local/repository
```

Omit the repository option to reuse `$HOME/.xd/backups/incremental`. The
existing cron schedule runs the same `server-backup-scheduled.sh` wrapper; it
selects `xdrive-server backup --incremental` on the next execution. Switching
back to v1 is done by removing the setting or setting it to `v1`.

**Safety:** v2 scheduled backup never applies `XD_BACKUP_RETENTION_DAYS` or
automatically deletes v2 snapshots, shared CAS objects, or historical v1
snapshots. Retention stays enabled only while scheduled backup format is v1.
Manual `backup --incremental`, pre-upgrade safety backups, and restore logic
are unchanged. A reference-aware v2 GC is still a separate future feature.

Use `--repository-dir ABSOLUTE_PATH` for a manual v2 backup on a separate
disk; the absolute path must not point into the live files mount. Do not
combine `--incremental` with `--output-dir` or `--skip-file-data`.

## Repository format

```text
incremental/
  .backup.lock
  objects/sha256/ab/ab...        # independent, verified, immutable copy
  snapshots/xdrive-backup-.../
    database.dump                # pg_dump -Fc (already compressed)
    objects.index                # complete hash and length list
    legacy.tar                   # everything in /data other than canonical CAS
    verify.json
    manifest.json                # format_version=2
    SHA256SUMS.txt               # includes database/index/legacy/manifest
```

For every new snapshot, the CAS writer walks the canonical local CAS paths,
verifies the digest of **newly copied** objects, and does not copy objects
already in the repository with matching size. An existing object is not
silently replaced. The complete per-snapshot index allows restoring any
published snapshot even after deleting the live source files. All canonical
objects are kept independently from the live storage: a source-side GC never
deletes their backed-up copy.

Legacy/noncanonical storage is preserved in `legacy.tar` per snapshot.
Unexpected canonical paths or symlinks in the legacy tree make incremental
backup fail before snapshot publication; the old v1 tar format is available
for such layouts. Objects are published before the snapshot directory is
renamed from `.partial` to its committed name. Interrupted generations are
not listed as valid snapshots.

## Disk-space preflight

Before the maintenance window, a read-only scan compares canonical CAS paths
against repository objects and estimates only the objects not yet stored
there, plus a fresh legacy tar. PostgreSQL's size, 10% headroom and a 64 MiB
reserve are included. Malformed existing objects fail the preflight.
This avoids both a zero-byte first-snapshot estimate and double-counting
reused CAS on later snapshots. Files that change after preflight or unusual
filesystem accounting can still exceed the estimate; incomplete snapshots
are never published.

## Consistency, verification, and recovery

- The v2 path preserves the existing stopped-Server/Worker maintenance
  window to keep its DB and storage snapshot consistent. This MVP does **not**
  claim an online zero-downtime snapshot. PostgreSQL stays on the established
  `pg_dump -Fc` pathway.
- Restore checks v2 checksums and fully hashes all required CAS objects
  *before* replacing the database and file data. Restore is destructive,
  and the existing pre-restore safety backup and storage verification apply.
- Do not move a v2 snapshot directory without also moving its sibling
  `objects/` repository; the entire repository is the portable backup unit.
- The encrypted connector credentials in the database still require the
  appropriate deployment secrets for recovery. Keep the deployment
  configuration/key material securely with independent access controls.

## Retention and future storage backends

**No automatic v2 object GC in this MVP.** Existing seven-day tar retention
does not apply to the shared CAS object repository. Deleting a snapshot
directory alone does not reclaim shared objects; this is intentional so that
a stale reference cannot cause accidental backup data loss. A future
reference-aware prune must atomically protect committed snapshots and
in-progress publication before deleting unreferenced objects.

The future personal-cloud transport should copy the independently stored
objects and committed snapshots, not refer to live files or rewrap everything
in a giant tar. The repository is local first; **no consumer cloud adapter
is enabled here**. Personal-cloud adapters will need upload resume, per-target
receipts, integrity verification and client-side encryption before use.

## Compression

Canonical Blob files are stored **without compression** in v2. Images and
videos are usually already encoded efficiently; re-compressing them adds
CPU usage and often negligible savings. `database.dump` is already written
with PostgreSQL custom format `-Fc`. The legacy tar remains uncompressed
for simple extraction and faster recovery. Compression can be revisited
later for selected highly compressible data, driven by measured savings;
do not introduce zstd and a required decompression step for all Blobs.
