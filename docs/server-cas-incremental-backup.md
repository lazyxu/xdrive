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
are unchanged. An explicit reference-aware **manual** v2 prune is available below; automatic
v2 retention and GC remain disabled.

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
- v2 verify and restore take a **shared, nonblocking flock** on the repository's
  existing `.backup.lock`; it is held across restore preflight and actual
  database/file replacement. v2 capture already takes an exclusive flock.
  Competing repository operations fail closed without stopping services.
  The lock must be an existing real file; no reader creates or truncates it.
  These leases also prevent verification/restore from racing the existing
  **explicit manual** prune. They do not enable scheduled pruning or
  automatic CAS GC.
- Do not move a v2 snapshot directory without also moving its sibling
  `objects/` repository; the entire repository is the portable backup unit.
- The encrypted connector credentials in the database still require the
  appropriate deployment secrets for recovery. Keep the deployment
  configuration/key material securely with independent access controls.

## Retention and future storage backends

**No automatic v2 object GC in this MVP.** Existing seven-day tar retention
does not apply to the shared CAS object repository. Deleting a snapshot
directory by hand does not reclaim shared objects and can invalidate backup
references. The separate **explicit manual prune** operation described below
uses an exclusive repository lock, independently verifies integrity and
rechecks all surviving snapshot references before reclaiming objects.

The future personal-cloud transport should copy the independently stored
objects and committed snapshots, not refer to live files or rewrap everything
in a giant tar. The repository is local first; **no consumer cloud adapter
is enabled here**. Personal-cloud adapters will need upload resume, per-target
receipts, integrity verification and client-side encryption before use.

## Read-only v2 retention and CAS reference preview

The following **offline, administrator-run preview does not delete anything**.
It uses the current Server image's bundled, dependency-free CAS helper through
a read-only Docker bind mount of the local repository:

```bash
xdrive-server backup retention-plan --keep-last 7
# Optional full CAS SHA-256 audit, manually only (may read many GiB):
xdrive-server backup retention-plan --keep-last 7 --mode deep
# For a different repository:
xdrive-server backup retention-plan --repository-dir "/absolute/backup disk/incremental" --keep-last 3
```

Without `--repository-dir`, it uses the configured scheduled v2 repository when
`XD_BACKUP_SCHEDULE_FORMAT=v2`, or otherwise `~/.xd/backups/incremental`.
The repository must already exist. This is a manual diagnostic, **not** a
change to `XD_BACKUP_RETENTION_DAYS`, scheduling, or automatic cleanup.
Default `--mode fast` validates snapshot checksums and CAS existence/size;
explicit `--mode deep` hashes each unique repository CAS object once, including
unreferenced objects. The JSON `hashed_objects` and `hashed_bytes` fields
record the actual full-content coverage (zero for fast). Deep requires an
existing safe `.backup.lock` and holds the writer-compatible shared lock
for the entire Docker run. It never creates/truncates the lock or writes to
the repository; the container still receives a read-only bind mount.
Standalone internal helper invocations do not acquire a host-side lock.

The JSON report distinguishes:
- `keep_snapshots`: latest N committed v2 generations, still protected;
- `drop_candidates`: older generations that a separate manually confirmed prune may consider, after its own exclusive-locked revalidation;
- `retained_objects`: unique CAS objects used by protected generations;
- `drop_only_objects`: objects only referenced by candidate generations;
- `unreferenced_objects`: repository objects absent from every committed index;
- `drop_snapshot_bytes`, `drop_only_object_bytes`, and
  `unreferenced_bytes`: logical byte totals, not guaranteed allocated disk
  blocks, filesystem savings, or permission to delete.
  The administrator's shared Web/Desktop panel now breaks down these three
  independently, separately from `retained_objects` and the full logical
  total. Missing or unsafe integers remain **unknown**, never inferred as
  zero. A mismatched component sum is visibly flagged. This remains a
  historical, read-only estimate rather than actual physical reclaim evidence.

