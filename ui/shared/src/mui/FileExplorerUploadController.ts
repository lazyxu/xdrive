import { useState } from 'react'
import {
  xDriveUploadBatchSummary,
  xDriveUploadConflictCanOverwrite,
} from '../upload-conflicts'
import type {
  XDriveUploadConflictPolicy,
  XDriveUploadConflictPreflight,
} from '../upload-conflicts'
import { useXDriveUploadConflictResolver } from './UploadConflictDialog'

export type XDriveFileExplorerUploadBusyAction =
  | ''
  | 'upload'
  | 'drop-upload'
  | 'upload-folder'

export type XDriveFileExplorerUploadTarget<TFile> = {
  parentID: number
  file: TFile
}

export type XDriveFileExplorerUploadBatchResult = {
  started: boolean
  uploaded: number
  skipped: number
  failed: number
  cancelled: boolean
}

export type XDriveFileExplorerUploadResult = {
  skipped: boolean
}

const idleResult = (
  started = false,
  cancelled = false,
): XDriveFileExplorerUploadBatchResult => ({
  started,
  uploaded: 0,
  skipped: 0,
  failed: 0,
  cancelled,
})

export function useXDriveFileExplorerUploadController<TFile>({
  disabled = false,
  continueOnUploadError = false,
  trackProgress = false,
  fileName,
  preflight,
  upload,
  onError,
  onFeedback,
}: {
  disabled?: boolean
  continueOnUploadError?: boolean
  trackProgress?: boolean
  fileName: (file: TFile) => string
  preflight: (
    parentID: number,
    file: TFile,
  ) => Promise<XDriveUploadConflictPreflight>
  upload: (
    parentID: number,
    file: TFile,
    conflictPolicy: XDriveUploadConflictPolicy,
    onProgress?: (percent: number) => void,
  ) => Promise<XDriveFileExplorerUploadResult>
  onError: (error: unknown) => void
  onFeedback: (tone: 'good' | 'warning', message: string) => void
}) {
  const conflicts = useXDriveUploadConflictResolver()
  const [busyAction, setBusyAction] = useState<XDriveFileExplorerUploadBusyAction>('')
  const [progress, setProgress] = useState<number | null>(null)

  const runTargets = async (
    targets: readonly XDriveFileExplorerUploadTarget<TFile>[],
    action: Exclude<XDriveFileExplorerUploadBusyAction, ''> = 'upload',
  ): Promise<XDriveFileExplorerUploadBatchResult> => {
    if (targets.length === 0 || disabled || busyAction) return idleResult()
    if (!conflicts.beginBatch()) return idleResult(false, true)

    setBusyAction(action)
    let uploaded = 0
    let skipped = 0
    let failed = 0
    let cancelled = false
    let fatalError: unknown = null

    try {
      for (const target of targets) {
        const name = fileName(target.file)
        let conflictPolicy: XDriveUploadConflictPolicy = 'fail'
        let conflict: XDriveUploadConflictPreflight

        try {
          conflict = await preflight(target.parentID, target.file)
        } catch (error) {
          fatalError = error
          break
        }

        if (conflict.conflict) {
          const decision = await conflicts.resolveConflict(name, {
            canOverwrite: xDriveUploadConflictCanOverwrite(conflict),
          })
          if (decision === 'cancel') {
            cancelled = true
            break
          }
          conflictPolicy = decision
        }

        if (conflictPolicy === 'skip') {
          skipped += 1
          continue
        }

        try {
          if (trackProgress) setProgress(0)
          const result = await upload(
            target.parentID,
            target.file,
            conflictPolicy,
            trackProgress ? setProgress : undefined,
          )
          if (result.skipped) skipped += 1
          else uploaded += 1
        } catch (error) {
          if (continueOnUploadError) {
            failed += 1
            continue
          }
          fatalError = error
          break
        } finally {
          if (trackProgress) setProgress(null)
        }
      }
    } finally {
      conflicts.endBatch()
      setBusyAction('')
      if (trackProgress) setProgress(null)
    }

    const result = {
      started: true,
      uploaded,
      skipped,
      failed,
      cancelled,
    }

    if (fatalError) {
      onError(fatalError)
      return result
    }

    const summary = xDriveUploadBatchSummary(result)
    if (summary) onFeedback(summary.tone, summary.message)
    return result
  }

  return {
    busy: Boolean(busyAction),
    busyAction,
    progress,
    runTargets,
    dialogProps: conflicts.dialogProps,
  }
}
