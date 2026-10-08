import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT,
  xDriveActiveFileOperationCount,
  xDriveBackgroundTaskPollIntervalMs,
  xDriveBackgroundTaskSummaryPollIntervalMs,
  xDriveFileOperationHasHistory,
  xDriveNormalizeBackgroundTaskPage,
} from '..'
import type {
  XDriveBackgroundTask,
  XDriveBackgroundTaskActiveSummary,
  XDriveBackgroundTaskControlAction,
  XDriveBackgroundTaskPage,
  XDriveFileOperation,
  XDriveFileOperationConflictResolution,
} from '..'
import { xDriveActiveTransferCount, xDriveNetworkTransferTasks, xDriveTransferHasHistory } from '../transfers'
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
  loadMinePage: (
    limit: number,
    cursor?: string,
  ) => Promise<XDriveBackgroundTaskPage>
  loadGlobalPage?: (
    limit: number,
    cursor?: string,
  ) => Promise<XDriveBackgroundTaskPage>
  control?: (
    taskID: string,
    action: XDriveBackgroundTaskControlAction,
    global: boolean,
  ) => Promise<unknown>
}

type XDriveBackgroundTaskPageState = {
  current: XDriveBackgroundTask[]
  history: XDriveBackgroundTask[]
  nextCursor: string
  loadedMore: boolean
}

function emptyBackgroundTaskPageState(): XDriveBackgroundTaskPageState {
  return {
    current: [],
    history: [],
    nextCursor: '',
    loadedMore: false,
  }
}

function mergeBackgroundTaskHistory(
  fresh: readonly XDriveBackgroundTask[],
  existing: readonly XDriveBackgroundTask[],
) {
  const seen = new Set<string>()
  const out: XDriveBackgroundTask[] = []
  for (const task of [...fresh, ...existing]) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    out.push(task)
  }
  return out
}