Every committed snapshot's exact v2 file set and SHA256SUMS are verified,
alongside `objects.index` syntax, cross-generation CAS sizes and the existence
and size of indexed repository objects. Any `.partial` generation, malformed
or symlinked path, unexpected object, missing CAS reference, checksum failure,
or unknown snapshot blocks the *entire* report. Running this scan hashes
each snapshot's database.dump and legacy.tar, so it may be I/O-intensive.

**Important:** even a successful manual deep audit is a point-in-time
read-only result, not authorization to delete anything. Fast mode does not
hash CAS content; deep mode may take substantial disk I/O and is never
scheduled automatically. Neither mode guarantees physical savings.
**Automatic** snapshot deletion, scheduled CAS GC, background pruning,
compression and Pack remain disabled. The separate manually confirmed prune
below performs its own exclusive-locked deep revalidation before deletion.

## Manual v2 prune (opt-in, destructive, never scheduled)

This action removes older v2 generations and unreferenced repository CAS data.
It is separate from the ordinary backup command, the read-only retention
preview, the installer and scheduled backups. First inspect the preview and
retain a separate repository copy if you may need the older restore points.

    xdrive-server backup retention-plan --keep-last 7 --mode deep
    xdrive-server backup prune --keep-last 7 --yes

    # Optional separate local repository (paths with spaces supported):
    xdrive-server backup prune --repository-dir "/absolute/backup disk/incremental" --keep-last 7 --yes

The Linux helper itself acquires an exclusive nonblocking lock on the
**existing** regular .backup.lock file. Under this lock it revalidates all
committed snapshot checksums, indexes and each unique physical repository
CAS object with full SHA-256 before any mutation. It additionally validates
retained legacy tar archives' safe entry structure; verifying a PostgreSQL
dump's actual restorability still requires a full recovery drill. It atomically renames
retired snapshots into .prune-retired/tx-*/ and recomputes every reference
from the surviving committed snapshots. Only CAS objects absent from **all**
surviving indexes can be unlinked; immutable objects shared with retained
snapshots are never deliberately deleted. The command uses a single writable
local repository bind mount in a network-disabled container. The host
wrapper rejects a backup repository that overlaps configured live file storage
or the running Server's actual /data mount, including nested paths and
symlink aliases. It does not operate on PostgreSQL or legacy v1 snapshots.

An interrupted prune leaves its retired transaction as a disk journal.
A **new explicit** backup prune invocation revalidates the surviving
repository under the exclusive lock and safely completes cleanup of retired
files. It cannot automatically revive a deliberately retired generation:
do not manually move quarantined directories back after a prune has begun.
An interrupted cleanup may temporarily retain unused bytes; it does not
require a background worker or silent startup recovery.

No scheduled v2 pruning, automatic CAS GC, online CAS compaction,
compression/Pack or consumer-cloud backup is enabled by this command.
Returned byte counts are logical bytes, not guaranteed filesystem-block
savings. Corrupt/missing CAS, unexpected files, incomplete .partial
generations, suspicious symlinks or lock contention fail closed.

## Selected v2 snapshot deletion — internal helper foundation

The **internal** `xdrive-backup-repo delete-snapshot --repo PATH --snapshot
xdrive-backup-YYYYMMDDTHHMMSSZ --yes` path (under development, not exposed
through the Administrator UI or Host manager yet) selects exactly one committed
v2 generation. It does **not** translate selection into a keep-last retention
policy; older and newer generations may both be protected.

This path shares the existing manual prune transaction code. It requires the
same exclusive `.backup.lock`, validates the entire repository and referenced
and orphan CAS by SHA-256 before any rename or unlink, independently validates
the remaining legacy archives, and retains at least one usable committed
v2 recovery point. It then moves **only** the selected generation into the
durable `.prune-retired` journal, recalculates references from all surviving
generations under the same lock, and reclaims only unreferenced repository CAS.
A corrupt/partial/unknown snapshot, unknown path, missing lock, symlinked
repository, or last-recovery-point deletion is rejected without a mutation.

A crash after a generation is retired but before the journal is fully consumed
can require another **explicit** manual prune to finish retiring its content.
The selected generation must not be automatically replayed or guessed from
a stale UI selection; report this outcome conservatively.

