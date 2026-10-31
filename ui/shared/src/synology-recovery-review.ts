import type { XDriveLocalBackupRecoveryReview } from './device-backups'

// Only the original owning Agent can produce this unauthoritative historical
// SQL receipt view. Never accept private Root/path/Operation fields, claims of
// current CAS integrity, mixed-epoch pages or JavaScript-unsafe integers.
const allowedFields = new Set([
  'source_id', 'revision', 'run_state', 'reviewed_files', 'ignored_files',
  'unsupported_files', 'unrecorded_files', 'historical_committed_files',
  'current_node_metadata_match_files', 'current_node_metadata_mismatch_files',
  'pending_original_files', 'next_after_file', 'page_epoch', 'has_more',
  'authoritative',
])
const receiptCounts = [
  'reviewed_files', 'ignored_files', 'unsupported_files', 'unrecorded_files',
  'historical_committed_files', 'current_node_metadata_match_files',
  'current_node_metadata_mismatch_files', 'pending_original_files',
] as const
const validNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
const epochPattern = /^[0-9a-f]{64}$/

export function xDriveValidateSynologyRecoveryReview(
  raw: unknown, sourceID: number, after: number, expectedEpoch: string,
): XDriveLocalBackupRecoveryReview {
  if (!validNumber(sourceID) || sourceID < 1 ||
    !validNumber(after) || after > 1_000_000 ||
    (after === 0 && expectedEpoch !== '') ||
    (after > 0 && !epochPattern.test(expectedEpoch)) ||
    !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid DSM historical receipt selector')
  }
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length !== allowedFields.size ||
    Object.keys(value).some(key => !allowedFields.has(key)) ||
    value.source_id !== sourceID || !validNumber(value.revision) ||
    value.revision < 1 || value.authoritative !== false ||
    !['partial', 'uncertain', 'paused', 'cancelled'].includes(String(value.run_state)) ||
    typeof value.page_epoch !== 'string' || !epochPattern.test(value.page_epoch) ||
    (after > 0 && value.page_epoch !== expectedEpoch) ||
    typeof value.has_more !== 'boolean' ||
    !receiptCounts.every(key => validNumber(value[key]) && (value[key] as number) <= 16) ||
    !validNumber(value.next_after_file) || value.next_after_file > 1_000_000) {
    throw new Error('Unsafe DSM historical receipt response')
  }
  const reviewed = value.reviewed_files as number
  if (reviewed !== (value.ignored_files as number) +
      (value.unsupported_files as number) + (value.unrecorded_files as number) +
      (value.historical_committed_files as number) + (value.pending_original_files as number) ||
    value.historical_committed_files !== (value.current_node_metadata_match_files as number) +
      (value.current_node_metadata_mismatch_files as number) ||
    (value.has_more
      ? reviewed !== 16 || value.next_after_file !== after + reviewed
      : value.next_after_file !== 0)) {
    throw new Error('Inconsistent DSM historical receipt counts or cursor')
  }
  // Return only the fixed, verified schema; never forward unknown Agent data.
  return {
    source_id: sourceID,
    revision: value.revision as number,
    run_state: value.run_state as XDriveLocalBackupRecoveryReview['run_state'],
    reviewed_files: reviewed,
    ignored_files: value.ignored_files as number,
    unsupported_files: value.unsupported_files as number,
    unrecorded_files: value.unrecorded_files as number,
    historical_committed_files: value.historical_committed_files as number,
    current_node_metadata_match_files: value.current_node_metadata_match_files as number,
    current_node_metadata_mismatch_files: value.current_node_metadata_mismatch_files as number,
    pending_original_files: value.pending_original_files as number,
    next_after_file: value.next_after_file as number,
    page_epoch: value.page_epoch,
    has_more: value.has_more as boolean,
    authoritative: false,
  }
}
