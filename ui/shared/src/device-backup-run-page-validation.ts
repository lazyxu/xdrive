import type { XDriveDeviceBackupRunPage } from './device-backups'

// This is a runtime trust boundary for owner-redacted Web/Desktop history.
// Transport interfaces alone cannot establish Source identity or page shape.
// Never commit a failed page, report it as empty, or treat it as completion.
const runFields = new Set([
  'id', 'source_id', 'run_number', 'mode', 'trigger', 'status',
  'scanned_items', 'scanned_bytes', 'ignored_items', 'new_items',
  'changed_items', 'moved_items', 'unchanged_items', 'planned_transfer_bytes',
  'transferred_items', 'transferred_bytes', 'failed_items',
  'active_transfer_bytes', 'active_transfer_total_bytes',
  'cancel_requested_at', 'started_at', 'finished_at',
])
const counters = [
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

// Offset history cannot be a stable snapshot when a newer Run arrives.
// Validate EACH received page, not invented cross-page continuity.
export function validateXDriveDeviceBackupRunPage(
  page: XDriveDeviceBackupRunPage,
  sourceID: number,
  limit: number,
  offset: number,
): void {
  const invalid = (): never => { throw new Error('Invalid redacted backup run page') }
  if (!Number.isSafeInteger(sourceID) || sourceID <= 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(offset + limit) ||
      !page || typeof page !== 'object' || Array.isArray(page) ||
      !Array.isArray(page.items) || page.items.length > limit ||
      typeof page.has_more !== 'boolean' ||
      (page.has_more && page.items.length !== limit)) {
    invalid()
  }
  const seen = new Set<string>()
  let previousStart = Infinity
  for (const run of page.items) {
    if (!run || typeof run !== 'object' || Array.isArray(run) ||
        run.source_id !== sourceID ||
        typeof run.id !== 'string' || !safeRunID.test(run.id) ||
        run.id.length > 128 || seen.has(run.id) ||
        typeof run.mode !== 'string' || !run.mode || run.mode.length > 64 ||
        typeof run.trigger !== 'string' || !run.trigger || run.trigger.length > 64 ||
        typeof run.status !== 'string' || !run.status || run.status.length > 64 ||
        !validTimestamp(run.started_at) ||
        (run.finished_at !== undefined && !validTimestamp(run.finished_at)) ||
        (run.cancel_requested_at !== undefined && !validTimestamp(run.cancel_requested_at)) ||
        Object.keys(run).some((field) => !runFields.has(field)) ||
        counters.some((field) => !Number.isSafeInteger(run[field]) || run[field] < 0)) {
      invalid()
    }
    const startedAt = Date.parse(run.started_at)
    if (startedAt > previousStart) invalid()
    previousStart = startedAt
    seen.add(run.id)
  }
}