**Scope:** no automatic v2 GC, no scheduling, no new browser-supplied Host
command/path, no production storage deletion. Admin/Host integration, end-to-end
protected confirmation and real recovery acceptance are **not** part of this
internal helper milestone and require later separately verified changes.

## Administrator Web / Desktop shared interface (Host-owned Server backups)

The administrator's **备份与系统维护 → 服务器备份与恢复** section
uses the existing authenticated Server API and Host Control bridge. It is
separate from owning-device Push backups and from online CAS storage checks.

- **Create**: manual v1 or v2 via the original Host backup command; v2 reuses
  configured scheduled repository if selected, otherwise the default.
- **Read**: Host-listed committed snapshot identities and sizes, current
  schedule format, v1 retention days, operation status and bounded read-only
  v2 retention previews. This initial UI lists up to 100 generations and
  never accepts raw browser-supplied paths.
- **Update**: revision-fenced v1/v2 scheduled format and v1 retention days.
  Immutable snapshot objects are never edited. The original schedule is
  retained; changing to v2 does not enable scheduled pruning.
- **Delete**: separate explicitly confirmed v1 snapshot deletion with a
  restricted file allowlist; v2 deletion is only the existing
  `backup prune --keep-last N --yes` and revalidates shared CAS references.
- **Verify / restore**: checksum validation and optional full v2 CAS hashing.
  Restoration requires typing the exact snapshot identity and uses the
  original Host command with mandatory pre-restore safety backup.
  Legacy database-only snapshots are listed and remain verifiable but are
  **not** offered as a full database-and-file restore; use the explicit
  local `--database-only` recovery procedure instead.

The API itself has neither a Docker socket nor arbitrary Host file access.
Commands are chosen from a fixed allowlist, executed only by the existing
Host Control daemon under its Host-owned policy and repository locks.
Desktop uses the same MUI panel via fixed Agent IPC methods with an independent Admin role check. Agents without `admin-backups` do not advertise this capability.

If the Host Control runner or current inventory is unavailable, the UI
is disabled rather than pretending the operation succeeded.

Host Control now persists the latest 30 terminal administrator backup outcomes
in a bounded private JSON history file. Shared Web/Desktop UI shows these
executed results plus a per-snapshot *last verification (historical)* receipt.
This is not a claim that previously verified bytes remain valid: any actual
restore re-runs the full fail-closed verification.

Manual Create uses the existing `server-backup.sh` progress file.
Host Control copies bounded, actual per-stage bytes and labels to its
authenticated status. Web/Desktop render a determinate progress bar only
when a trustworthy byte total is known. Unknown totals remain indeterminate;
stage counters can reset and must not be described as an overall percentage.
Other actions retain indeterminate progress until native evidence exists.
Final Host terminal receipts remain authoritative.

The shared administrator panel also provides an **integrity overview** based
only on Host-discovered generations and the most recent (up to 30) operation
receipts. It separates structurally complete file+database restore candidates,
database-only, incomplete, inconsistent, previous verify success/failure and
absent recent verify receipts. A failed historical check is a warning; a
previous success is **not** a current integrity guarantee. The read-only
"verify latest complete backup" shortcut defaults to `fast` and uses the
same authorized fixed Host action. No client-side hash estimate or fake
recovery-success badge is emitted.

History rows now offer an individual **Host execution detail** dialog with
start/end timestamps, actual elapsed seconds, structured result/error code,
mode and receipt ID. Lock contention, interrupted Host actions and generic
failures have bounded, human-readable explanations; raw Host logs and paths
are never sent to the browser. The existing v2 retention preview displays
actual `hashed_objects` / `hashed_bytes` when the Host reports them.
Individual verification object counts and per-category failures are still
unavailable from the existing Host protocol and are **explicitly not
estimated**. This is historical diagnostic evidence, not a restore drill.

Online CAS verification/repair lives in **全局存储** and Task Center;
a successful online health check does not prove a backup can be restored.
Backup verification also does not replace a physical PostgreSQL and file
recovery drill. No automatic v2 GC, compression, Pack or paid cloud service
is enabled by the Admin UI.

