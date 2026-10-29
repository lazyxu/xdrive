/**
 * Action availability for the owning device's local-folder Push feature.
 * Browser/Web/PWA and foreign-device views remain observers even when they
 * receive the same redacted DeviceBackup page. A port's presence alone is
 * never proof of device ownership or a Server authorization grant.
 *
 * This is presentation admission only: the owning Agent and Server MUST
 * revalidate device credentials, Root, Source revision and Owner per request.
 */
export type XDriveLocalBackupFeatureAction =
  | 'run' | 'schedule' | 'rename' | 'target' | 'mode' | 'rules'
  | 'preview' | 'snapshot' | 'firstFile' | 'delta' | 'evidence'
  | 'evidenceSummary' | 'evidencePreflight' | 'remove'

export type XDriveLocalBackupFeatureAccess =
  Readonly<Record<XDriveLocalBackupFeatureAction, boolean>>

export function xDriveLocalBackupFeatureAccess({
  currentLocalDevice, backupMode, supported,
}: {
  /** Exact, current, Agent-verified local device ID matching an unrevoked Server device row. */
  currentLocalDevice: boolean
  /** Only Backup can run the common batch or legacy first-file operation. */
  backupMode: boolean
  /** Presence of actual owning-Agent domain ports, never synthetic success. */
  supported: XDriveLocalBackupFeatureAccess
}): XDriveLocalBackupFeatureAccess {
  const current = currentLocalDevice === true
  return {
    run: current && backupMode && supported.run,
    schedule: current && supported.schedule,
    rename: current && supported.rename,
    target: current && supported.target,
    mode: current && supported.mode,
    rules: current && supported.rules,
    preview: current && supported.preview,
    snapshot: current && supported.snapshot,
    // The legacy first-file action is a fallback, never a parallel writer.
    firstFile: current && backupMode && supported.firstFile && !supported.run,
    delta: current && supported.delta,
    evidence: current && supported.evidence,
    evidenceSummary: current && supported.evidenceSummary,
    evidencePreflight: current && supported.evidencePreflight,
    remove: current && supported.remove,
  }
}
