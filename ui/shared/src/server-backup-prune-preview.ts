import type { XDriveServerBackupPage } from './server-backup-admin'

// The Host's read-only preview is not a deletion authorization. The UI only
// enables manual prune after a successful matching Host operation in this
// authenticated page session. The Host must independently revalidate under
// its exclusive repository lock before actually deleting anything.
export type XDriveServerBackupPrunePreview = {
  requestID: string
  keepLast: number
  mode: 'fast' | 'deep'
}

export function canPruneServerBackup(
  page: XDriveServerBackupPage | null,
  keepLast: number,
  mode: 'fast' | 'deep',
  preview: XDriveServerBackupPrunePreview | null,
): boolean {
  if (!page?.supported || !preview ||
      !Number.isInteger(keepLast) || keepLast < 1 || keepLast > 1000 ||
      preview.keepLast !== keepLast || preview.mode !== mode ||
      !preview.requestID || page.operation.request_id !== preview.requestID ||
      page.operation.action !== 'plan' || page.operation.state !== 'success') return false

  const report = page.retention
  const expectedValidation = mode === 'deep'
    ? 'snapshot_sha256_and_full_cas_sha256'
    : 'snapshot_sha256_and_cas_size'
  return Boolean(report && report.mode === 'read_only' &&
    report.delete_enabled === false &&
    report.validation === expectedValidation && report.keep_last === keepLast &&
    ((report.drop_candidates?.length || 0) > 0 || report.unreferenced_objects > 0))
}
