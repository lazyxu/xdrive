import type {
  XDriveLocalBackupCommonBatch, XDriveLocalBackupCommonBatchHistoryItem,
  XDriveLocalBackupCommonBatchHistoryPage,
} from './device-backups'

const validStates = ['running', 'partial', 'uncertain', 'paused', 'cancelled']
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Reject forged, stale or completion-claiming DSM Agent status at the UI boundary. */
export function xDriveValidateSynologyLocalBatch(
  sourceID: number, input: unknown,
): XDriveLocalBackupCommonBatch {
  if (!count(sourceID) || sourceID === 0 || !input || typeof input !== 'object') {
    throw new Error('Invalid owner-scoped DSM batch')
  }
  const s = input as Partial<XDriveLocalBackupCommonBatch>
  if (s.source_id !== sourceID || !count(s.revision) ||
    !validStates.includes(s.state ?? '') ||
    typeof s.running !== 'boolean' || s.running !== (s.state === 'running') ||
    (!s.running && s.revision === 0) ||
    s.backup_complete !== false || s.retirement_safe !== false ||
    s.current_cas_verified !== false ||
    !count(s.inspected_files) || !count(s.confirmed_files) ||
    !count(s.skipped_files) || !count(s.unsupported_files) ||
    !count(s.uncertain_files) || !count(s.confirmed_bytes) ||
    (s.confirmed_files as number) > (s.inspected_files as number) ||
    (s.skipped_files as number) > (s.inspected_files as number) - (s.confirmed_files as number) ||
    (s.unsupported_files as number) > (s.inspected_files as number) -
      (s.confirmed_files as number) - (s.skipped_files as number) ||
    (s.stop_requested !== undefined && (!s.running ||
      (s.stop_requested !== 'pause' && s.stop_requested !== 'cancel')))) {
    throw new Error('Untrusted DSM local backup status')
  }
  return s as XDriveLocalBackupCommonBatch
}

/** A bounded owning-Agent receipt history; it is not current Server/CAS proof. */
export function xDriveValidateSynologyLocalHistoryPage(
  sourceID: number, input: unknown,
): XDriveLocalBackupCommonBatchHistoryPage {
  if (!count(sourceID) || sourceID === 0 || !input ||
    typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Invalid owner-scoped DSM local history')
  }
  const page = input as Partial<XDriveLocalBackupCommonBatchHistoryPage>
  if (page.source_id !== sourceID || !Array.isArray(page.items) || page.items.length > 20) {
    throw new Error('Untrusted DSM local history page')
  }
  const seen = new Set<string>()
  for (const raw of page.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Untrusted DSM local history entry')
    }
    const item = raw as Partial<XDriveLocalBackupCommonBatchHistoryItem>
    if (item.source_id !== sourceID ||
      typeof item.run_id !== 'string' || !item.run_id || item.run_id.length > 256 ||
      seen.has(item.run_id) || !count(item.revision) || item.revision === 0 ||
      !['partial', 'uncertain', 'paused', 'cancelled'].includes(item.state ?? '') ||
      ![item.inspected_files, item.confirmed_files, item.skipped_files,
        item.unsupported_files, item.uncertain_files, item.confirmed_bytes].every(count) ||
      (item.confirmed_files as number) + (item.skipped_files as number) >
        (item.inspected_files as number) ||
      !Number.isFinite(Date.parse(item.finished_at ?? ''))) {
      throw new Error('Untrusted DSM local history entry')
    }
    seen.add(item.run_id)
  }
  return page as XDriveLocalBackupCommonBatchHistoryPage
}
