import type { XDriveLocalBackupCommonBatch } from './device-backups'

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
