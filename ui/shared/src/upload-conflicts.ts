export const xDriveUploadConflictPreflightBatchSize = 200

export type XDriveUploadConflictPolicy = 'fail' | 'skip' | 'keep_both' | 'overwrite'

export type XDriveUploadConflictResolution = Exclude<XDriveUploadConflictPolicy, 'fail'>

export type XDriveUploadConflictPreflight = {
  conflict: boolean
  target_type?: 'file' | 'dir'
  can_overwrite?: boolean
  error?: string
}

export function xDriveUploadConflictCanOverwrite(
  preflight: XDriveUploadConflictPreflight,
) {
  return preflight.conflict &&
    preflight.target_type === 'file' &&
    preflight.can_overwrite === true
}

export type XDriveUploadConflictDecision = XDriveUploadConflictResolution | 'cancel'

export type XDriveUploadBatchSummaryInput = {
  uploaded: number
  skipped: number
  failed: number
  cancelled?: boolean
}

export function xDriveUploadBatchSummary({
  uploaded,
  skipped,
  failed,
  cancelled = false,
}: XDriveUploadBatchSummaryInput) {
  const parts: string[] = []
  if (uploaded > 0) parts.push(`已上传 ${uploaded} 个文件`)
  if (skipped > 0) parts.push(`跳过 ${skipped} 个同名文件`)
  if (failed > 0) parts.push(`${failed} 个失败`)
  if (cancelled) parts.push('已取消剩余上传')
  if (parts.length === 0) return null
  return {
    tone: skipped > 0 || failed > 0 || cancelled ? 'warning' as const : 'good' as const,
    message: `${parts.join('，')}。`,
  }
}
