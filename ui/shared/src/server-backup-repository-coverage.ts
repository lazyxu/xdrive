import type { XDriveServerBackupPage } from './server-backup-admin'

export type XDriveBackupRepositoryID = 'v1' | 'v2-default' | 'v2-configured'
export type XDriveBackupRepositoryCoverage = {
  id: XDriveBackupRepositoryID
  total: number
  listed: number
  unlisted: number
  completeFiles: number
  databaseOnly: number
  incomplete: number
  inconsistent: number
}

const repositoryIDs: readonly XDriveBackupRepositoryID[] = ['v1', 'v2-default', 'v2-configured']
const snapshotIdentity = /^(v1|v2-default|v2-configured):xdrive-backup-[0-9]{8}T[0-9]{6}Z$/

/** Identity/structure-only summary of an authenticated Host inventory.
 * The Host publishes all-generation directory counts but only the newest 100
 * metadata rows. Never equate these counters to verified/current recoverability. */
export function summarizeServerBackupRepositoryCoverage(
  inventory: XDriveServerBackupPage['inventory'],
): XDriveBackupRepositoryCoverage[] | null {
  const counts = inventory.repositories
  const total = inventory.total_snapshots
  if (!Array.isArray(counts) || counts.length !== repositoryIDs.length ||
      !Number.isSafeInteger(total) || total === undefined || total < 0 || total > 1_000_000 ||
      !Array.isArray(inventory.snapshots) || inventory.snapshots.length > 100 ||
      counts.some((entry, i) => entry.id !== repositoryIDs[i] ||
        !Number.isSafeInteger(entry.snapshot_count) || entry.snapshot_count < 0 ||
        entry.snapshot_count > 1_000_000) ||
      counts.reduce((sum, item) => sum + item.snapshot_count, 0) !== total) return null

  const report: XDriveBackupRepositoryCoverage[] = counts.map(entry => ({
    id: entry.id,
    total: entry.snapshot_count,
    listed: 0,
    unlisted: 0,
    completeFiles: 0,
    databaseOnly: 0,
    incomplete: 0,
    inconsistent: 0,
  }))
  const seen = new Set<string>()
  for (const snapshot of inventory.snapshots) {
    const match = snapshotIdentity.exec(snapshot.id)
    if (!match || seen.has(snapshot.id)) return null
    seen.add(snapshot.id)
    const id = match[1] as XDriveBackupRepositoryID
    if ((snapshot.format === 'v1') !== (id === 'v1') ||
        (snapshot.format !== 'v1' && snapshot.format !== 'v2') ||
        (id !== 'v1' && !snapshot.file_data_included)) return null
    const row = report[repositoryIDs.indexOf(id)]
    if (++row.listed > row.total) return null
    if (snapshot.state === 'inconsistent') row.inconsistent++
    else if (snapshot.state === 'incomplete') row.incomplete++
    else if (snapshot.state === 'complete') {
      if (snapshot.file_data_included) row.completeFiles++
      else row.databaseOnly++
    } else return null
  }
  for (const row of report) row.unlisted = row.total - row.listed
  return report
}
