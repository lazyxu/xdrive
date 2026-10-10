import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerSearchDecision,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerSearchResultLike,
} from '../file-explorer-controller'
import {
  xDriveFileExplorerSearchFiltersActive,
  xDriveFileExplorerSearchFiltersSignature,
} from '../file-explorer-search'
import {
  xDriveFileExplorerGroupingSignature,
} from '../file-explorer-grouping'
import type {
  XDriveFileExplorerGroupIndex,
  XDriveFileExplorerGrouping,
} from '../file-explorer-grouping'
import type {
  XDriveFileExplorerSearchFilters,
} from '../file-explorer-search'
import type { XDriveFileExplorerSort } from './FileExplorer'
import { useXDriveVirtualCollection } from './VirtualCollectionController'

function searchSortSignature(sort: XDriveFileExplorerSort) {
  return `${sort.key}:${sort.direction}`
}

export type XDriveFileExplorerSearchRange<
  TResult extends XDriveFileExplorerSearchResultLike,
> = {
  items: readonly TResult[]
  totalCount: number
  offset: number
  limit: number
  groups?: readonly XDriveFileExplorerGroupIndex[]
}

export type XDriveFileExplorerSearchLoader<
  TResult extends XDriveFileExplorerSearchResultLike,
> = (
  query: string,
  filters: XDriveFileExplorerSearchFilters,
  grouping: XDriveFileExplorerGrouping,
  sort: XDriveFileExplorerSort,
  offset: number,
  limit: number,
  signal?: AbortSignal,
) => Promise<XDriveFileExplorerSearchRange<TResult>>

type XDriveFileExplorerWorkspaceSearchEntry = {
  value: string
  query: string
  filters: XDriveFileExplorerSearchFilters
  groups: readonly XDriveFileExplorerGroupIndex[]
  sortSignature: string
  loading: boolean
  error: string | null
}

type XDriveFileExplorerSearchTarget = {
  workspaceKey: string
  query: string
  filters: XDriveFileExplorerSearchFilters
  filterSignature: string
  grouping: XDriveFileExplorerGrouping
  groupingSignature: string
  sort: XDriveFileExplorerSort
  sortSignature: string
  requestID: number
}

function idleWorkspaceSearchEntry(): XDriveFileExplorerWorkspaceSearchEntry {
  return {
    value: '',
    query: '',
    filters: {},
    groups: [],
    sortSignature: '',
    loading: false,
    error: null,
  }
}

function searchQueryKey(target: XDriveFileExplorerSearchTarget | null) {
  if (!target) return 'file-explorer:search:idle'
  return [
    'file-explorer:search',
    target.workspaceKey,
    target.query,
    target.filterSignature,
    target.groupingSignature,
    target.sortSignature,
    target.requestID,
  ].join(':')
}

export function useXDriveFileExplorerSearch<
  TResult extends XDriveFileExplorerSearchResultLike,
