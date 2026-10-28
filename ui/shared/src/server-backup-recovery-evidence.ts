import type {
  XDriveServerBackupHistoryEntry, XDriveServerBackupPage,
} from './server-backup-admin'

export type XDriveBackupSnapshotEvidenceKind =
  'none' | 'complete_candidate' | 'database_only' | 'incomplete' | 'inconsistent'

/**
 * Historic Host receipts are not current byte integrity. In particular, a
 * successful destructive production restore is never relabeled as an isolated
 * recovery drill, and a successful CI artifact is never bound to this Host.
 */
export type XDriveBackupRecoveryEvidence = {
  snapshotKind: XDriveBackupSnapshotEvidenceKind
  snapshotName: string | null
  lastVerify: XDriveServerBackupHistoryEntry | null
  lastRestore: XDriveServerBackupHistoryEntry | null
  hostIsolatedDrill: 'not_verified'
  ciDrillForDeployedHost: 'not_attested'
}

function latestForSnapshot(
  history: XDriveServerBackupPage['history'],
  action: 'verify' | 'restore',
  snapshotID: string,
): XDriveServerBackupHistoryEntry | null {
  let latest: XDriveServerBackupHistoryEntry | null = null
  let latestTime = -Infinity
  for (const event of history || []) {
    if (event.action !== action || event.snapshot_id !== snapshotID) continue
    const time = Date.parse(event.finished_at || '')
    if (!Number.isFinite(time)) continue
    if (latest === null || time > latestTime) {
      latest = event
      latestTime = time
    }
  }
  return latest
}

export function selectServerBackupRecoveryEvidence(
  page: XDriveServerBackupPage,
  snapshotID: string,
): XDriveBackupRecoveryEvidence {
  const snapshot = page.inventory.snapshots.find(x => x.id === snapshotID)
  let snapshotKind: XDriveBackupSnapshotEvidenceKind = 'none'
  if (snapshot) {
    if (snapshot.state === 'inconsistent') snapshotKind = 'inconsistent'
    else if (snapshot.state !== 'complete') snapshotKind = 'incomplete'
    else if (!snapshot.file_data_included) snapshotKind = 'database_only'
    else snapshotKind = 'complete_candidate'
  }
  return {
    snapshotKind,
    snapshotName: snapshot?.name || null,
    lastVerify: snapshot ? latestForSnapshot(page.history, 'verify', snapshot.id) : null,
    lastRestore: snapshot ? latestForSnapshot(page.history, 'restore', snapshot.id) : null,
    hostIsolatedDrill: 'not_verified',
    ciDrillForDeployedHost: 'not_attested',
  }
}