function appendBackgroundTaskHistory(
  existing: readonly XDriveBackgroundTask[],
  page: readonly XDriveBackgroundTask[],
) {
  const seen = new Set(existing.map((task) => task.id))
  const out = [...existing]
  for (const task of page) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    out.push(task)
  }
  return out
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
  const [mine, setMine] = useState<XDriveBackgroundTaskPageState>(
    emptyBackgroundTaskPageState,
  )
  const [globalTasks, setGlobalTasks] = useState<XDriveBackgroundTaskPageState>(
    emptyBackgroundTaskPageState,
  )
  const [mineLoading, setMineLoading] = useState(false)
  const [globalLoading, setGlobalLoading] = useState(false)
  const [mineLoadingMore, setMineLoadingMore] = useState(false)
  const [globalLoadingMore, setGlobalLoadingMore] = useState(false)

  const effectiveScope: XDriveBackgroundTaskScope =
    scope === 'global' && globalEnabled && port?.loadGlobalPage ? 'global' : 'mine'

  const visibleState = effectiveScope === 'global' ? globalTasks : mine
  const visibleTasks = [...visibleState.current, ...visibleState.history]
  const pollIntervalMs = useMemo(
    () => xDriveBackgroundTaskPollIntervalMs(visibleTasks),
    [visibleTasks],
  )

  const refresh = useCallback(async () => {
    if (!port || !enabled || !visible) return

    const global = effectiveScope === 'global'
    const load = global ? port.loadGlobalPage : port.loadMinePage
    if (!load) return

    if (global) setGlobalLoading(true)
    else setMineLoading(true)
    try {
      const page = xDriveNormalizeBackgroundTaskPage(
        await load(XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT),
      )
      const update = (
        previous: XDriveBackgroundTaskPageState,
      ): XDriveBackgroundTaskPageState => ({
        current: [...page.current_items],
        history: previous.loadedMore
          ? mergeBackgroundTaskHistory(page.history_items, previous.history)
          : [...page.history_items],
        nextCursor: previous.loadedMore
          ? previous.nextCursor
          : page.next_cursor ?? '',
        loadedMore: previous.loadedMore,
      })
      if (global) setGlobalTasks(update)
      else setMine(update)
    } catch (error) {
      onError?.(error)
    } finally {
      if (global) setGlobalLoading(false)
      else setMineLoading(false)
    }
  }, [effectiveScope, enabled, onError, port, visible])

  const loadMore = useCallback(async () => {
    if (!port || !enabled || !visible || !visibleState.nextCursor) return

    const global = effectiveScope === 'global'
    const load = global ? port.loadGlobalPage : port.loadMinePage
    if (!load) return

    const loadingMore = global ? globalLoadingMore : mineLoadingMore
    if (loadingMore) return

    if (global) setGlobalLoadingMore(true)
    else setMineLoadingMore(true)
    try {
      const page = xDriveNormalizeBackgroundTaskPage(
        await load(
          XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT,
          visibleState.nextCursor,
        ),
      )
      const update = (
        previous: XDriveBackgroundTaskPageState,
      ): XDriveBackgroundTaskPageState => ({
        ...previous,
        history: appendBackgroundTaskHistory(
          previous.history,
          page.history_items,
        ),
        nextCursor: page.next_cursor ?? '',
        loadedMore: true,
      })
      if (global) setGlobalTasks(update)
      else setMine(update)
    } catch (error) {
      onError?.(error)
    } finally {
      if (global) setGlobalLoadingMore(false)
      else setMineLoadingMore(false)
    }
  }, [
    effectiveScope,
    enabled,
    globalLoadingMore,
    mineLoadingMore,
    onError,
    port,
    visible,
    visibleState.nextCursor,
  ])

  useEffect(() => {
    if (!enabled || !port) {
      setMine(emptyBackgroundTaskPageState())
      setGlobalTasks(emptyBackgroundTaskPageState())
      setMineLoading(false)
      setGlobalLoading(false)
      setMineLoadingMore(false)
      setGlobalLoadingMore(false)
      return
    }
    if (!visible) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, pollIntervalMs, port, refresh, visible])

  return {
    mine: [...mine.current, ...mine.history],
    globalTasks: [...globalTasks.current, ...globalTasks.history],
    mineLoading,
    globalLoading,
    effectiveScope,
    refresh,
    loadMore,
    hasMore: Boolean(visibleState.nextCursor),
    loadingMore: effectiveScope === 'global'
      ? globalLoadingMore
      : mineLoadingMore,
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
  backgroundScope: requestedBackgroundScope,
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
  backgroundScope?: XDriveBackgroundTaskScope
  onBackgroundTaskError?: (error: unknown) => void
}) {
  const activeTransferCount = xDriveActiveTransferCount(transfers)
  const networkIDs = new Set(xDriveNetworkTransferTasks(transfers).map((task) => task.id))
  const localTransfers = transfers.filter((task) => !networkIDs.has(task.id))
  const activeLocalTaskCount = xDriveActiveTransferCount(localTransfers)
  const activeOperationCount = xDriveActiveFileOperationCount(operations)
  const hasHistory = xDriveTransferHasHistory(localTransfers) || xDriveFileOperationHasHistory(operations)
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
  const badgeCount = activeLocalTaskCount + activeBackgroundCount

  const background = useXDriveBackgroundTasks({
    port: backgroundTaskPort,
    enabled: backgroundTasksEnabled,
    visible: backgroundTasksVisible,
    globalEnabled: globalTasksEnabled,
    scope: requestedBackgroundScope ?? backgroundScope,
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
    transfers: localTransfers,
    operations,
    backgroundTasks: background.mine,
    globalBackgroundTasks: background.globalTasks,
    backgroundTasksLoading: background.mineLoading,
    globalBackgroundTasksLoading: background.globalLoading,
    backgroundTasksAvailable: Boolean(backgroundTaskPort) && backgroundTasksEnabled,
    globalTasksEnabled: Boolean(backgroundTaskPort?.loadGlobalPage) && globalTasksEnabled,
    backgroundScope: background.effectiveScope,
    onBackgroundScopeChange: setBackgroundScope,
    backgroundControlKey,
    onBackgroundTaskControl: backgroundTaskPort?.control
      ? (task, action) => { void controlBackgroundTask(task, action) }
      : undefined,
    backgroundHasMore: background.hasMore,
    backgroundLoadingMore: background.loadingMore,
    onLoadMoreBackground: () => { void background.loadMore() },
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
    activeLocalTaskCount,
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
