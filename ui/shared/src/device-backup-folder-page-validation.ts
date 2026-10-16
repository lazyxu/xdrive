import type { XDriveDeviceBackupFolderPage } from './device-backups'

// Only an owner-scoped Server response may be displayed. This additional
// renderer-side guard prevents a buggy/old Agent or incomplete transport page
// from being mistaken for a verified, fully-read per-device Source keyset.
// It does not grant access to a Root, a local file or a backup operation.
export function validateXDriveDeviceBackupFolderPage(
  page: XDriveDeviceBackupFolderPage,
  afterSourceID: number,
): void {
  const invalid = () => { throw new Error('Invalid redacted backup folder page') }
  if (!Number.isSafeInteger(afterSourceID) || afterSourceID < 0 ||
      !page || typeof page !== 'object' || Array.isArray(page) ||
      !Array.isArray(page.folders) || page.folders.length > 100 ||
      typeof page.has_more !== 'boolean' ||
      !Number.isSafeInteger(page.next_after_source_id) || page.next_after_source_id < 0) {
    invalid()
  }
  let lastID = afterSourceID
  for (const folder of page.folders) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder) ||
        !Number.isSafeInteger(folder.source_id) || folder.source_id <= lastID ||
        typeof folder.name !== 'string' || typeof folder.status !== 'string' ||
        (folder.sync_mode !== 'backup' && folder.sync_mode !== 'mirror') ||
        (folder.target_path !== undefined && typeof folder.target_path !== 'string')) {
      invalid()
    }
    lastID = folder.source_id
  }
  if (page.has_more
    ? page.folders.length === 0 || page.next_after_source_id !== lastID
    : page.next_after_source_id !== 0) {
    invalid()
  }
}
