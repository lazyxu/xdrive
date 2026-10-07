import { useEffect, useMemo, useRef, useState } from 'react'
import { XDRIVE_FILE_EXPLORER_DEFAULT_SORT } from '../file-explorer-controller'
import {
  XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING,
} from '../file-explorer-grouping'
import type { XDriveFileExplorerGrouping } from '../file-explorer-grouping'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerSort,
  XDriveFileExplorerViewMode,
} from './FileExplorer'

function loadStoredViewMode(storageKey: string): XDriveFileExplorerViewMode {
  if (typeof window === 'undefined') return 'details'
  return window.localStorage.getItem(storageKey) === 'grid' ? 'grid' : 'details'
}

export type XDriveFileExplorerNavigationTab<TCrumb extends XDriveFileExplorerCrumb> = {
  id: string
  history: TCrumb[][]
  historyIndex: number
  sort: XDriveFileExplorerSort
  grouping: XDriveFileExplorerGrouping
  viewMode: XDriveFileExplorerViewMode
}

export type XDriveFileExplorerNavigationTabSummary = {
  id: string
  label: string
}

export type XDriveFileExplorerTabDropPosition = 'before' | 'after'

type XDriveFileExplorerClosedTab<TCrumb extends XDriveFileExplorerCrumb> = {
  tab: XDriveFileExplorerNavigationTab<TCrumb>
  index: number
}

export type XDriveFileExplorerNavigationState<
  TCrumb extends XDriveFileExplorerCrumb,
> = {
  tabs: XDriveFileExplorerNavigationTab<TCrumb>[]
  activeTabID: string
}

function cloneNavigationTab<TCrumb extends XDriveFileExplorerCrumb>(
  tab: XDriveFileExplorerNavigationTab<TCrumb>,
): XDriveFileExplorerNavigationTab<TCrumb> {
  return {
    ...tab,
    history: tab.history.map((entry) => entry.map((crumb) => ({ ...crumb }))),
    sort: { ...tab.sort },
    grouping: { ...tab.grouping },
  }
}

function cloneNavigationState<TCrumb extends XDriveFileExplorerCrumb>(
  state: XDriveFileExplorerNavigationState<TCrumb>,
): XDriveFileExplorerNavigationState<TCrumb> {
  return {
    tabs: state.tabs.map(cloneNavigationTab),
    activeTabID: state.activeTabID,
  }
}

function nextNavigationTabID<TCrumb extends XDriveFileExplorerCrumb>(
  tabs: readonly XDriveFileExplorerNavigationTab<TCrumb>[],
) {
  return tabs.reduce((largest, tab) => {
    const match = /^tab-(\d+)$/.exec(tab.id)
    return match ? Math.max(largest, Number(match[1]) + 1) : largest
  }, 2)
}

function createInitialNavigationState<TCrumb extends XDriveFileExplorerCrumb>(
  initialState: XDriveFileExplorerNavigationState<TCrumb> | undefined,
  viewMode: XDriveFileExplorerViewMode,
  maxTabs: number,
): XDriveFileExplorerNavigationState<TCrumb> {
  const restoredTabs = initialState?.tabs
    .slice(0, maxTabs)
    .map(cloneNavigationTab) ?? []
  if (restoredTabs.length > 0) {
    const activeTabID = restoredTabs.some((tab) => tab.id === initialState?.activeTabID)
      ? initialState!.activeTabID
      : restoredTabs[0].id
    return {
      tabs: restoredTabs,
      activeTabID,
    }
  }
  return {
    tabs: [createNavigationTab<TCrumb>('tab-1', viewMode)],
    activeTabID: 'tab-1',
  }
}

function createNavigationTab<TCrumb extends XDriveFileExplorerCrumb>(
  id: string,
  viewMode: XDriveFileExplorerViewMode,
  crumbs: TCrumb[] = [],
): XDriveFileExplorerNavigationTab<TCrumb> {
  return {
    id,
    history: crumbs.length > 0 ? [[...crumbs]] : [],
    historyIndex: crumbs.length > 0 ? 0 : -1,
    sort: XDRIVE_FILE_EXPLORER_DEFAULT_SORT,
    grouping: { ...XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING },
    viewMode,
  }
}

