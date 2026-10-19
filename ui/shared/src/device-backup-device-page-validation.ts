import type { XDriveDeviceBackupOverview } from './device-backups'

const canonicalDeviceID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Exact owner-redacted DTO allowlists. Typed transport can still carry
// untrusted extra JSON keys from an old Agent or a server regression.
const overviewFields = new Set(['devices', 'has_more', 'has_more_folders', 'next_after_device_id'])
const deviceFields = new Set([
  'id', 'name', 'platform', 'client_version', 'last_seen_at',
  'connection_state', 'revoked', 'folders',
])
const folderFields = new Set([
  'source_id', 'name', 'target_path', 'sync_mode', 'status', 'latest_run',
])
const runFields = new Set([
  'id', 'source_id', 'run_number', 'mode', 'trigger', 'status',
  'scanned_items', 'scanned_bytes', 'ignored_items', 'new_items',
  'changed_items', 'moved_items', 'unchanged_items', 'planned_transfer_bytes',
  'transferred_items', 'transferred_bytes', 'failed_items',
  'active_transfer_bytes', 'active_transfer_total_bytes',
  'cancel_requested_at', 'started_at', 'finished_at',
])
const runCounters = [
  'run_number', 'scanned_items', 'scanned_bytes', 'ignored_items',
  'new_items', 'changed_items', 'moved_items', 'unchanged_items',
  'planned_transfer_bytes', 'transferred_items', 'transferred_bytes',
  'failed_items', 'active_transfer_bytes', 'active_transfer_total_bytes',
] as const
const safeRunID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const serverTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && serverTimestamp.test(value) &&
    Number.isFinite(Date.parse(value))
}
function onlyFields(value: object, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

// Transport types cannot establish that a continuation is complete or valid.
// Check the redacted shape and cursor before inserting rows into the
// shared Web/Mobile Web/Desktop overview; preserve prior rows on rejection.
// The initial owner-scoped Server/Agent response must pass the same
// strict redacted DTO checks as a continuation page before React paints.
// null is an initial-page marker, never a fabricated device cursor.
export function validateXDriveDeviceBackupInitialOverview(
  page: XDriveDeviceBackupOverview,
): void {
  validateXDriveDeviceBackupPage(page, null, new Set<string>())
}

export function validateXDriveDeviceBackupDevicePage(
  page: XDriveDeviceBackupOverview,
  afterDeviceID: string,
  knownDeviceIDs: ReadonlySet<string>,
): void {
  validateXDriveDeviceBackupPage(page, afterDeviceID, knownDeviceIDs)
}

function validateXDriveDeviceBackupPage(
  page: XDriveDeviceBackupOverview,
  afterDeviceID: string | null,
  knownDeviceIDs: ReadonlySet<string>,
): void {
  const invalid = (): never => { throw new Error('Invalid redacted backup device page') }
  if ((afterDeviceID !== null && !canonicalDeviceID.test(afterDeviceID)) ||
      !page || typeof page !== 'object' || Array.isArray(page) ||
      !onlyFields(page, overviewFields) ||
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
        !onlyFields(device, deviceFields) ||
        typeof device.name !== 'string' || typeof device.platform !== 'string' ||
        (device.connection_state !== 'unknown' && device.connection_state !== 'online' &&
         device.connection_state !== 'offline') ||
        typeof device.revoked !== 'boolean' ||
        (device.client_version !== undefined && typeof device.client_version !== 'string') ||
        (device.last_seen_at !== undefined && !validTimestamp(device.last_seen_at)) ||
        !Array.isArray(device.folders) || device.folders.length > 1000) {
      invalid()
    }
    seen.add(device.id)
    const folderIDs = new Set<number>()
    for (const folder of device.folders) {
      if (!folder || typeof folder !== 'object' || Array.isArray(folder) ||
          !Number.isSafeInteger(folder.source_id) || folder.source_id <= 0 ||
          folderIDs.has(folder.source_id) || !onlyFields(folder, folderFields) ||
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
            typeof run.id !== 'string' || !safeRunID.test(run.id) || run.id.length > 128 ||
            !onlyFields(run, runFields) ||
            typeof run.mode !== 'string' || run.mode.length === 0 || run.mode.length > 64 ||
            typeof run.trigger !== 'string' || run.trigger.length === 0 || run.trigger.length > 64 ||
            typeof run.status !== 'string' || run.status.length === 0 || run.status.length > 64 ||
            !validTimestamp(run.started_at) ||
            (run.finished_at !== undefined && !validTimestamp(run.finished_at)) ||
            (run.cancel_requested_at !== undefined && !validTimestamp(run.cancel_requested_at)) ||
            runCounters.some((field) => !Number.isSafeInteger(run[field]) || run[field] < 0)) {
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
