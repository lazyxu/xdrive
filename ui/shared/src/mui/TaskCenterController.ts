import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  XDRIVE_BACKGROUND_TASK_LIMIT,
  xDriveActiveFileOperationCount,
  xDriveBackgroundTaskPollIntervalMs,
  xDriveBackgroundTaskSummaryPollIntervalMs,
  xDriveFileOperationHasHistory,
} from '..'
import type {
  XDriveBackgroundTask,
  XDriveBackgroundTaskActiveSummary,
  XDriveBackgroundTaskControlAction,
  XDriveFileOperation,
  XDriveFileOperationConflictResolution,
} from '..'
import { xDriveActiveTransferCount, xDriveTransferHasHistory } from '../transfers'
import type { XDriveTransferTask } from '../transfers'
import type { XDriveTaskCenterPageProps } from './TaskCenterPage'

export type XDriveTaskCenterOperationActions = {
  busy: boolean
  cancellingID: string
  retryingID: string
  undoingID: string
  redoingID: string
  resolvingID: string
  resolvingPolicy: XDriveFileOperationConflictResolution | ''
  clearHistoryLoading: boolean
  cancelOperation: (id: string) => Promise<boolean>
  retryOperation: (id: string) => Promise<boolean>
  undoOperation: (id: string) => Promise<boolean>
  redoOperation: (id: string) => Promise<boolean>
  resolveConflict: (id: string, policy: XDriveFileOperationConflictResolution) => Promise<boolean>
  clearHistory: () => Promise<boolean>
}

export type XDriveBackgroundTaskScope = 'mine' | 'global'

export type XDriveBackgroundTaskPort = {
  loadActiveSummary?: () => Promise<XDriveBackgroundTaskActiveSummary>
  loadMine: (limit: number) => Promise<readonly XDriveBackgroundTask[]>
  loadGlobal?: (limit: number) => Promise<readonly XDriveBackgroundTask[]>
  control?: (
    taskID: string,
    action: XDriveBackgroundTaskControlAction,
    global: boolean,
  ) => Promise<unknown>
}