export function useXDriveFileExplorerNavigation<TCrumb extends XDriveFileExplorerCrumb>({
  crumbs,
  viewModeStorageKey,
  searchActive = false,
  onLoadDirectory,
  onAfterNavigate,
  initialNavigationState,
  onNavigationStateChange,
  maxTabs = 12,
}: {
  crumbs: TCrumb[]
  viewModeStorageKey: string
  searchActive?: boolean | (() => boolean)
  onLoadDirectory: (
    id: TCrumb['id'],
    crumbs: TCrumb[],
    sort: XDriveFileExplorerSort,
    grouping: XDriveFileExplorerGrouping,
  ) => Promise<boolean | void>
  onAfterNavigate?: (crumbs: TCrumb[]) => void
  initialNavigationState?: XDriveFileExplorerNavigationState<TCrumb>
  onNavigationStateChange?: (
    state: XDriveFileExplorerNavigationState<TCrumb>,
  ) => void
  maxTabs?: number
}) {
  const initialViewMode = useMemo(
    () => loadStoredViewMode(viewModeStorageKey),
    [viewModeStorageKey],
  )
  const initialNavigationStateRef = useRef<XDriveFileExplorerNavigationState<TCrumb> | null>(null)
  if (initialNavigationStateRef.current === null) {
    initialNavigationStateRef.current = createInitialNavigationState(
      initialNavigationState,
      initialViewMode,
      maxTabs,
    )
  }
  const nextTabIDRef = useRef(nextNavigationTabID(initialNavigationStateRef.current.tabs))
  const navigationRequestRef = useRef({
    id: 0,
    targetTabID: initialNavigationStateRef.current.activeTabID,
  })
  const [navigationState, setNavigationState] = useState<XDriveFileExplorerNavigationState<TCrumb>>(
    () => cloneNavigationState(initialNavigationStateRef.current!),
  )
  const closedTabsRef = useRef<XDriveFileExplorerClosedTab<TCrumb>[]>([])
  const [closedTabCount, setClosedTabCount] = useState(0)
  const navigationStateRef = useRef(navigationState)
  navigationStateRef.current = navigationState
  const onNavigationStateChangeRef = useRef(onNavigationStateChange)
  onNavigationStateChangeRef.current = onNavigationStateChange

  const commitNavigationState = (
    updater: (
      current: XDriveFileExplorerNavigationState<TCrumb>,
    ) => XDriveFileExplorerNavigationState<TCrumb>,
  ) => {
    const next = updater(navigationStateRef.current)
    navigationStateRef.current = next
    setNavigationState(next)
    onNavigationStateChangeRef.current?.(cloneNavigationState(next))
  }

  const rememberClosedTabs = (
    stateTabs: readonly XDriveFileExplorerNavigationTab<TCrumb>[],
    closedIDs: readonly string[],
  ) => {
    if (closedIDs.length === 0) return
    const closedIDSet = new Set(closedIDs)
    const snapshots = stateTabs.flatMap((tab, index) => (
      closedIDSet.has(tab.id)
        ? [{ tab: cloneNavigationTab(tab), index }]
        : []
    ))
    if (snapshots.length === 0) return
    closedTabsRef.current = [
      ...closedTabsRef.current,
      ...snapshots,
    ].slice(-16)
    setClosedTabCount(closedTabsRef.current.length)
  }

  const consumeClosedTab = (
    snapshot: XDriveFileExplorerClosedTab<TCrumb>,
  ) => {
    const index = closedTabsRef.current.lastIndexOf(snapshot)
    if (index < 0) return
    closedTabsRef.current = [
      ...closedTabsRef.current.slice(0, index),
      ...closedTabsRef.current.slice(index + 1),
    ]
    setClosedTabCount(closedTabsRef.current.length)
  }

  const tabs = navigationState.tabs
  const activeTabID = navigationState.activeTabID
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabID) ?? tabs[0],
    [activeTabID, tabs],
  )
  const current = crumbs.at(-1)
  const pathValue = crumbs.map((crumb) => crumb.name).join('/')
  const history = activeTab?.history ?? []
  const historyIndex = activeTab?.historyIndex ?? -1
  const sort = activeTab?.sort ?? XDRIVE_FILE_EXPLORER_DEFAULT_SORT
  const grouping = activeTab?.grouping ?? XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING
  const viewMode = activeTab?.viewMode ?? initialViewMode

  const isSearchActive = () => (
    typeof searchActive === 'function' ? searchActive() : searchActive
  )

  const beginNavigation = (targetTabID = activeTabID) => {
    const request = {
      id: navigationRequestRef.current.id + 1,
      targetTabID,
    }
    navigationRequestRef.current = request
    return request.id
  }

  const isNavigationCurrent = (requestID: number) => (
    navigationRequestRef.current.id === requestID
  )

  const beginNavigationIntent = () => beginNavigation(activeTabID)

  const isNavigationIntentCurrent = (requestID: number) => (
    isNavigationCurrent(requestID)
  )

  const updateActiveTab = (
    updater: (
      tab: XDriveFileExplorerNavigationTab<TCrumb>,
    ) => XDriveFileExplorerNavigationTab<TCrumb>,
  ) => {
    commitNavigationState((currentState) => ({
      ...currentState,
      tabs: currentState.tabs.map((tab) => (
        tab.id === currentState.activeTabID ? updater(tab) : tab
      )),
    }))
  }

  useEffect(() => {
    onNavigationStateChangeRef.current?.(
      cloneNavigationState(navigationStateRef.current),
    )
    return () => {
      navigationRequestRef.current = {
        ...navigationRequestRef.current,
        id: navigationRequestRef.current.id + 1,
      }
    }
  }, [])

  useEffect(() => {
    if (crumbs.length === 0 || !activeTab || activeTab.history.length > 0) return
    updateActiveTab((tab) => ({
      ...tab,
      history: [[...crumbs]],
      historyIndex: 0,
    }))
  }, [activeTab, activeTabID, crumbs])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(viewModeStorageKey, viewMode)
  }, [viewMode, viewModeStorageKey])

  const setViewMode = (nextViewMode: XDriveFileExplorerViewMode) => {
    updateActiveTab((tab) => ({ ...tab, viewMode: nextViewMode }))
  }

  const changeSort = (nextSort: XDriveFileExplorerSort) => {
    if (isSearchActive() || !current) {
      updateActiveTab((tab) => ({ ...tab, sort: nextSort }))
      return
    }
    const requestID = beginNavigation(activeTabID)
    void (async () => {
      const committed = await onLoadDirectory(
        current.id,
        crumbs,
        nextSort,
        grouping,
      )
      if (committed === false || !isNavigationCurrent(requestID)) return
      updateActiveTab((tab) => ({ ...tab, sort: nextSort }))
    })()
  }

  const changeGrouping = (nextGrouping: XDriveFileExplorerGrouping) => {
    if (isSearchActive() || !current) {
      updateActiveTab((tab) => ({ ...tab, grouping: { ...nextGrouping } }))
      return
    }
    const requestID = beginNavigation(activeTabID)
    void (async () => {
      const committed = await onLoadDirectory(
        current.id,
        crumbs,
        sort,
        nextGrouping,
      )
      if (committed === false || !isNavigationCurrent(requestID)) return
      updateActiveTab((tab) => ({ ...tab, grouping: { ...nextGrouping } }))
    })()
  }

  const refresh = () => {
    if (current) {
      beginNavigation(activeTabID)
      void onLoadDirectory(current.id, crumbs, sort, grouping)
    }
  }

  const recordHistory = (nextCrumbs: TCrumb[]) => {
    updateActiveTab((tab) => {
      const nextHistory = [
        ...tab.history.slice(0, tab.historyIndex + 1),
        [...nextCrumbs],
      ]
      return {
        ...tab,
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
      }
    })
  }

  const finishNavigation = (nextCrumbs: TCrumb[]) => {
    onAfterNavigate?.(nextCrumbs)
  }

  const navigateTo = async (
    nextCrumbs: TCrumb[],
    record = true,
    navigationIntentID?: number,
  ) => {
    const target = nextCrumbs.at(-1)
    if (!target) return
    const requestID = navigationIntentID ?? beginNavigation(activeTabID)
    if (!isNavigationCurrent(requestID)) return
    const committed = await onLoadDirectory(target.id, nextCrumbs, sort, grouping)
    if (committed === false || !isNavigationCurrent(requestID)) return
    if (record) recordHistory(nextCrumbs)
    finishNavigation(nextCrumbs)
  }

  const goBack = async () => {
    if (!activeTab || historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    const requestID = beginNavigation(activeTabID)
    const committed = await onLoadDirectory(target.id, next, sort, grouping)
    if (committed === false || !isNavigationCurrent(requestID)) return
    updateActiveTab((tab) => ({ ...tab, historyIndex: nextIndex }))
    finishNavigation(next)
  }

  const goForward = async () => {
    if (!activeTab || historyIndex < 0 || historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const next = history[nextIndex]
    const target = next?.at(-1)
    if (!target) return
    const requestID = beginNavigation(activeTabID)
    const committed = await onLoadDirectory(target.id, next, sort, grouping)
    if (committed === false || !isNavigationCurrent(requestID)) return
    updateActiveTab((tab) => ({ ...tab, historyIndex: nextIndex }))
    finishNavigation(next)
  }

  const goUp = async () => {
    if (crumbs.length <= 1) return
    await navigateTo(crumbs.slice(0, -1))
  }

  const navigateToCrumb = async (index: number) => {
    if (index < 0 || index >= crumbs.length) return
    await navigateTo(crumbs.slice(0, index + 1))
  }

  const openTab = async (nextCrumbs: TCrumb[]) => {
    if (tabs.length >= maxTabs) return false
    const target = nextCrumbs.at(-1)
    if (!target) return false
    const id = `tab-${nextTabIDRef.current++}`
    const nextTab = createNavigationTab<TCrumb>(id, viewMode, nextCrumbs)
    const requestID = beginNavigation(id)
    const committed = await onLoadDirectory(
      target.id,
      nextCrumbs,
      nextTab.sort,
      nextTab.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return false
    commitNavigationState((currentState) => ({
      tabs: [...currentState.tabs, nextTab],
      activeTabID: id,
    }))
    return true
  }

  const newTab = async () => {
    const root = crumbs[0]
    if (!root) return false
    return openTab([root])
  }

  const activateTab = async (id: string) => {
    if (id === activeTabID) return
    const targetTab = tabs.find((tab) => tab.id === id)
    if (!targetTab) return
    const targetCrumbs = targetTab.history[targetTab.historyIndex]
    const target = targetCrumbs?.at(-1)
    if (!target || !targetCrumbs) return
    const requestID = beginNavigation(id)
    const committed = await onLoadDirectory(
      target.id,
      targetCrumbs,
      targetTab.sort,
      targetTab.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return
    commitNavigationState((currentState) => ({
      ...currentState,
      activeTabID: id,
    }))
    finishNavigation(targetCrumbs)
  }

  const closeTab = async (id = activeTabID) => {
    if (tabs.length <= 1) return
    const closingIndex = tabs.findIndex((tab) => tab.id === id)
    if (closingIndex < 0) return

    if (id !== activeTabID) {
      if (navigationRequestRef.current.targetTabID === id && current) {
        beginNavigation(activeTabID)
        void onLoadDirectory(current.id, crumbs, sort, grouping)
      }
      rememberClosedTabs(tabs, [id])
      commitNavigationState((currentState) => ({
        ...currentState,
        tabs: currentState.tabs.filter((tab) => tab.id !== id),
      }))
      return
    }

    const targetTab = tabs[closingIndex - 1] ?? tabs[closingIndex + 1]
    const targetCrumbs = targetTab?.history[targetTab.historyIndex]
    const target = targetCrumbs?.at(-1)
    if (!targetTab || !target || !targetCrumbs) return

    const requestID = beginNavigation(targetTab.id)
    const committed = await onLoadDirectory(
      target.id,
      targetCrumbs,
      targetTab.sort,
      targetTab.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return
    rememberClosedTabs(tabs, [id])
    commitNavigationState((currentState) => ({
      tabs: currentState.tabs.filter((tab) => tab.id !== id),
      activeTabID: targetTab.id,
    }))
  }

  const reorderTab = (
    sourceID: string,
    targetID: string,
    position: XDriveFileExplorerTabDropPosition,
  ) => {
    if (sourceID === targetID) return false
    const currentTabs = navigationStateRef.current.tabs
    if (
      !currentTabs.some((tab) => tab.id === sourceID) ||
      !currentTabs.some((tab) => tab.id === targetID)
    ) return false

    commitNavigationState((currentState) => {
      const nextTabs = [...currentState.tabs]
      const sourceIndex = nextTabs.findIndex((tab) => tab.id === sourceID)
      if (sourceIndex < 0) return currentState
      const [moved] = nextTabs.splice(sourceIndex, 1)
      const targetIndex = nextTabs.findIndex((tab) => tab.id === targetID)
      if (targetIndex < 0) return currentState
      const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
      nextTabs.splice(insertIndex, 0, moved)
      return { ...currentState, tabs: nextTabs }
    })
    return true
  }

  const duplicateTab = async (id = activeTabID) => {
    const currentState = navigationStateRef.current
    if (currentState.tabs.length >= maxTabs) return false
    const sourceTab = currentState.tabs.find((tab) => tab.id === id)
    if (!sourceTab) return false
    const targetCrumbs = sourceTab.history[sourceTab.historyIndex]
    const target = targetCrumbs?.at(-1)
    if (!target || !targetCrumbs) return false

    const duplicateID = `tab-${nextTabIDRef.current++}`
    const duplicate = cloneNavigationTab(sourceTab)
    duplicate.id = duplicateID
    const requestID = beginNavigation(duplicateID)
    const committed = await onLoadDirectory(
      target.id,
      targetCrumbs,
      duplicate.sort,
      duplicate.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return false
    if (!navigationStateRef.current.tabs.some((tab) => tab.id === id)) return false

    commitNavigationState((state) => {
      const sourceIndex = state.tabs.findIndex((tab) => tab.id === id)
      if (sourceIndex < 0 || state.tabs.length >= maxTabs) return state
      const nextTabs = [...state.tabs]
      nextTabs.splice(sourceIndex + 1, 0, duplicate)
      return { tabs: nextTabs, activeTabID: duplicateID }
    })
    finishNavigation(targetCrumbs)
    return true
  }

  const closeOtherTabs = async (id = activeTabID) => {
    const currentState = navigationStateRef.current
    if (currentState.tabs.length <= 1) return false
    const targetTab = currentState.tabs.find((tab) => tab.id === id)
    if (!targetTab) return false
    const closingIDs = currentState.tabs
      .filter((tab) => tab.id !== id)
      .map((tab) => tab.id)

    if (id === currentState.activeTabID) {
      if (
        closingIDs.includes(navigationRequestRef.current.targetTabID) &&
        current
      ) {
        beginNavigation(currentState.activeTabID)
        void onLoadDirectory(current.id, crumbs, sort, grouping)
      }
      rememberClosedTabs(currentState.tabs, closingIDs)
      commitNavigationState(() => ({
        tabs: [targetTab],
        activeTabID: targetTab.id,
      }))
      return true
    }

    const targetCrumbs = targetTab.history[targetTab.historyIndex]
    const target = targetCrumbs?.at(-1)
    if (!target || !targetCrumbs) return false
    const requestID = beginNavigation(targetTab.id)
    const committed = await onLoadDirectory(
      target.id,
      targetCrumbs,
      targetTab.sort,
      targetTab.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return false

    rememberClosedTabs(currentState.tabs, closingIDs)
    commitNavigationState(() => ({
      tabs: [targetTab],
      activeTabID: targetTab.id,
    }))
    finishNavigation(targetCrumbs)
    return true
  }

  const closeTabsToRight = async (id = activeTabID) => {
    const currentState = navigationStateRef.current
    const targetIndex = currentState.tabs.findIndex((tab) => tab.id === id)
    if (targetIndex < 0 || targetIndex >= currentState.tabs.length - 1) return false

    const remaining = currentState.tabs.slice(0, targetIndex + 1)
    const closing = currentState.tabs.slice(targetIndex + 1)
    const closingIDs = closing.map((tab) => tab.id)
    const activeStillOpen = remaining.some((tab) => (
      tab.id === currentState.activeTabID
    ))

    if (activeStillOpen) {
      if (
        closing.some((tab) => (
          tab.id === navigationRequestRef.current.targetTabID
        )) &&
        current
      ) {
        beginNavigation(currentState.activeTabID)
        void onLoadDirectory(current.id, crumbs, sort, grouping)
      }
      rememberClosedTabs(currentState.tabs, closingIDs)
      commitNavigationState((state) => ({
        ...state,
        tabs: state.tabs.slice(0, targetIndex + 1),
      }))
      return true
    }

    const targetTab = remaining.at(-1)
    const targetCrumbs = targetTab?.history[targetTab.historyIndex]
    const target = targetCrumbs?.at(-1)
    if (!targetTab || !target || !targetCrumbs) return false
    const requestID = beginNavigation(targetTab.id)
    const committed = await onLoadDirectory(
      target.id,
      targetCrumbs,
      targetTab.sort,
      targetTab.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return false

    rememberClosedTabs(currentState.tabs, closingIDs)
    commitNavigationState(() => ({
      tabs: remaining,
      activeTabID: targetTab.id,
    }))
    finishNavigation(targetCrumbs)
    return true
  }

  const restoreClosedTab = async () => {
    const currentState = navigationStateRef.current
    if (
      currentState.tabs.length >= maxTabs ||
      closedTabsRef.current.length === 0
    ) return false

    const snapshot = closedTabsRef.current.at(-1)
    if (!snapshot) return false
    const restored = cloneNavigationTab(snapshot.tab)
    if (currentState.tabs.some((tab) => tab.id === restored.id)) {
      restored.id = `tab-${nextTabIDRef.current++}`
    }
    const targetCrumbs = restored.history[restored.historyIndex]
    const target = targetCrumbs?.at(-1)
    if (!target || !targetCrumbs) return false

    const requestID = beginNavigation(restored.id)
    const committed = await onLoadDirectory(
      target.id,
      targetCrumbs,
      restored.sort,
      restored.grouping,
    )
    if (committed === false || !isNavigationCurrent(requestID)) return false

    consumeClosedTab(snapshot)
    commitNavigationState((state) => {
      const nextTabs = [...state.tabs]
      const insertIndex = Math.max(
        0,
        Math.min(snapshot.index, nextTabs.length),
      )
      nextTabs.splice(insertIndex, 0, restored)
      return { tabs: nextTabs, activeTabID: restored.id }
    })
    finishNavigation(targetCrumbs)
    return true
  }

  const cycleTab = async (delta: -1 | 1) => {
    if (tabs.length <= 1) return
    const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabID))
    const nextIndex = (currentIndex + delta + tabs.length) % tabs.length
    await activateTab(tabs[nextIndex].id)
  }

  const tabSummaries = useMemo<XDriveFileExplorerNavigationTabSummary[]>(() => (
    tabs.map((tab) => {
      const tabCrumbs = tab.history[tab.historyIndex]
      const label = tabCrumbs?.at(-1)?.name ?? (
        tab.id === activeTabID ? current?.name : undefined
      ) ?? '我的文件'
      return { id: tab.id, label }
    })
  ), [activeTabID, current?.name, tabs])

  return {
    current,
    pathValue,
    viewMode,
    setViewMode,
    sort,
    changeSort,
    grouping,
    changeGrouping,
    refresh,
    beginNavigationIntent,
    isNavigationIntentCurrent,
    navigateTo,
    navigateToCrumb,
    goBack,
    goForward,
    goUp,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex >= 0 && historyIndex < history.length - 1,
    canGoUp: crumbs.length > 1,
    tabs: tabSummaries,
    activeTabID,
    openTab,
    newTab,
    activateTab,
    closeTab,
    reorderTab,
    duplicateTab,
    closeOtherTabs,
    closeTabsToRight,
    restoreClosedTab,
    nextTab: () => cycleTab(1),
    previousTab: () => cycleTab(-1),
    canNewTab: tabs.length < maxTabs && crumbs.length > 0,
    canCloseTab: tabs.length > 1,
    canRestoreClosedTab: closedTabCount > 0 && tabs.length < maxTabs,
  }
}
