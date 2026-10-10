import { useEffect, useRef, useState } from 'react'
import {
  xDriveUploadBatchSummary,
  xDriveUploadConflictCanOverwrite,
  xDriveUploadConflictPreflightBatchSize,
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
  startChildren?: (groupID: string, inputs: readonly {
    fileName: string
    relativePath: string
    bytesTotal: number
  }[]) => readonly string[] | Promise<readonly string[]>
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
  lifecycleKey,
  disabled = false,
  continueOnUploadError = false,
  trackProgress = false,
  fileName,
  fileSize = () => 0,
  preflight,
  preflightBatch,
  upload,
  transferLifecycle,
  onError,
  onFeedback,
}: {
  lifecycleKey: string
  disabled?: boolean
  continueOnUploadError?: boolean
  trackProgress?: boolean
  fileName: (file: TFile) => string
  fileSize?: (file: TFile) => number
  preflight: (
    parentID: number,
    file: TFile,
  ) => Promise<XDriveUploadConflictPreflight>
  preflightBatch?: (
    targets: readonly XDriveFileExplorerUploadTarget<TFile>[],
  ) => Promise<readonly XDriveUploadConflictPreflight[]>
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
  const busyActionRef = useRef<XDriveFileExplorerUploadBusyAction>('')
  const [progress, setProgress] = useState<number | null>(null)
  const lifecycleGenerationRef = useRef(1)

  const isCurrentLifecycle = (generation: number) => (
    generation === lifecycleGenerationRef.current
  )

  useEffect(() => {
    lifecycleGenerationRef.current += 1
    busyActionRef.current = ''
    setBusyAction('')
    setProgress(null)
    conflicts.reset()
    return () => {
      lifecycleGenerationRef.current += 1
      busyActionRef.current = ''
    }
  }, [lifecycleKey])

  const loadBatchPreflights = async (
    targets: readonly XDriveFileExplorerUploadTarget<TFile>[],
    lifecycleGeneration?: number,
  ): Promise<Map<number, XDriveUploadConflictPreflight> | null> => {
    if (
      lifecycleGeneration !== undefined &&
      !isCurrentLifecycle(lifecycleGeneration)
    ) return null
    if (!preflightBatch || targets.length < 2) return null

    const keys = targets.map((target) => (
      `${target.parentID}\n${fileName(target.file).trim().toLowerCase()}`
    ))
    const counts = new Map<string, number>()
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
    const candidateIndices = keys
      .map((key, index) => counts.get(key) === 1 ? index : -1)
      .filter((index) => index >= 0)
    if (candidateIndices.length < 2) return new Map()

    const out = new Map<number, XDriveUploadConflictPreflight>()
    try {
      for (
        let start = 0;
        start < candidateIndices.length;
        start += xDriveUploadConflictPreflightBatchSize
      ) {
        const indices = candidateIndices.slice(
          start,
          start + xDriveUploadConflictPreflightBatchSize,
        )
        const batch = await preflightBatch(indices.map((index) => targets[index]))
        if (
          lifecycleGeneration !== undefined &&
          !isCurrentLifecycle(lifecycleGeneration)
        ) return null
        if (batch.length !== indices.length) return null
        batch.forEach((result, offset) => out.set(indices[offset], result))
      }
      return out
    } catch {
      return null
    }
  }

  const preflightTarget = async (
    target: XDriveFileExplorerUploadTarget<TFile>,
    batch: Map<number, XDriveUploadConflictPreflight> | null,
    index: number,
  ) => {
    const result = batch?.get(index) ?? await preflight(target.parentID, target.file)
    if (result.error) throw new Error(result.error)
    return result
  }

  const runTargets = async (
    targets: readonly XDriveFileExplorerUploadTarget<TFile>[],
    action: Exclude<XDriveFileExplorerUploadBusyAction, ''> = 'upload',
  ): Promise<XDriveFileExplorerUploadBatchResult> => {
    const lifecycleGeneration = lifecycleGenerationRef.current
    if (targets.length === 0 || disabled || busyActionRef.current) return idleResult()
    busyActionRef.current = action
    if (!conflicts.beginBatch()) {
      busyActionRef.current = ''
      return idleResult(false, true)
    }

    setBusyAction(action)
    let uploaded = 0
    let skipped = 0
    let failed = 0
    let cancelled = false
    let fatalError: unknown = null

    try {
      const batchPreflights = await loadBatchPreflights(targets, lifecycleGeneration)
      if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]
        const name = fileName(target.file)
        let conflictPolicy: XDriveUploadConflictPolicy = 'fail'
        let conflict: XDriveUploadConflictPreflight

        try {
          conflict = await preflightTarget(target, batchPreflights, index)
        } catch (error) {
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
          fatalError = error
          break
        }
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)

        if (conflict.conflict) {
          const decision = await conflicts.resolveConflict(name, {
            canOverwrite: xDriveUploadConflictCanOverwrite(conflict),
          })
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
          if (trackProgress && isCurrentLifecycle(lifecycleGeneration)) setProgress(0)
          const result = await upload(
            target.parentID,
            target.file,
            conflictPolicy,
            trackProgress
              ? (percent) => {
                  if (isCurrentLifecycle(lifecycleGeneration)) setProgress(percent)
                }
              : undefined,
          )
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
          if (result.skipped) skipped += 1
          else uploaded += 1
        } catch (error) {
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
          if (continueOnUploadError) {
            failed += 1
            continue
          }
          fatalError = error
          break
        } finally {
          if (trackProgress && isCurrentLifecycle(lifecycleGeneration)) setProgress(null)
        }
      }
    } finally {
      if (isCurrentLifecycle(lifecycleGeneration)) {
        conflicts.endBatch()
        busyActionRef.current = ''
        setBusyAction('')
        if (trackProgress) setProgress(null)
      }
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
    const lifecycleGeneration = lifecycleGenerationRef.current
    if (disabled || busyActionRef.current) return idleResult()

    const knownItems = Math.max(0, itemsTotal)
    const knownBytes = Math.max(0, bytesTotal)
    if (!transferLifecycle) {
      // An older Agent may not support hierarchical transfer records. Claim
      // the same upload lane before asynchronous directory enumeration: a
      // second same-render intent must not scan or overtake this upload.
      busyActionRef.current = action
      setBusyAction(action)
      let handedToTargets = false
      try {
        const targets = await resolveTargets()
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
        // Handoff is synchronous. No other UI handler runs between releasing
        // the scan claim and runTargets claiming its upload/conflict batch.
        busyActionRef.current = ''
        setBusyAction('')
        if (targets.length === 0) return idleResult()
        handedToTargets = true
        return runTargets(targets, action)
      } catch (error) {
        if (isCurrentLifecycle(lifecycleGeneration)) onError(error)
        return idleResult(true)
      } finally {
        if (!handedToTargets && isCurrentLifecycle(lifecycleGeneration)) {
          busyActionRef.current = ''
          setBusyAction('')
        }
      }
    }

    busyActionRef.current = action
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
      if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)

      const targets = await resolveTargets()
      if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
      const childSizes = targets.map((target) => Math.max(0, fileSize(target.file)))
      const totalBytes = childSizes.reduce((sum, size) => sum + size, 0)
      let groupBytesDone = 0

      const childInputs = targets.map((target, index) => ({
        fileName: fileName(target.file),
        relativePath: target.relativePath || fileName(target.file),
        bytesTotal: childSizes[index],
      }))
      if (transferLifecycle.startChildren && childInputs.length > 0) {
        const registeredChildIDs = await transferLifecycle.startChildren(groupID, childInputs)
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
        if (registeredChildIDs.length !== targets.length) {
          throw new Error('传输子任务数量不匹配。')
        }
        childIDs.push(...registeredChildIDs)
      } else {
        for (let index = 0; index < childInputs.length; index += 1) {
          const childID = await transferLifecycle.startChild(groupID, childInputs[index])
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
          childIDs.push(childID)
        }
      }

      const groupProgress = (): XDriveFileExplorerUploadTransferGroupProgress => ({
        scanComplete: true,
        bytesDone: groupBytesDone,
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
      if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)

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
      const batchPreflights = await loadBatchPreflights(targets, lifecycleGeneration)
      if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]
        const childID = childIDs[index]
        const name = fileName(target.file)
        let conflictPolicy: XDriveUploadConflictPolicy = 'fail'
        let childBytesDone = 0

        aggregate.running = 1
        await transferLifecycle.begin(childID)
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
        await transferLifecycle.updateGroup(groupID, groupProgress())
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)

        let conflict: XDriveUploadConflictPreflight
        try {
          conflict = await preflightTarget(target, batchPreflights, index)
        } catch (error) {
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)

        if (conflict.conflict) {
          const decision = await conflicts.resolveConflict(name, {
            canOverwrite: xDriveUploadConflictCanOverwrite(conflict),
          })
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
            if (!isCurrentLifecycle(lifecycleGeneration)) return
            const normalized = Math.max(0, Math.min(100, percent || 0))
            const nextChildDone = childSizes[index] * normalized / 100
            groupBytesDone += nextChildDone - childBytesDone
            childBytesDone = nextChildDone
            if (trackProgress) setProgress(normalized)
            void Promise.resolve(
              transferLifecycle.progress(childID, childBytesDone, childSizes[index]),
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
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
            groupBytesDone += childSizes[index] - childBytesDone
            childBytesDone = childSizes[index]
            await transferLifecycle.progress(childID, childBytesDone, childSizes[index])
            await transferLifecycle.finish(childID, { state: 'completed' })
          }
          terminalChildren.add(childID)
        } catch (error) {
          if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
          if (trackProgress && isCurrentLifecycle(lifecycleGeneration)) setProgress(null)
        }
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
        await transferLifecycle.updateGroup(groupID, groupProgress())
        if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
      if (!isCurrentLifecycle(lifecycleGeneration)) return idleResult(true, true)
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
      if (isCurrentLifecycle(lifecycleGeneration)) {
        if (batchStarted) conflicts.endBatch()
        busyActionRef.current = ''
        setBusyAction('')
        if (trackProgress) setProgress(null)
      }
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
