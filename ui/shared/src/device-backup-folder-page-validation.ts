import type { XDriveDeviceBackupFolderPage } from './device-backups'

// A per-device page is untrusted JSON even though the transport is typed.
// Check the complete owner-redacted shape BEFORE the shared Web/Desktop
// presenter accepts or stores it. Do not admit private Root/OS/Agent fields.
const pageFields = new Set(['folders', 'has_more', 'next_after_source_id'])
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

export function validateXDriveDeviceBackupFolderPage(
  page: XDriveDeviceBackupFolderPage,
  afterSourceID: number,
): void {
  const invalid = (): never => { throw new Error('Invalid redacted backup folder page') }
  if (!Number.isSafeInteger(afterSourceID) || afterSourceID < 0 ||
      !page || typeof page !== 'object' || Array.isArray(page) ||
      !onlyFields(page, pageFields) ||
      !Array.isArray(page.folders) || page.folders.length > 100 ||
      typeof page.has_more !== 'boolean' ||
      !Number.isSafeInteger(page.next_after_source_id) || page.next_after_source_id < 0) {
    invalid()
  }
  let lastID = afterSourceID
  for (const folder of page.folders) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder) ||
        !onlyFields(folder, folderFields) ||
        !Number.isSafeInteger(folder.source_id) || folder.source_id <= lastID ||
        typeof folder.name !== 'string' || typeof folder.status !== 'string' ||
        (folder.sync_mode !== 'backup' && folder.sync_mode !== 'mirror') ||
        (folder.target_path !== undefined && typeof folder.target_path !== 'string')) {
      invalid()
    }
    if (folder.latest_run !== undefined) {
      const run = folder.latest_run
      if (!run || typeof run !== 'object' || Array.isArray(run) ||
          !onlyFields(run, runFields) ||
          run.source_id !== folder.source_id ||
          typeof run.id !== 'string' || !safeRunID.test(run.id) || run.id.length > 128 ||
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
    lastID = folder.source_id
  }
  if (page.has_more
    ? page.folders.length === 0 || page.next_after_source_id !== lastID
    : page.next_after_source_id !== 0) {
    invalid()
  }
}
