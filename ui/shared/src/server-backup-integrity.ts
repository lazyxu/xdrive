import type {
  XDriveServerBackupHistoryEntry, XDriveServerBackupPage,
  XDriveServerBackupSnapshot,
} from './server-backup-admin'

/**
 * Counts only Host-discovered snapshots. A structurally complete generation or
 * a previous successful verification is never treated as current integrity
 * evidence: bytes can change after the last receipt.
 */
export type XDriveServerBackupIntegritySummary = {
  snapshots: number
  fullCandidates: number
  databaseOnly: number
  incomplete: number
  inconsistent: number
  historicalPassed: number
  historicalFailed: number
  withoutRecentReceipt: number
  newestFullID: string | null
  needsAttention: boolean
}

export function summarizeServerBackupIntegrity(
  page: XDriveServerBackupPage,
): XDriveServerBackupIntegritySummary {
  const snapshots = page.inventory.snapshots
  const lastVerify = new Map<string, XDriveServerBackupHistoryEntry>()
  for (const entry of page.history || []) {
    if (entry.action !== 'verify' || !entry.snapshot_id) continue
    const previous = lastVerify.get(entry.snapshot_id)
    // Host currently writes newest first; compare timestamps anyway so a
    // reordered but otherwise valid bounded history cannot show stale success.
    if (!previous || (entry.finished_at || '') > (previous.finished_at || '')) {
      lastVerify.set(entry.snapshot_id, entry)
    }
  }

  let fullCandidates = 0
  let databaseOnly = 0
  let incomplete = 0
  let inconsistent = 0
  let historicalPassed = 0
  let historicalFailed = 0
  let withoutRecentReceipt = 0
  let newestFull: XDriveServerBackupSnapshot | undefined

  for (const snapshot of snapshots) {
    if (snapshot.state === 'inconsistent') {
      inconsistent++
    } else if (snapshot.state !== 'complete') {
      incomplete++
    } else if (!snapshot.file_data_included) {
      databaseOnly++
    } else {
      fullCandidates++
      if (!newestFull || snapshot.created_at > newestFull.created_at) {
        newestFull = snapshot
      }
    }

    const receipt = lastVerify.get(snapshot.id)
    if (!receipt) {
      withoutRecentReceipt++
    } else if (receipt.state === 'success') {
      historicalPassed++
    } else {
      historicalFailed++
    }
  }

  return {
    snapshots: snapshots.length,
    fullCandidates,
    databaseOnly,
    incomplete,
    inconsistent,
    historicalPassed,
    historicalFailed,
    withoutRecentReceipt,
    newestFullID: newestFull?.id || null,
    needsAttention: fullCandidates === 0 || incomplete > 0 ||
      inconsistent > 0 || historicalFailed > 0,
  }
}
