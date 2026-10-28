import type { XDriveServerBackupRetention } from './server-backup-admin'

// A retention plan contains logical byte estimates, never physical disk blocks.
// Host versions may omit component fields. Do not silently turn missing,
// negative, fractional or >Number.MAX_SAFE_INTEGER values into zero.
const safeCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

export type XDriveBackupRetentionCapacity = {
  snapshotBytes: number | null
  exclusiveCASBytes: number | null
  unreferencedCASBytes: number | null
  potentialLogicalBytes: number | null
  retainedObjects: number | null
  exclusiveObjects: number | null
  unreferencedObjects: number | null
  committedSnapshots: number | null
  /** True only when every component is measured and agrees with the total. */
  componentsComplete: boolean
  totalsConsistent: boolean | null
  integrityMode: 'fast' | 'deep' | 'unknown'
}

export function backupRetentionCapacity(
  plan: XDriveServerBackupRetention,
): XDriveBackupRetentionCapacity {
  const snapshotBytes = safeCount(plan.drop_snapshot_bytes)
  const exclusiveCASBytes = safeCount(plan.drop_only_object_bytes)
  const unreferencedCASBytes = safeCount(plan.unreferenced_bytes)
  const total = safeCount(plan.potential_logical_bytes)
  const componentsComplete = [snapshotBytes, exclusiveCASBytes, unreferencedCASBytes]
    .every(value => value !== null)
  const sum = componentsComplete
    ? (snapshotBytes as number) + (exclusiveCASBytes as number) + (unreferencedCASBytes as number)
    : null
  const totalsConsistent = sum === null || total === null
    ? null
    : Number.isSafeInteger(sum) && sum === total
  return {
    snapshotBytes,
    exclusiveCASBytes,
    unreferencedCASBytes,
    potentialLogicalBytes: total,
    retainedObjects: safeCount(plan.retained_objects),
    exclusiveObjects: safeCount(plan.drop_only_objects),
    unreferencedObjects: safeCount(plan.unreferenced_objects),
    committedSnapshots: safeCount(plan.committed_snapshots),
    componentsComplete,
    totalsConsistent,
    integrityMode:
      plan.validation === 'snapshot_sha256_and_full_cas_sha256' ? 'deep'
        : plan.validation === 'snapshot_sha256_and_cas_size' ? 'fast' : 'unknown',
  }
}
