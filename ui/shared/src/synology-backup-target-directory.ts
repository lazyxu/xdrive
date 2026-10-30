import type { XDriveSynologyOwnerFileNode } from './synology-backup-adapter'

// A Target ID is a Server Owner cloud directory ID, never a DSM local Root.
// Rows are already authenticated by the owning Agent and validated by the
// same-origin client; reject malformed/extra fields again before rendering a
// directory selector. Do not turn the selector into a new Source grant.
const allowedFields = new Set([
  'id', 'parent_id', 'name', 'type', 'size', 'revision', 'created_at', 'updated_at',
])

export function xDriveSynologyBackupTargetDirectories(
  rows: readonly XDriveSynologyOwnerFileNode[],
  parentID: number,
  verified: boolean,
): XDriveSynologyOwnerFileNode[] {
  if (!verified) return []
  if (!Number.isSafeInteger(parentID) || parentID <= 0 ||
    !Array.isArray(rows) || rows.length > 200) {
    throw new Error('Unverified DSM Owner backup target page')
  }
  const seen = new Set<number>()
  const folders: XDriveSynologyOwnerFileNode[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
      Object.keys(row).some(key => !allowedFields.has(key)) ||
      !Number.isSafeInteger(row.id) || row.id <= 0 ||
      row.parent_id !== parentID ||
      !Number.isSafeInteger(row.revision) || row.revision <= 0 ||
      !Number.isSafeInteger(row.size) || row.size < 0 ||
      typeof row.name !== 'string' || row.name.length === 0 || row.name.length > 512 ||
      (row.type !== 'file' && row.type !== 'dir') || seen.has(row.id)) {
      throw new Error('Unsafe DSM Owner backup target row')
    }
    seen.add(row.id)
    if (row.type === 'dir') folders.push(row)
  }
  return folders
}
