import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  lifecycleKey,
}: {
  port?: XDriveBackgroundTaskPort
  enabled: boolean
  lifecycleKey: string
}) {
  // A summary belongs to the transport/auth scope that produced it. Keep
  // the old result invisible on the first render of another account/Agent.
  const [summaryState, setSummaryState] = useState<{
    port?: XDriveBackgroundTaskPort
    enabled: boolean
    lifecycleKey: string
    value?: XDriveBackgroundTaskActiveSummary
  }>({ port, enabled, lifecycleKey })
  const summarySourceRef = useRef({ port, enabled, lifecycleKey })
  const summaryRequestRef = useRef(0)
  if (
    summarySourceRef.current.port !== port ||
    summarySourceRef.current.enabled !== enabled ||
    summarySourceRef.current.lifecycleKey !== lifecycleKey
  ) {
    summarySourceRef.current = { port, enabled, lifecycleKey }
    summaryRequestRef.current += 1
  }
  const summary = summaryState.port === port &&
    summaryState.enabled === enabled &&
    summaryState.lifecycleKey === lifecycleKey
    ? summaryState.value : undefined

  const refresh = useCallback(async () => {
    const source = summarySourceRef.current
    const request = ++summaryRequestRef.current
    const valid = () => (
      summarySourceRef.current === source &&
      summaryRequestRef.current === request
    )
    if (!enabled || !port?.loadActiveSummary) {
      if (valid()) setSummaryState({ port, enabled, lifecycleKey })
      return
    }
    try {
      const value = await port.loadActiveSummary()
      if (valid()) setSummaryState({ port, enabled, lifecycleKey, value })
    } catch {
      if (valid()) setSummaryState({ port, enabled, lifecycleKey })
    }
  }, [enabled, lifecycleKey, port])

  const pollIntervalMs = useMemo(
    () => xDriveBackgroundTaskSummaryPollIntervalMs(summary),
    [summary],
  )

  useEffect(() => {
    if (!enabled || !port?.loadActiveSummary) {
      void refresh()
      return
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollIntervalMs)
    return () => {
      window.clearInterval(timer)
      summaryRequestRef.current += 1
    }
  }, [enabled, pollIntervalMs, port, refresh])

  return { summary, refresh }
}

