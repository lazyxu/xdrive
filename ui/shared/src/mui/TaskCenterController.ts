import { useCallback, useEffect, useMemo, useState } from 'react'
import { XDRIVE_BACKGROUND_TASK_LIMIT, xDriveActiveFileOperationCount, xDriveBackgroundTaskPollIntervalMs, xDriveFileOperationHasHistory } from '..'
import type { XDriveBackgroundTask, XDriveFileOperation, XDriveFileOperationConflictResolution } from '..'
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
export type XDriveBackgroundTaskPort = {
  loadMine: (limit: number) => Promise<readonly XDriveBackgroundTask[]>
  loadGlobal?: (limit: number) => Promise<readonly XDriveBackgroundTask[]>
}
function useXDriveBackgroundTasks({ port, enabled, visible, globalEnabled }: {
  port?: XDriveBackgroundTaskPort
  enabled: boolean
  visible: boolean
  globalEnabled: boolean
}) {
  const [mine, setMine] = useState<XDriveBackgroundTask[]>([])
  const [globalTasks, setGlobalTasks] = useState<XDriveBackgroundTask[]>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [globalLoading, setGlobalLoading] = useState(false)
  const refresh = useCallback(async () => {
    if (!port || !enabled || !visible) return
    setMineLoading(true)
    if (globalEnabled && port.loadGlobal) setGlobalLoading(true)
    const [mineResult, globalResult] = await Promise.allSettled([
      port.loadMine(XDRIVE_BACKGROUND_TASK_LIMIT),
      globalEnabled && port.loadGlobal ? port.loadGlobal(XDRIVE_BACKGROUND_TASK_LIMIT) : Promise.resolve([] as readonly XDriveBackgroundTask[]),
    ])
    if (mineResult.status === 'fulfilled') setMine([...mineResult.value])
    if (globalResult.status === 'fulfilled') setGlobalTasks([...globalResult.value])
    setMineLoading(false)
    setGlobalLoading(false)
  }, [enabled, globalEnabled, port, visible])
  const pollIntervalMs = useMemo(() => xDriveBackgroundTaskPollIntervalMs([...mine, ...globalTasks]), [globalTasks, mine])
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
  return { mine, globalTasks, mineLoading, globalLoading, refresh }
}

export function useXDriveTaskCenterController({
  transfers, operations, operationActions, externalBusy = false,
  transferRetryingID = '', transferRetryDisabled = false, onRetryTransfer,
  conflictResolutionEnabled = true, backgroundTaskPort, backgroundTasksEnabled = false,
  backgroundTasksVisible = false, globalTasksEnabled = false,
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
}) {
  const activeTransferCount = xDriveActiveTransferCount(transfers)
  const activeOperationCount = xDriveActiveFileOperationCount(operations)
  const hasHistory = xDriveTransferHasHistory(transfers) || xDriveFileOperationHasHistory(operations)
  const badgeCount = activeTransferCount + activeOperationCount
  const background = useXDriveBackgroundTasks({ port: backgroundTaskPort, enabled: backgroundTasksEnabled, visible: backgroundTasksVisible, globalEnabled: globalTasksEnabled })
  const pageProps: XDriveTaskCenterPageProps = {
    transfers,
    operations,
    backgroundTasks: background.mine,
    globalBackgroundTasks: background.globalTasks,
    backgroundTasksLoading: background.mineLoading,
    globalBackgroundTasksLoading: background.globalLoading,
    backgroundTasksAvailable: Boolean(backgroundTaskPort) && backgroundTasksEnabled,
    globalTasksEnabled: Boolean(backgroundTaskPort?.loadGlobal) && globalTasksEnabled,
    clearHistory: {
      disabled: !hasHistory || externalBusy || operationActions.busy,
      loading: operationActions.clearHistoryLoading,
      onClear: () => { void operationActions.clearHistory() },
    },
    transferRetryingID, transferRetryDisabled,
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
    onResolveOperationConflict: conflictResolutionEnabled ? (id, policy) => { void operationActions.resolveConflict(id, policy) } : undefined,
  }
  return {
    activeTransferCount, activeOperationCount, badgeCount, badge: badgeCount || undefined, hasHistory,
    backgroundTasks: background.mine, globalBackgroundTasks: background.globalTasks,
    refreshBackgroundTasks: background.refresh, pageProps,
  }
}
