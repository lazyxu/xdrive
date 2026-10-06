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
  relativePath?: string
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

export type XDriveFileExplorerUploadTransferTerminalState =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type XDriveFileExplorerUploadTransferGroupProgress = {
  scanComplete: boolean
  bytesDone: number
  bytesTotal: number
  itemsTotal: number
  itemsCompleted: number
  itemsFailed: number
  itemsRunning: number
  itemsQueued: number
}

export type XDriveFileExplorerUploadTransferLifecycle = {
  startGroup: (input: {
    fileName: string
    path?: string
    bytesTotal: number
    itemsTotal: number
  }) => string | Promise<string>
  startChild: (groupID: string, input: {
    fileName: string
    relativePath: string
    bytesTotal: number
  }) => string | Promise<string>
  begin: (id: string, input?: {
    group?: XDriveFileExplorerUploadTransferGroupProgress
  }) => void | Promise<void>
  progress: (id: string, bytesDone: number, bytesTotal: number) => void | Promise<void>
  updateGroup: (
    id: string,
    progress: XDriveFileExplorerUploadTransferGroupProgress,
  ) => void | Promise<void>
  finish: (id: string, input: {
    state: XDriveFileExplorerUploadTransferTerminalState
    error?: string
    skipped?: boolean
  }) => void | Promise<void>
}

export type XDriveFileExplorerUploadGroupInput<TFile> = {
  label: string
  path?: string
  action?: Extract<XDriveFileExplorerUploadBusyAction, 'upload-folder' | 'drop-upload'>
  itemsTotal?: number
  bytesTotal?: number
  resolveTargets: () => Promise<readonly XDriveFileExplorerUploadTarget<TFile>[]>
}

export function xDriveFileExplorerUploadGroupLabel<TFile>(
  entries: readonly { file: TFile; relativePath?: string }[],
  fileName: (file: TFile) => string,
  fallback = '文件夹上传',
) {
  const roots = new Set(entries.map(({ file, relativePath }) => {
    const name = fileName(file)
    const normalized = (relativePath || name).replace(/\\/g, '/')
    const separator = normalized.indexOf('/')
    const root = (separator >= 0 ? normalized.slice(0, separator) : normalized).trim()
    return root || name
  }))
  return roots.size === 1 ? [...roots][0] : fallback
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '传输失败')
}