function useXDriveBackgroundTasks({
  port,
  enabled,
  visible,
  globalEnabled,
  scope,
  lifecycleKey,
  onError,
}: {
  port?: XDriveBackgroundTaskPort
  enabled: boolean
  visible: boolean
  globalEnabled: boolean
  scope: XDriveBackgroundTaskScope
  lifecycleKey: string
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
  // Error feedback is not a polling input. Desktop callers create a new
  // handler during render; keeping it in refresh dependencies restarts reads.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const effectiveScope: XDriveBackgroundTaskScope =
    scope === 'global' && globalEnabled && port?.loadGlobalPage ? 'global' : 'mine'
  const [listOwner, setListOwner] = useState({ port, enabled, lifecycleKey })
  const ownerCurrent = listOwner.port === port &&
    listOwner.enabled === enabled && listOwner.lifecycleKey === lifecycleKey
  // Scope-bound presentation protects the very first new-account frame,
  // before the reset effect has committed the empty page state.
  const scopedMine = ownerCurrent ? mine : emptyBackgroundTaskPageState()
  const scopedGlobal = ownerCurrent ? globalTasks : emptyBackgroundTaskPageState()
  const visibleState = effectiveScope === 'global' ? scopedGlobal : scopedMine
  const visibleTasks = [...visibleState.current, ...visibleState.history]
  const pollIntervalMs = useMemo(
    () => xDriveBackgroundTaskPollIntervalMs(visibleTasks),
    [visibleTasks],
  )

  const listSourceRef = useRef({
    port, enabled, visible, lifecycleKey, effectiveScope,
  })
  const listRefreshRequestRef = useRef(0)
  const listMoreRequestRef = useRef(0)
  if (
    listSourceRef.current.port !== port ||
    listSourceRef.current.enabled !== enabled ||
    listSourceRef.current.visible !== visible ||
    listSourceRef.current.lifecycleKey !== lifecycleKey ||
    listSourceRef.current.effectiveScope !== effectiveScope
  ) {
    listSourceRef.current = {
      port, enabled, visible, lifecycleKey, effectiveScope,
    }
    listRefreshRequestRef.current += 1
    listMoreRequestRef.current += 1
  }

  const refresh = useCallback(async () => {
    if (!port || !enabled || !visible) return
    const source = listSourceRef.current
    const request = ++listRefreshRequestRef.current
    // A fresh first page invalidates any older cursor continuation.
    listMoreRequestRef.current += 1
    const valid = () => (
      listSourceRef.current === source &&
      listRefreshRequestRef.current === request
    )
    const global = effectiveScope === 'global'
    const load = global ? port.loadGlobalPage : port.loadMinePage
    if (!load) return

    if (global) setGlobalLoading(true)
    else setMineLoading(true)
    try {
      const page = xDriveNormalizeBackgroundTaskPage(
        await load(XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT),
      )
      if (!valid()) return
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
      if (valid()) onErrorRef.current?.(error)
    } finally {
      if (valid()) {
        if (global) setGlobalLoading(false)
        else setMineLoading(false)
      }
    }
  }, [effectiveScope, enabled, port, visible])

  const loadMore = useCallback(async () => {
    if (!port || !enabled || !visible || !visibleState.nextCursor) return

    const global = effectiveScope === 'global'
    const load = global ? port.loadGlobalPage : port.loadMinePage
    if (!load) return

    const loadingMore = global ? globalLoadingMore : mineLoadingMore
    if (loadingMore) return
    const source = listSourceRef.current
    const request = ++listMoreRequestRef.current
    const originalRefresh = listRefreshRequestRef.current
    const valid = () => (
      listSourceRef.current === source &&
      listMoreRequestRef.current === request &&
      listRefreshRequestRef.current === originalRefresh
    )

    if (global) setGlobalLoadingMore(true)
    else setMineLoadingMore(true)
    try {
      const page = xDriveNormalizeBackgroundTaskPage(
        await load(
          XDRIVE_BACKGROUND_TASK_HISTORY_PAGE_LIMIT,
          visibleState.nextCursor,
        ),
      )
      if (!valid()) return
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
      if (valid()) onErrorRef.current?.(error)
    } finally {
      if (valid()) {
        if (global) setGlobalLoadingMore(false)
        else setMineLoadingMore(false)
      }
    }
  }, [
    effectiveScope,
    enabled,
    globalLoadingMore,
    mineLoadingMore,
    port,
    visible,
    visibleState.nextCursor,
  ])

  useEffect(() => {
    // A new auth identity or Agent capability means a new task collection.
    setMine(emptyBackgroundTaskPageState())
    setGlobalTasks(emptyBackgroundTaskPageState())
    setMineLoading(false)
    setGlobalLoading(false)
    setMineLoadingMore(false)
    setGlobalLoadingMore(false)
    setListOwner({ port, enabled, lifecycleKey })
  }, [enabled, lifecycleKey, port])

  useEffect(() => {
    if (!enabled || !port) return
    if (!visible) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [enabled, pollIntervalMs, port, refresh, visible])

  return {
    mine: [...scopedMine.current, ...scopedMine.history],
    globalTasks: [...scopedGlobal.current, ...scopedGlobal.history],
    mineLoading: ownerCurrent ? mineLoading : false,
    globalLoading: ownerCurrent ? globalLoading : false,
    effectiveScope,
    refresh,
    loadMore,
    hasMore: Boolean(visibleState.nextCursor),
    loadingMore: ownerCurrent
      ? effectiveScope === 'global' ? globalLoadingMore : mineLoadingMore
      : false,
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
  backgroundTasksLifecycleKey = '',
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
  backgroundTasksLifecycleKey?: string
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
  // Server control commands are durable. Only UI ownership changes when the
  // authenticated transport/session changes; an old command is not cancelled.
  const controlScopeRef = useRef<{
    port?: XDriveBackgroundTaskPort
    lifecycleKey: string
    busyKey: string
  }>({
    port: backgroundTaskPort,
    lifecycleKey: backgroundTasksLifecycleKey,
    busyKey: '',
  })
  if (
    controlScopeRef.current.port !== backgroundTaskPort ||
    controlScopeRef.current.lifecycleKey !== backgroundTasksLifecycleKey
  ) {
    controlScopeRef.current = {
      port: backgroundTaskPort,
      lifecycleKey: backgroundTasksLifecycleKey,
      busyKey: '',
    }
  }
  const controlScope = controlScopeRef.current
  const [controlState, setControlState] = useState<{
    owner: typeof controlScope
    key: string
  }>({ owner: controlScope, key: '' })
  // Never display or inherit the previous account's Busy on the first frame.
  const backgroundControlKey = controlState.owner === controlScope
    ? controlState.key : ''

  useEffect(() => {
    if (!globalTasksEnabled && backgroundScope === 'global') {
      setBackgroundScope('mine')
    }
  }, [backgroundScope, globalTasksEnabled])

  const backgroundSummary = useXDriveBackgroundTaskActiveSummary({
    port: backgroundTaskPort,
    enabled: backgroundTasksEnabled,
    lifecycleKey: backgroundTasksLifecycleKey,
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
    lifecycleKey: backgroundTasksLifecycleKey,
    visible: backgroundTasksVisible,
    globalEnabled: globalTasksEnabled,
    scope: requestedBackgroundScope ?? backgroundScope,
    onError: onBackgroundTaskError,
  })

  const controlBackgroundTask = useCallback(async (
    task: XDriveBackgroundTask,
    action: XDriveBackgroundTaskControlAction,
  ) => {
    if (
      !backgroundTaskPort?.control ||
      controlScopeRef.current !== controlScope ||
      controlScope.busyKey
    ) return
    const global = background.effectiveScope === 'global'
    const key = `${task.id}:${action}`
    // Claim before React publishes state: callbacks retained from the same
    // render cannot issue duplicate Cancel/Retry commands.
    controlScope.busyKey = key
    setControlState({ owner: controlScope, key })
    try {
      await backgroundTaskPort.control(task.id, action, global)
      if (controlScopeRef.current !== controlScope) return
      await Promise.all([
        background.refresh(),
        backgroundSummary.refresh(),
      ])
    } catch (error) {
      if (controlScopeRef.current === controlScope) {
        onBackgroundTaskError?.(error)
      }
    } finally {
      controlScope.busyKey = ''
      // Detached old-account completions must not clear the current Busy.
      if (controlScopeRef.current === controlScope) {
        setControlState({ owner: controlScope, key: '' })
      }
    }
  }, [
    background.effectiveScope,
    background.refresh,
    backgroundTaskPort,
    backgroundSummary.refresh,
    controlScope,
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