## Machine-readable CAS verification statistics (source-level)

The internal, read-only `xdrive-backup-repo verify --repo PATH --snapshot NAME
--json` prints a fixed-schema JSON receipt on stdout. It preserves the
existing deep SHA-256 verification and nonzero exit status on errors. Fields:
`protocol`, `state`, `mode`, `objects_checked`, `bytes_hashed`, and
optional enumerated `failure_category`. These counters come from actual
verification work, not projected byte counts. **On failure they are partial**;
never present them as a fully passed scan. The report deliberately omits
paths, CAS digests and raw error messages. stderr remains a private CLI
diagnostic channel. `--json` is not valid for create, prune, retention or
other subcommands.

The Host Manager now supports `xdrive-server backup verify --json [BACKUP_DIR]`.
Its existing snapshot SHA256SUMS preflight and repository shared lock remain
in effect, with **one referenced-CAS hash pass**, not two. The bounded
`xdrive-host-backup-verify-v1` report carries `format`, `state`,
`scope`, `cas_objects_checked`, `cas_bytes_hashed`, and a fixed failure
category when available. On v1 these two CAS counters are zero because the
snapshot files are verified by SHA256SUMS instead. Any v2 success requires
valid, real CAS helper evidence. Failures retain nonzero exit status and
partial counts; raw file paths, object hashes and logs are excluded from JSON.
This does not prove PostgreSQL data can actually be restored and queried.

This internal CAS report is **not itself a complete backup verification**:
the Host `xdrive-server backup verify` also checks the snapshot metadata,
SHA256SUMS and database dump. Do not advertise an internal CAS success as a
fully restorable snapshot. Admin Host Control now persists a validated report as optional evidence on
each verification-history record. The shared Web/Desktop detail dialog shows
historical counts and safe failure categories without disclosing Host paths.
This is evidence of the completed checksum/CAS check, not a restore drill.

### Recoverability evidence in the Admin shared UI

The **恢复能力与演练证据** section uses the selected snapshot and the
existing authenticated Host inventory/history, not a new Docker/CLI writer.
It shows four independent evidence classes: structural backup candidate,
most recent historical checksum/CAS verification, most recent Host-recorded
*actual restore action*, and isolated recovery-drill acceptance. A successful
destructive restore action is **not** evidence of an isolated drill. History is
bounded to 30 receipts, and no history is not a failed backup.

For PR-triggered CI, `GITHUB_SHA` is a synthetic merge checkout, not
necessarily the feature head or the eventual squash-merge commit. For the
historical run below, the artifact's `ci_checkout_sha` is
`316584c0b5c9b0acb8a17c337a40a339a3fff620`; GitHub's merge commit
has `954fc13622acb83582e5e202bdad914e82e1a2e4` as its second parent.
Future artifacts additionally include `ci_source_head_sha` and must pass
an exact SHA/schema/checkout-ancestry validator inside the same CI run
before upload. Neither mechanism binds artifacts to an installed Host.