>({
  loadRange,
  sort,
  grouping,
  onError,
  onSearchIntent,
  workspaceKey = 'default',
  retainedWorkspaceKeys,
}: {
  loadRange: XDriveFileExplorerSearchLoader<TResult>
  sort: XDriveFileExplorerSort
  grouping: XDriveFileExplorerGrouping
  onError: (error: unknown) => void
  onSearchIntent?: () => void
  workspaceKey?: string
  retainedWorkspaceKeys?: readonly string[]
}) {
  const requestRef = useRef<Record<string, number>>({})
  const nextRequestRef = useRef(0)
  // Only one first-page Search request owns the shared sparse collection at a
  // time. Viewport page requests retain their separate VirtualCollection owner.
  const initialPageControllerRef = useRef<AbortController | null>(null)
  const abortInitialPage = useCallback(() => {
    initialPageControllerRef.current?.abort()
    initialPageControllerRef.current = null
  }, [])
  const workspaceKeyRef = useRef(workspaceKey)
  workspaceKeyRef.current = workspaceKey
  const targetRef = useRef<XDriveFileExplorerSearchTarget | null>(null)
  const [target, setTarget] = useState<XDriveFileExplorerSearchTarget | null>(null)
  const [entries, setEntries] = useState<Record<string, XDriveFileExplorerWorkspaceSearchEntry>>({})
  const onSearchIntentRef = useRef(onSearchIntent)
  onSearchIntentRef.current = onSearchIntent

  const entry = entries[workspaceKey] ?? idleWorkspaceSearchEntry()
  const searchValue = entry.value
  const sortSignature = searchSortSignature(sort)
  const filterSignature = xDriveFileExplorerSearchFiltersSignature(entry.filters)
  const groupingSignature = xDriveFileExplorerGroupingSignature(grouping)
  const filterActive = xDriveFileExplorerSearchFiltersActive(entry.filters)
  const searchActive = Boolean(entry.query || filterActive)
  const searchStateKey = JSON.stringify([
    workspaceKey,
    searchValue,
    entry.query,
    filterSignature,
    groupingSignature,
    sortSignature,
  ])
  const searchStateKeyRef = useRef(searchStateKey)
  // Returning to the same definition does not restore an older action's intent.
  const searchIntentRef = useRef(0)
  if (searchStateKeyRef.current !== searchStateKey) searchIntentRef.current += 1
  searchStateKeyRef.current = searchStateKey
  const searchIntent = searchIntentRef.current
  const beginSearchIntent = useCallback(() => {
    searchIntentRef.current += 1
    onSearchIntentRef.current?.()
  }, [])

  const updateEntry = useCallback((
    key: string,
    updater: (
      current: XDriveFileExplorerWorkspaceSearchEntry,
    ) => XDriveFileExplorerWorkspaceSearchEntry,
  ) => {
    setEntries((current) => ({
      ...current,
      [key]: updater(current[key] ?? idleWorkspaceSearchEntry()),
    }))
  }, [])

  const nextRequestID = useCallback((key: string) => {
    // New searches, clear and filter replacement must stop the old in-flight
    // HTTP request, not merely ignore its result after it consumes Go work.
    abortInitialPage()
    const next = ++nextRequestRef.current
    requestRef.current[key] = next
    return next
  }, [abortInitialPage])

  // An inactive history entry does not own the active browser Search request.
  // React also runs this cleanup on unmount/account lifecycle replacement.
  useEffect(() => () => {
    abortInitialPage()
  }, [abortInitialPage, workspaceKey])

  const targetIsCurrent = useCallback((candidate: XDriveFileExplorerSearchTarget) => (
    workspaceKeyRef.current === candidate.workspaceKey &&
    requestRef.current[candidate.workspaceKey] === candidate.requestID &&
    targetRef.current?.workspaceKey === candidate.workspaceKey &&
    targetRef.current.requestID === candidate.requestID
  ), [])

  const loadVirtualRange = useCallback(async (
    range: { offset: number; limit: number },
    signal: AbortSignal,
  ) => {
    const active = targetRef.current
    if (!active) {
      return {
        items: [] as TResult[],
        offset: range.offset,
        limit: range.limit,
        totalCount: 0,
      }
    }
    try {
      return await loadRange(
        active.query,
        active.filters,
        active.grouping,
        active.sort,
        range.offset,
        range.limit,
        signal,
      )
    } catch (error) {
      if (!signal.aborted && targetIsCurrent(active)) {
        updateEntry(active.workspaceKey, (current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
      throw error
    }
  }, [loadRange, targetIsCurrent, updateEntry])

  const virtualCollection = useXDriveVirtualCollection<TResult>({
    queryKey: searchQueryKey(target),
    loadRange: loadVirtualRange,
    onError,
    pageSize: XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  })

  const executeSearch = useCallback(async (
    key: string,
    query: string,
    filters: XDriveFileExplorerSearchFilters,
    targetGrouping: XDriveFileExplorerGrouping,
    targetSort: XDriveFileExplorerSort,
  ) => {
    const requestID = nextRequestID(key)
    const controller = new AbortController()
    initialPageControllerRef.current = controller
    const nextTarget: XDriveFileExplorerSearchTarget = {
      workspaceKey: key,
      query,
      filters: { ...filters },
      filterSignature: xDriveFileExplorerSearchFiltersSignature(filters),
      grouping: { ...targetGrouping },
      groupingSignature: xDriveFileExplorerGroupingSignature(targetGrouping),
      sort: targetSort,
      sortSignature: searchSortSignature(targetSort),
      requestID,
    }
    targetRef.current = nextTarget
    setTarget(nextTarget)
    virtualCollection.reset(searchQueryKey(nextTarget))
    updateEntry(key, (current) => ({
      ...current,
      value: current.value || query,
      query,
      filters: { ...filters },
      groups: [],
      sortSignature: nextTarget.sortSignature,
      loading: true,
      error: null,
    }))

    try {
      const page = await loadRange(
        query,
        filters,
        targetGrouping,
        targetSort,
        0,
        XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
        controller.signal,
      )
      if (controller.signal.aborted || !targetIsCurrent(nextTarget)) return
      virtualCollection.primePage(page)
      updateEntry(key, (current) => ({
        ...current,
        groups: page.groups ? [...page.groups] : [],
      }))
    } catch (error) {
      if (!controller.signal.aborted && targetIsCurrent(nextTarget)) {
        updateEntry(key, (current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }))
        onError(error)
      }
    } finally {
      if (initialPageControllerRef.current === controller) {
        initialPageControllerRef.current = null
      }
      if (!controller.signal.aborted && targetIsCurrent(nextTarget)) {
        updateEntry(key, (current) => ({
          ...current,
          loading: false,
        }))
      }
    }
  }, [
    loadRange,
    nextRequestID,
    onError,
    targetIsCurrent,
    updateEntry,
    virtualCollection.primePage,
    virtualCollection.reset,
  ])

  const clearSearch = useCallback(() => {
    if (searchIntentRef.current !== searchIntent) return false
    beginSearchIntent()
    nextRequestID(workspaceKey)
    if (targetRef.current?.workspaceKey === workspaceKey) {
      targetRef.current = null
      setTarget(null)
      virtualCollection.reset(`file-explorer:search:idle:${workspaceKey}`)
    }
    updateEntry(workspaceKey, () => idleWorkspaceSearchEntry())
    return true
  }, [
    beginSearchIntent,
    nextRequestID,
    searchIntent,
    updateEntry,
    virtualCollection.reset,
    workspaceKey,
  ])

  const changeSearchValue = useCallback((value: string) => {
    if (!value.trim()) {
      if (!filterActive) {
        clearSearch()
        return
      }
      beginSearchIntent()
      nextRequestID(workspaceKey)
      updateEntry(workspaceKey, (current) => ({
        ...current,
        value: '',
        query: '',
        sortSignature: '',
        loading: false,
      }))
      return
    }
    beginSearchIntent()
    updateEntry(workspaceKey, (current) => ({ ...current, value }))
  }, [
    beginSearchIntent,
    clearSearch,
    filterActive,
    nextRequestID,
    updateEntry,
    workspaceKey,
  ])

  const changeSearchFilters = useCallback((filters: XDriveFileExplorerSearchFilters) => {
    const active = xDriveFileExplorerSearchFiltersActive(filters)
    if (!active && !entry.query) {
      clearSearch()
      return
    }
    beginSearchIntent()
    nextRequestID(workspaceKey)
    updateEntry(workspaceKey, (current) => ({
      ...current,
      filters: { ...filters },
      sortSignature: '',
      loading: false,
    }))
  }, [
    beginSearchIntent,
    clearSearch,
    entry.query,
    nextRequestID,
    updateEntry,
    workspaceKey,
  ])

  const applySearch = useCallback(async (
    rawQuery: string,
    filters: XDriveFileExplorerSearchFilters,
  ) => {
    const query = rawQuery.trim()
    if (!query && !xDriveFileExplorerSearchFiltersActive(filters)) {
      clearSearch()
      return
    }
    if (query && query.length < 2) {
      onError(new Error('搜索至少需要 2 个字符'))
      return
    }
    beginSearchIntent()
    updateEntry(workspaceKey, (current) => ({
      ...current,
      value: query,
      query,
      filters: { ...filters },
      sortSignature: '',
      loading: false,
    }))
    await executeSearch(workspaceKey, query, filters, grouping, sort)
  }, [
    beginSearchIntent,
    clearSearch,
    executeSearch,
    grouping,
    onError,
    sort,
    updateEntry,
    workspaceKey,
  ])

  const submitSearch = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim()
    if (!trimmed) {
      if (filterActive) {
        beginSearchIntent()
        await executeSearch(workspaceKey, '', entry.filters, grouping, sort)
      } else {
        clearSearch()
      }
      return
    }
    const decision = xDriveFileExplorerSearchDecision(rawQuery)
    if (decision.kind === 'clear') {
      if (filterActive) {
        beginSearchIntent()
        await executeSearch(workspaceKey, '', entry.filters, grouping, sort)
      } else {
        clearSearch()
      }
      return
    }
    if (decision.kind === 'invalid') {
      onError(new Error(decision.message))
      return
    }
    beginSearchIntent()
    await executeSearch(workspaceKey, decision.query, entry.filters, grouping, sort)
  }, [
    beginSearchIntent,
    clearSearch,
    entry.filters,
    executeSearch,
    filterActive,
    grouping,
    onError,
    sort,
    workspaceKey,
  ])

  useEffect(() => {
    const retained = retainedWorkspaceKeys ? new Set(retainedWorkspaceKeys) : null
    retained?.add(workspaceKey)
    if (retained) {
      for (const key of Object.keys(requestRef.current)) {
        if (!retained.has(key)) delete requestRef.current[key]
      }
    }
    setEntries((current) => {
      let changed = false
      const next: Record<string, XDriveFileExplorerWorkspaceSearchEntry> = {}
      for (const [key, value] of Object.entries(current)) {
        if (retained && !retained.has(key)) { changed = true; continue }
        if (key !== workspaceKey && (value.loading || value.groups.length > 0 || value.error)) {
          next[key] = { ...value, loading: false, groups: [], error: null }
          changed = true
        } else {
          next[key] = value
        }
      }
      return changed ? next : current
    })
  }, [retainedWorkspaceKeys, workspaceKey])

  useEffect(() => {
    if (!searchActive) {
      if (targetRef.current && targetRef.current.workspaceKey !== workspaceKey) {
        targetRef.current = null
        setTarget(null)
        virtualCollection.reset(`file-explorer:search:idle:${workspaceKey}`)
      }
      return
    }
    const active = targetRef.current
    if (
      active?.workspaceKey === workspaceKey &&
      active.query === entry.query &&
      active.filterSignature === filterSignature &&
      active.groupingSignature === groupingSignature &&
      active.sortSignature === sortSignature
    ) return
    void executeSearch(workspaceKey, entry.query, entry.filters, grouping, sort)
  }, [
    entry.filters,
    entry.query,
    executeSearch,
    filterSignature,
    grouping,
    groupingSignature,
    searchActive,
    sort,
    sort.direction,
    sort.key,
    sortSignature,
    virtualCollection.reset,
    workspaceKey,
  ])

  const activeTarget = (
    target?.workspaceKey === workspaceKey &&
    target.query === entry.query &&
    target.filterSignature === filterSignature &&
    target.groupingSignature === groupingSignature &&
    target.sortSignature === sortSignature
  )
  const searchVirtualItems = activeTarget
    ? virtualCollection.loadedItems
    : new Map<number, TResult>()
  const searchResults = useMemo(
    () => searchActive
      ? [...searchVirtualItems.entries()]
          .sort((left, right) => left[0] - right[0])
          .map((entryValue) => entryValue[1])
      : null,
    [searchActive, searchVirtualItems],
  )

  const searchVirtualCollection = searchActive && activeTarget
    ? {
        itemCount: virtualCollection.totalCount ?? searchResults?.length ?? 0,
        loadedItems: searchVirtualItems,
        itemAt: virtualCollection.itemAt,
        ensureViewport: virtualCollection.ensureViewport,
        collectRange: virtualCollection.collectRange,
        groups: entry.groups,
      }
    : null

  const searchState = {
    query: entry.query,
    filters: entry.filters,
    groups: entry.groups,
    results: searchResults,
    loading: entry.loading,
    error: entry.error,
  }

  const retrySearch = useCallback(async () => {
    if (searchIntentRef.current !== searchIntent || !searchActive) return
    beginSearchIntent()
    await executeSearch(workspaceKey, entry.query, entry.filters, grouping, sort)
  }, [beginSearchIntent, entry.filters, entry.query, executeSearch, grouping, searchActive, searchIntent, sort, workspaceKey])

  return {
    searchValue,
    searchFilters: entry.filters,
    searchState,
    searchResults,
    searchVirtualItems,
    searchVirtualCollection,
    searchLoading: entry.loading,
    searchReady: searchActive && activeTarget && virtualCollection.totalCount !== null && !entry.loading && !entry.error,
    searchError: entry.error,
    retrySearch,
    searchSortMatches: !searchActive || entry.sortSignature === sortSignature,
    changeSearchValue,
    changeSearchFilters,
    clearSearch,
    submitSearch,
    applySearch,
  }
}
