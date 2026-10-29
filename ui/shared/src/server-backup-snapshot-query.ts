import type { XDriveServerBackupSnapshot } from './server-backup-admin'

export type XDriveServerBackupSnapshotFilter = {
  query: string
  format: 'all' | 'v1' | 'v2'
  status: 'all' | 'recoverable' | 'database_only' | 'incomplete' | 'inconsistent'
  order: 'newest' | 'oldest'
}

/** Search only the existing authorized Host inventory, never the entire repository. */
export function filterServerBackupSnapshots(
  snapshots: readonly XDriveServerBackupSnapshot[],
  filter: XDriveServerBackupSnapshotFilter,
): XDriveServerBackupSnapshot[] {
  const query = filter.query.trim().toLocaleLowerCase()
  const results = snapshots.filter(item => {
    if (query && !item.name.toLocaleLowerCase().includes(query) &&
      !item.id.toLocaleLowerCase().includes(query)) return false
    if (filter.format !== 'all' && item.format !== filter.format) return false
    switch (filter.status) {
      case 'recoverable': return item.state === 'complete' && item.file_data_included
      case 'database_only': return item.state === 'complete' && !item.file_data_included
      case 'incomplete': return item.state === 'incomplete'
      case 'inconsistent': return item.state === 'inconsistent'
      default: return true
    }
  })
  const direction = filter.order === 'oldest' ? 1 : -1
  return results.sort((a, b) => {
    const byTime = a.created_at.localeCompare(b.created_at)
    return byTime ? byTime * direction : a.id.localeCompare(b.id) * direction
  })
}
