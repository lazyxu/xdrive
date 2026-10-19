import type { XDriveDeviceBackupOverview } from './device-backups'

const canonicalDeviceID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Transport types cannot establish that a continuation is complete or valid.
// Check the redacted shape and cursor before inserting rows into the
// shared Web/Mobile Web/Desktop overview; preserve prior rows on rejection.
export function validateXDriveDeviceBackupDevicePage(
  page: XDriveDeviceBackupOverview,
  afterDeviceID: string,
  knownDeviceIDs: ReadonlySet<string>,
): void {
  const invalid = (): never => { throw new Error('Invalid redacted backup device page') }
  if (!canonicalDeviceID.test(afterDeviceID) ||
      !page || typeof page !== 'object' || Array.isArray(page) ||
      !Array.isArray(page.devices) || page.devices.length > 100 ||
      typeof page.has_more !== 'boolean' ||
      typeof page.has_more_folders !== 'boolean') {
    invalid()
  }
  const seen = new Set<string>()
  for (const device of page.devices) {
    if (!device || typeof device !== 'object' || Array.isArray(device) ||
        typeof device.id !== 'string' || !canonicalDeviceID.test(device.id) ||
        knownDeviceIDs.has(device.id) || seen.has(device.id) ||
        typeof device.name !== 'string' || typeof device.platform !== 'string' ||
        (device.connection_state !== 'unknown' && device.connection_state !== 'online' &&
         device.connection_state !== 'offline') ||
        typeof device.revoked !== 'boolean' ||
        (device.client_version !== undefined && typeof device.client_version !== 'string') ||
        (device.last_seen_at !== undefined && typeof device.last_seen_at !== 'string') ||
        !Array.isArray(device.folders) || device.folders.length > 1000) {
      invalid()
    }
    seen.add(device.id)
    const folderIDs = new Set<number>()
    for (const folder of device.folders) {
      if (!folder || typeof folder !== 'object' || Array.isArray(folder) ||
          !Number.isSafeInteger(folder.source_id) || folder.source_id <= 0 ||
          folderIDs.has(folder.source_id) ||
          typeof folder.name !== 'string' || typeof folder.status !== 'string' ||
          (folder.sync_mode !== 'backup' && folder.sync_mode !== 'mirror') ||
          (folder.target_path !== undefined && typeof folder.target_path !== 'string')) {
        invalid()
      }
      folderIDs.add(folder.source_id)
      if (folder.latest_run !== undefined) {
        const run = folder.latest_run
        if (!run || typeof run !== 'object' || Array.isArray(run) ||
            run.source_id !== folder.source_id ||
            typeof run.id !== 'string' || typeof run.status !== 'string' ||
            typeof run.started_at !== 'string' ||
            !Number.isSafeInteger(run.scanned_items) || run.scanned_items < 0 ||
            !Number.isSafeInteger(run.transferred_bytes) || run.transferred_bytes < 0 ||
            !Number.isSafeInteger(run.failed_items) || run.failed_items < 0 ||
            !Number.isSafeInteger(run.active_transfer_bytes) || run.active_transfer_bytes < 0 ||
            !Number.isSafeInteger(run.active_transfer_total_bytes) || run.active_transfer_total_bytes < 0) {
          invalid()
        }
      }
    }
  }
  if (page.has_more
    ? page.devices.length === 0 ||
      page.next_after_device_id !== page.devices[page.devices.length - 1].id ||
      page.next_after_device_id === afterDeviceID
    : page.next_after_device_id !== undefined && page.next_after_device_id !== '') {
    invalid()
  }
}