The only verified CI drill for feature head `954fc13622acb83582e5e202bdad914e82e1a2e4`
is [GitHub Actions run 40499948689](https://github.com/lazyxu/xdrive/actions/runs/40499948689)
with artifact `xdrive-server-isolated-restore-drill` (ID `12734306146`).
This is **ephemeral CI Docker/PostgreSQL**, with actual SQL, legacy-file,
CAS-byte and post-prune restoration assertions, **not** evidence that the
operator's currently installed Host has been drilled. The Admin UI therefore
does not render a green production-drill state or automatically trust CI
artifacts. Physical Host-only acceptance is **跳过（未验收）** until separate
Host-bound evidence exists. No new remote Admin action or production restore
is invoked by this read-only view.

## Manual Host-only offline v2 recovery drill

The local Host CLI can now exercise a **previously committed v2 backup** in
disposable memory without connecting to PostgreSQL, stopping Server/Worker or
touching any live file data:

```bash
xdrive-server backup drill "/absolute/path/to/incremental/snapshots/xdrive-backup-YYYYMMDDTHHMMSSZ" --max-mib 1024
```

Allowed memory quota: 256–8192 MiB, default 1024 MiB. The v2 snapshot must belong to the default or explicitly configured Host
repository inventory, be marked consistent, and include full file data. It
must be committed, checksum-valid and within the quota, with a safe shared
repository lock and locally cached xDrive Server and `postgres:17-alpine`
Docker images. Exceeding the quota causes an explicit failure, not an
incomplete "successful" drill. Large production archives will often require
a different, separately specified disk sandbox; the current RAM-only mode
must **not** pretend to prove recoverability for multi-TiB repositories.

The CAS stage starts as the invoking Host backup owner (not privileged Docker root), using `--network none`, `--read-only`, no-capabilities,
no-new-privileges Docker helper with bounded memory/PIDs, one strictly
**read-only backup repository mount** and a disposable `/data` tmpfs. It
physically restores the referenced CAS objects and legacy file archive.
The official PostgreSQL image declares a default data volume: this command
explicitly shadows that default with a second small tmpfs so Docker cannot
silently provide a disk-backed anonymous database volume.
PostgreSQL starts a separate non-root, network-disabled
`postgres:17-alpine` tmpfs container, receives `database.dump` **only
on stdin**, creates a private database cluster, runs
`pg_restore --exit-on-error` and queries the restored system tables.
There is **no Host bind mount** in the PostgreSQL container and no
connection to the production database, Docker socket mount, or online file
storage. Containers are removed when the bounded execution terminates.

The fixed-schema stdout includes `files_restored`, `postgresql_restored`,
`failure_category` and `production_verified:false`. A partial stage
cannot be called successful. This is a **Host-local CLI only** in the first
iteration: there is no Web/Desktop remote trigger or Host-attested durable
history yet. The Admin read-only evidence panel continues to show
`跳过（未验收）` until a separately authenticated, source-bound receipt
exists. A sandbox drill is not production recovery acceptance.

## Host-only and administrator-triggered isolated restore drill (v2)

The new `backup drill ABSOLUTE_V2_SNAPSHOT [--max-mib N]` Host CLI is
developed separately in #2874 and performs real read-only CAS/legacy recovery
and PostgreSQL restore/query in disconnected tmpfs-only Docker containers.
The Admin UI fixed `drill` action depends on that Host binary.

The authenticated Admin action accepts **only an existing complete v2 snapshot ID**
and the exact `DRILL <snapshot_id>` confirmation. Web and Desktop accept no
client-supplied Host path, Docker image, command, network, or RAM limit.
Host Control resolves the snapshot against its own inventory, holds the existing
scheduled/upgrade backup locks and always calls the fixed 1024 MiB Host CLI.
The CLI is fail-closed on unavailable images, corrupt bytes and over-budget data.
There is no production database mount, live file mount or network connectivity.
An oversized backup fails clearly instead of silently falling back to destructive
restore; larger deliberate operator drills remain Host-local.

Only a bounded, schema-checked Host receipt may be persisted in the existing
30-entry private administrator history: exact snapshot name and executed result,
real file/SQL recovery booleans, historical timestamps, resource ceiling and fixed
failure category. Invalid or absent proof can **never** count as a successful
drill. The shared UI distinguishes that historical Host sandbox result from
checksum-only verification, actual production restore history and a true
production destructive-recovery acceptance (still **跳过（未验收）**).

This separate experimental Admin capability must not merge until the dependency
#2874 and new source-exact security/API/Docker E2E tests pass. It does not change
backup format, automatic v2 retention, CAS Pack or compression.

## Compression

Canonical Blob files are stored **without compression** in v2. Images and
videos are usually already encoded efficiently; re-compressing them adds
CPU usage and often negligible savings. `database.dump` is already written
with PostgreSQL custom format `-Fc`. The legacy tar remains uncompressed
for simple extraction and faster recovery. Compression can be revisited
later for selected highly compressible data, driven by measured savings;
do not introduce zstd and a required decompression step for all Blobs.
