# Administrator-managed scheduled backup presets

## Scope

The existing Server Backup administration page already supports a v1/v2
scheduled **format** and legacy v1 **retention days**, and shows the
installer-managed cron registration evidence. This change adds a separate
fixed-preset control on the same shared Web/Desktop/DSM System Maintenance
screen. It does **not** add an arbitrary cron editor.

The fixed Admin action is `schedule` with `preset`, `revision`, and
`confirmation`. Only the following presets are accepted at every boundary:

| Preset | Exact Host configuration | Meaning |
| --- | --- | --- |
| daily | `17 3 * * *` | 03:17 daily, using Host local time |
| weekly | `17 3 * * 0` | 03:17 Sundays, using Host local time |
| disabled | `disabled` | Removes the installer's managed cron entry |

The Host maps the preset to the expression after validating the authenticated
Server request. Neither the browser nor Agent can submit a Host path, image,
shell invocation, environment variable assignment, or custom cron expression.

## Authorization and fail-closed behavior

- Authenticated Admin only, through the existing
  `POST /api/v1/admin/backups/actions` and Host Control request queue.
- The Server requires a current Host inventory, fresh matching policy revision,
  non-busy operation state, trusted `xdrive-host-backup-schedule-v1` evidence,
  and a registered/not-detected/not-configured installer status.
- Electron Main IPC, Agent IPC, and Server reject unknown presets, unexpected
  fields, malformed revisions and mismatched exact confirmations.
- Host Control independently maps the preset, checks the revision again under
  the installer lock, and rejects any duplicate or nonmatching managed cron row.
  It holds the existing scheduled-backup/operation locks before beginning.
- Only the exact managed `# xdrive-managed-backup` row may be removed or
  replaced. All other crontab entries are retained.
- The staged configuration and crontab are both checked after each write.
  Failures attempt rollback to the preceding entries. A crash between writes
  can leave an explicit `mismatch` status; it never becomes verified success.
- The `disabled` sentinel is preserved during installer upgrades, rather
  than passed as an invalid cron expression.
- A fresh Host policy revision includes the active configured cron expression.
  An operator/installer schedule change invalidates a stale Admin page.

The UI reports *queued* after a successful HTTP acceptance, not *registered*.
Actual registration evidence and Host-operation status must be read separately.
Disabling future cron triggers does not interrupt an in-flight backup, delete
snapshots, disable other systemd/DSM schedulers, or change retention/GC.

## Tests and deliberate exclusions

Go tests cover Admin admission, stale revisions, trusted Host schedule state,
typed confirmation, Owner-neutral errors and rejected Host queue writes.
Agent tests cover the same preset set. Host shell tests exercise daily,
weekly, disabled, malformed preset, stale revision, cron write failure,
duplicate/unexpected managed row, preservation of foreign entries and the
actual fixed Host dispatch. A Desktop source contract test verifies that the
same guarded action is wired into the shared System Maintenance page.

The production installer, not the browser, owns Host cron location and command.
A custom host-defined schedule remains readable but cannot be edited in the
preset selector. Legacy Hosts with no schedule attestation stay unavailable.
Automatic v2 CAS retention/GC and isolated v1 restore drills remain separate
work and are not made available by this feature.

Production-only physical acceptance is **跳过（未验收）** unless the user
runs a real deployment check. Source and exact-head CI remain mandatory.