export function useXDriveFileExplorerUploadController<TFile>({
  disabled = false,
  continueOnUploadError = false,
  trackProgress = false,
  fileName,
  fileSize = () => 0,
  preflight,
  upload,
  transferLifecycle,
  onError,
  onFeedback,
}: {
  disabled?: boolean
  continueOnUploadError?: boolean
  trackProgress?: boolean
  fileName: (file: TFile) => string
  fileSize?: (file: TFile) => number
  preflight: (
    parentID: number,
    file: TFile,
  ) => Promise<XDriveUploadConflictPreflight>
  upload: (
    parentID: number,
    file: TFile,
    conflictPolicy: XDriveUploadConflictPolicy,
    onProgress?: (percent: number) => void,
    transferID?: string,
  ) => Promise<XDriveFileExplorerUploadResult>
  transferLifecycle?: XDriveFileExplorerUploadTransferLifecycle
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

  const runGroup = async ({
    label,
    path,
    action = 'upload-folder',
    itemsTotal = 0,
    bytesTotal = 0,
    resolveTargets,
  }: XDriveFileExplorerUploadGroupInput<TFile>): Promise<XDriveFileExplorerUploadBatchResult> => {
    if (disabled || busyAction) return idleResult()

    const knownItems = Math.max(0, itemsTotal)
    const knownBytes = Math.max(0, bytesTotal)
    if (!transferLifecycle) {
      try {
        return runTargets(await resolveTargets(), action)
      } catch (error) {
        onError(error)
        return idleResult(true)
      }
    }

    setBusyAction(action)
    let groupID = ''
    const childIDs: string[] = []
    const terminalChildren = new Set<string>()
    let batchStarted = false
    let aggregate = {
      uploaded: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
      processed: 0,
      running: 0,
    }

    const finishQuietly = async (
      id: string,
      input: {
        state: XDriveFileExplorerUploadTransferTerminalState
        error?: string
        skipped?: boolean
      },
    ) => {
      try {
        await transferLifecycle.finish(id, input)
      } catch {
        // Preserve the original upload/lifecycle error while best-effort closing the tree.
      }
    }

    try {
      groupID = await transferLifecycle.startGroup({
        fileName: label,
        path: path || label,
        bytesTotal: knownBytes,
        itemsTotal: knownItems,
      })

      const targets = await resolveTargets()
      const totalBytes = targets.reduce(
        (sum, target) => sum + Math.max(0, fileSize(target.file)),
        0,
      )
      const childDone = targets.map(() => 0)
      const childSizes = targets.map((target) => Math.max(0, fileSize(target.file)))

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]
        childIDs.push(await transferLifecycle.startChild(groupID, {
          fileName: fileName(target.file),
          relativePath: target.relativePath || fileName(target.file),
          bytesTotal: childSizes[index],
        }))
      }

      const groupProgress = (): XDriveFileExplorerUploadTransferGroupProgress => ({
        scanComplete: true,
        bytesDone: childDone.reduce((sum, value) => sum + Math.max(0, value), 0),
        bytesTotal: totalBytes,
        itemsTotal: targets.length,
        itemsCompleted: aggregate.uploaded + aggregate.skipped,
        itemsFailed: aggregate.failed,
        itemsRunning: aggregate.running,
        itemsQueued: Math.max(
          0,
          targets.length - aggregate.processed - aggregate.running,
        ),
      })

      await transferLifecycle.begin(groupID, { group: groupProgress() })

      if (targets.length === 0) {
        await transferLifecycle.finish(groupID, { state: 'completed' })
        return idleResult(true)
      }

      if (!conflicts.beginBatch()) {
        for (const childID of childIDs) {
          await finishQuietly(childID, { state: 'cancelled' })
          terminalChildren.add(childID)
        }
        await transferLifecycle.finish(groupID, { state: 'cancelled' })
        return idleResult(true, true)
      }
      batchStarted = true

      let fatalError: unknown = null
      let firstFailure: unknown = null
      let stoppedAt = targets.length

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]
        const childID = childIDs[index]
        const name = fileName(target.file)
        let conflictPolicy: XDriveUploadConflictPolicy = 'fail'

        aggregate.running = 1
        await transferLifecycle.begin(childID)
        await transferLifecycle.updateGroup(groupID, groupProgress())

        let conflict: XDriveUploadConflictPreflight
        try {
          conflict = await preflight(target.parentID, target.file)
        } catch (error) {
          aggregate.running = 0
          aggregate.failed += 1
          aggregate.processed += 1
          firstFailure ??= error
          await transferLifecycle.finish(childID, {
            state: 'failed',
            error: errorMessage(error),
          })
          terminalChildren.add(childID)
          await transferLifecycle.updateGroup(groupID, groupProgress())
          fatalError = error
          stoppedAt = index + 1
          break
        }

        if (conflict.conflict) {
          const decision = await conflicts.resolveConflict(name, {
            canOverwrite: xDriveUploadConflictCanOverwrite(conflict),
          })
          if (decision === 'cancel') {
            aggregate.running = 0
            aggregate.cancelled = true
            await transferLifecycle.finish(childID, { state: 'cancelled' })
            terminalChildren.add(childID)
            stoppedAt = index + 1
            break
          }
          conflictPolicy = decision
        }

        if (conflictPolicy === 'skip') {
          aggregate.running = 0
          aggregate.skipped += 1
          aggregate.processed += 1
          await transferLifecycle.finish(childID, {
            state: 'completed',
            skipped: true,
          })
          terminalChildren.add(childID)
          await transferLifecycle.updateGroup(groupID, groupProgress())
          continue
        }

        try {
          const onProgress = (percent: number) => {
            const normalized = Math.max(0, Math.min(100, percent || 0))
            childDone[index] = childSizes[index] * normalized / 100
            if (trackProgress) setProgress(normalized)
            void Promise.resolve(
              transferLifecycle.progress(childID, childDone[index], childSizes[index]),
            ).catch(() => {})
            void Promise.resolve(
              transferLifecycle.updateGroup(groupID, groupProgress()),
            ).catch(() => {})
          }
          const result = await upload(
            target.parentID,
            target.file,
            conflictPolicy,
            onProgress,
            childID,
          )
          aggregate.running = 0
          aggregate.processed += 1
          if (result.skipped) {
            aggregate.skipped += 1
            await transferLifecycle.finish(childID, {
              state: 'completed',
              skipped: true,
            })
          } else {
            aggregate.uploaded += 1
            childDone[index] = childSizes[index]
            await transferLifecycle.progress(childID, childDone[index], childSizes[index])
            await transferLifecycle.finish(childID, { state: 'completed' })
          }
          terminalChildren.add(childID)
        } catch (error) {
          aggregate.running = 0
          aggregate.failed += 1
          aggregate.processed += 1
          firstFailure ??= error
          await finishQuietly(childID, {
            state: 'failed',
            error: errorMessage(error),
          })
          terminalChildren.add(childID)
          if (!continueOnUploadError) {
            fatalError = error
            stoppedAt = index + 1
            break
          }
        } finally {
          if (trackProgress) setProgress(null)
        }
        await transferLifecycle.updateGroup(groupID, groupProgress())
      }

      if (aggregate.cancelled || fatalError) {
        for (let index = stoppedAt; index < childIDs.length; index += 1) {
          const childID = childIDs[index]
          if (terminalChildren.has(childID)) continue
          await finishQuietly(childID, { state: 'cancelled' })
          terminalChildren.add(childID)
        }
      }

      await transferLifecycle.updateGroup(groupID, groupProgress())

      const completedCount = aggregate.uploaded + aggregate.skipped
      const state: XDriveFileExplorerUploadTransferTerminalState =
        aggregate.cancelled
          ? 'cancelled'
          : fatalError
            ? (completedCount > 0 ? 'partial' : 'failed')
            : aggregate.failed > 0
              ? (completedCount > 0 ? 'partial' : 'failed')
              : 'completed'

      await transferLifecycle.finish(groupID, {
        state,
        error: firstFailure ? errorMessage(firstFailure) : undefined,
      })

      const result = {
        started: true,
        uploaded: aggregate.uploaded,
        skipped: aggregate.skipped,
        failed: aggregate.failed,
        cancelled: aggregate.cancelled,
      }

      if (fatalError) {
        onError(fatalError)
        return result
      }
      const summary = xDriveUploadBatchSummary(result)
      if (summary) onFeedback(summary.tone, summary.message)
      return result
    } catch (error) {
      if (batchStarted) {
        conflicts.endBatch()
        batchStarted = false
      }
      for (const childID of childIDs) {
        if (terminalChildren.has(childID)) continue
        await finishQuietly(childID, { state: 'cancelled' })
      }
      if (groupID) {
        await finishQuietly(groupID, {
          state: 'failed',
          error: errorMessage(error),
        })
      }
      onError(error)
      return {
        ...idleResult(Boolean(groupID)),
        failed: groupID ? Math.max(1, aggregate.failed) : 0,
      }
    } finally {
      if (batchStarted) conflicts.endBatch()
      setBusyAction('')
      if (trackProgress) setProgress(null)
    }
  }

  return {
    busy: Boolean(busyAction),
    busyAction,
    progress,
    runTargets,
    runGroup,
    dialogProps: conflicts.dialogProps,
  }
}