function useXDriveBackgroundTaskActiveSummary({
  port,
  enabled,
}: {
  port?: XDriveBackgroundTaskPort
  enabled: boolean
}) {
  const [summary, setSummary] = useState<XDriveBackgroundTaskActiveSummary>()

  const refresh = useCallback(async () => {
    if (!enabled || !port?.loadActiveSummary) {
      setSummary(undefined)
      return
    }
    try {
      setSummary(await port.loadActiveSummary())
    } catch {
      setSummary(undefined)
    }
  }, [enabled, port])

  const pollIntervalMs = useMemo(
    () => xDriveBackgroundTaskSummaryPollIntervalMs(summary),
    [summary],
  )

  useEffect(() => {
    if (!enabled || !port?.loadActiveSummary) {
      setSummary(undefined)
      return
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, pollIntervalMs, port, refresh])

  return { summary, refresh }
}

function useXDriveBackgroundTasks({
  port,
  enabled,
  visible,
  globalEnabled,
  scope,
  onError,
}: {
  port?: XDriveBackgroundTaskPort
  enabled: boolean
  visible: boolean
  globalEnabled: boolean
  scope: XDriveBackgroundTaskScope
  onError?: (error: unknown) => void
}) {
  const [mine, setMine] = useState<XDriveBackgroundTask[]>([])
  const [globalTasks, setGlobalTasks] = useState<XDriveBackgroundTask[]>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [globalLoading, setGlobalLoading] = useState(false)

  const effectiveScope: XDriveBackgroundTaskScope =
    scope === 'global' && globalEnabled && port?.loadGlobal ? 'global' : 'mine'

  const refresh = useCallback(async () => {
    if (!port || !enabled || !visible) return

    if (effectiveScope === 'global' && port.loadGlobal) {
      setGlobalLoading(true)
      try {
        setGlobalTasks([...(await port.loadGlobal(XDRIVE_BACKGROUND_TASK_LIMIT))])
      } catch (error) {
        onError?.(error)
      } finally {
        setGlobalLoading(false)
      }
      return
    }

    setMineLoading(true)
    try {
      setMine([...(await port.loadMine(XDRIVE_BACKGROUND_TASK_LIMIT))])
    } catch (error) {
      onError?.(error)
    } finally {
      setMineLoading(false)
    }
  }, [effectiveScope, enabled, onError, port, visible])

  const visibleTasks = effectiveScope === 'global' ? globalTasks : mine
  const pollIntervalMs = useMemo(
    () => xDriveBackgroundTaskPollIntervalMs(visibleTasks),
    [visibleTasks],
  )

  useEffect(() => {
    if (!enabled || !port) {
      setMine([])
      setGlobalTasks([])
      setMineLoading(false)
      setGlobalLoading(false)
      return
    }
    if (!visible) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, pollIntervalMs, port, refresh, visible])

  return {
    mine,
    globalTasks,
    mineLoading,
    globalLoading,
    effectiveScope,
    refresh,
  }
}

export function useXDriveTaskCenterController({
  transfers,
  operations,
  operationActions,
  externalBusy = false,
  transferRetryingID = '',
  transferRetryDisabled = false,
  onRetryTransfer,
  conflictResolutionEnabled = true,
  backgroundTaskPort,
  backgroundTasksEnabled = false,
  backgroundTasksVisible = false,
  globalTasksEnabled = false,
  onBackgroundTaskError,
}: {
  transfers: XDriveTransferTask[]
  operations: XDriveFileOperation[]
  operationActions: XDriveTaskCenterOperationActions
  externalBusy?: boolean
  transferRetryingID?: string
  transferRetryDisabled?: boolean
  onRetryTransfer?: (id: string) => void | Promise<void>
  conflictResolutionEnabled?: boolean
  backgroundTaskPort?: XDriveBackgroundTaskPort
  backgroundTasksEnabled?: boolean
  backgroundTasksVisible?: boolean
  globalTasksEnabled?: boolean
  onBackgroundTaskError?: (error: unknown) => void
}) {
  const activeTransferCount = xDriveActiveTransferCount(transfers)
  const activeOperationCount = xDriveActiveFileOperationCount(operations)
  const hasHistory = xDriveTransferHasHistory(transfers) || xDriveFileOperationHasHistory(operations)
  const [backgroundScope, setBackgroundScope] = useState<XDriveBackgroundTaskScope>('mine')
  const [backgroundControlKey, setBackgroundControlKey] = useState('')

  useEffect(() => {
    if (!globalTasksEnabled && backgroundScope === 'global') {
      setBackgroundScope('mine')
    }
  }, [backgroundScope, globalTasksEnabled])

  const backgroundSummary = useXDriveBackgroundTaskActiveSummary({
    port: backgroundTaskPort,
    enabled: backgroundTasksEnabled,
  })
  const summaryFileOperationCount =
    backgroundSummary.summary?.file_operation ?? 0
  const activeBackgroundCount = backgroundSummary.summary
    ? backgroundSummary.summary.active_total -
      summaryFileOperationCount +
      Math.max(summaryFileOperationCount, activeOperationCount)
    : activeOperationCount
  const badgeCount = activeTransferCount + activeBackgroundCount

  const background = useXDriveBackgroundTasks({
    port: backgroundTaskPort,
    enabled: backgroundTasksEnabled,
    visible: backgroundTasksVisible,
    globalEnabled: globalTasksEnabled,
    scope: backgroundScope,
    onError: onBackgroundTaskError,
  })

  const controlBackgroundTask = useCallback(async (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => {
    if (!backgroundTaskPort?.control || backgroundControlKey) return
    const global = background.effectiveScope === 'global'
    const key = `${task.id}:${action}`
    setBackgroundControlKey(key)
    try {
      await backgroundTaskPort.control(task.id, action, global)
      await Promise.all([
        background.refresh(),
        backgroundSummary.refresh(),
      ])
    } catch (error) {
      onBackgroundTaskError?.(error)
    } finally {
      setBackgroundControlKey('')
    }
  }, [
    background.effectiveScope,
    background.refresh,
    backgroundControlKey,
    backgroundTaskPort,
    backgroundSummary.refresh,
    onBackgroundTaskError,
  ])

  const pageProps: XDriveTaskCenterPageProps = {
    transfers,
    operations,
    backgroundTasks: background.mine,
    globalBackgroundTasks: background.globalTasks,
    backgroundTasksLoading: background.mineLoading,
    globalBackgroundTasksLoading: background.globalLoading,
    backgroundTasksAvailable: Boolean(backgroundTaskPort) && backgroundTasksEnabled,
    globalTasksEnabled: Boolean(backgroundTaskPort?.loadGlobal) && globalTasksEnabled,
    backgroundScope: background.effectiveScope,
    onBackgroundScopeChange: setBackgroundScope,
    backgroundControlKey,
    onBackgroundTaskControl: backgroundTaskPort?.control
      ? (task, action) => { void controlBackgroundTask(task, action) }
      : undefined,
    clearHistory: {
      disabled: !hasHistory || externalBusy || operationActions.busy,
      loading: operationActions.clearHistoryLoading,
      onClear: () => { void operationActions.clearHistory() },
    },
    transferRetryingID,
    transferRetryDisabled,
    operationCancellingID: operationActions.cancellingID,
    operationRetryingID: operationActions.retryingID,
    operationUndoingID: operationActions.undoingID,
    operationRedoingID: operationActions.redoingID,
    operationResolvingID: operationActions.resolvingID,
    operationResolvingPolicy: operationActions.resolvingPolicy,
    operationDisabled: operationActions.busy,
    onRetryTransfer: onRetryTransfer ? (id) => { void onRetryTransfer(id) } : undefined,
    onCancelOperation: (id) => { void operationActions.cancelOperation(id) },
    onRetryOperation: (id) => { void operationActions.retryOperation(id) },
    onUndoOperation: (id) => { void operationActions.undoOperation(id) },
    onRedoOperation: (id) => { void operationActions.redoOperation(id) },
    onResolveOperationConflict: conflictResolutionEnabled
      ? (id, policy) => { void operationActions.resolveConflict(id, policy) }
      : undefined,
  }

  return {
    activeTransferCount,
    activeOperationCount,
    activeBackgroundCount,
    badgeCount,
    badge: badgeCount || undefined,
    hasHistory,
    backgroundTasks: background.mine,
    globalBackgroundTasks: background.globalTasks,
    backgroundScope: background.effectiveScope,
    refreshBackgroundTasks: background.refresh,
    pageProps,
  }
}
