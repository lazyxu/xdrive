import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  xDriveFileExplorerSearchDecision,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerSearchResultLike,
} from '../file-explorer-controller'
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
}

export type XDriveFileExplorerSearchLoader<
  TResult extends XDriveFileExplorerSearchResultLike,
> = (
  query: string,
  sort: XDriveFileExplorerSort,
  offset: number,
  limit: number,
) => Promise<XDriveFileExplorerSearchRange<TResult>>

type XDriveFileExplorerWorkspaceSearchEntry = {
  value: string
  query: string
  sortSignature: string
  loading: boolean
}

type XDriveFileExplorerSearchTarget = {
  workspaceKey: string
  query: string
  sort: XDriveFileExplorerSort
  sortSignature: string
  requestID: number
}

function idleWorkspaceSearchEntry(): XDriveFileExplorerWorkspaceSearchEntry {
  return {
    value: '',
    query: '',
    sortSignature: '',
    loading: false,
  }
}

function searchQueryKey(target: XDriveFileExplorerSearchTarget | null) {
  if (!target) return 'file-explorer:search:idle'
  return [
    'file-explorer:search',
    target.workspaceKey,
    target.query,
    target.sortSignature,
    target.requestID,
  ].join(':')
}

export function useXDriveFileExplorerSearch<
  TResult extends XDriveFileExplorerSearchResultLike,
>({
  loadRange,
  sort,
  onError,
  workspaceKey = 'default',
}: {
  loadRange: XDriveFileExplorerSearchLoader<TResult>
  sort: XDriveFileExplorerSort
  onError: (error: unknown) => void
  workspaceKey?: string
}) {
  const requestRef = useRef<Record<string, number>>({})
  const targetRef = useRef<XDriveFileExplorerSearchTarget | null>(null)
  const [target, setTarget] = useState<XDriveFileExplorerSearchTarget | null>(null)
  const [entries, setEntries] = useState<Record<string, XDriveFileExplorerWorkspaceSearchEntry>>({})

  const entry = entries[workspaceKey] ?? idleWorkspaceSearchEntry()
  const searchValue = entry.value
  const sortSignature = searchSortSignature(sort)

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
    const next = (requestRef.current[key] ?? 0) + 1
    requestRef.current[key] = next
    return next
  }, [])

  const targetIsCurrent = useCallback((candidate: XDriveFileExplorerSearchTarget) => (
    requestRef.current[candidate.workspaceKey] === candidate.requestID &&
    targetRef.current?.workspaceKey === candidate.workspaceKey &&
    targetRef.current.requestID === candidate.requestID
  ), [])

  const loadVirtualRange = useCallback(async (
    range: { offset: number; limit: number },
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
    return loadRange(
      active.query,
      active.sort,
      range.offset,
      range.limit,
    )
  }, [loadRange])

  const virtualCollection = useXDriveVirtualCollection<TResult>({
    queryKey: searchQueryKey(target),
    loadRange: loadVirtualRange,
    onError,
    pageSize: XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
  })

  const executeSearch = useCallback(async (
    key: string,
    query: string,
    targetSort: XDriveFileExplorerSort,
  ) => {
    const requestID = nextRequestID(key)
    const nextTarget: XDriveFileExplorerSearchTarget = {
      workspaceKey: key,
      query,
      sort: targetSort,
      sortSignature: searchSortSignature(targetSort),
      requestID,
    }
    targetRef.current = nextTarget
    setTarget(nextTarget)
    virtualCollection.reset(searchQueryKey(nextTarget))
    updateEntry(key, (current) => ({
      value: current.value || query,
      query,
      sortSignature: nextTarget.sortSignature,
      loading: true,
    }))

    try {
      const page = await loadRange(
        query,
        targetSort,
        0,
        XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE,
      )
      if (!targetIsCurrent(nextTarget)) return
      virtualCollection.primePage(page)
    } catch (error) {
      if (targetIsCurrent(nextTarget)) onError(error)
    } finally {
      if (targetIsCurrent(nextTarget)) {
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
    nextRequestID(workspaceKey)
    if (targetRef.current?.workspaceKey === workspaceKey) {
      targetRef.current = null
      setTarget(null)
      virtualCollection.reset(`file-explorer:search:idle:${workspaceKey}`)
    }
    updateEntry(workspaceKey, () => idleWorkspaceSearchEntry())
  }, [nextRequestID, updateEntry, virtualCollection.reset, workspaceKey])

  const changeSearchValue = useCallback((value: string) => {
    if (!value.trim()) {
      clearSearch()
      return
    }
    updateEntry(workspaceKey, (current) => ({ ...current, value }))
  }, [clearSearch, updateEntry, workspaceKey])

  const submitSearch = useCallback(async (rawQuery: string) => {
    const decision = xDriveFileExplorerSearchDecision(rawQuery)
    if (decision.kind === 'clear') {
      clearSearch()
      return
    }
    if (decision.kind === 'invalid') {
      onError(new Error(decision.message))
      return
    }
    await executeSearch(workspaceKey, decision.query, sort)
  }, [clearSearch, executeSearch, onError, sort, workspaceKey])

  useEffect(() => {
    if (!entry.query) {
      if (targetRef.current?.workspaceKey !== workspaceKey) {
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
      active.sortSignature === sortSignature
    ) return
    void executeSearch(workspaceKey, entry.query, sort)
  }, [
    entry.query,
    executeSearch,
    sort.direction,
    sort.key,
    sortSignature,
    virtualCollection.reset,
    workspaceKey,
  ])

  const activeTarget = (
    target?.workspaceKey === workspaceKey &&
    target.query === entry.query &&
    target.sortSignature === sortSignature
  )
  const searchActive = Boolean(entry.query)
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
      }
    : null

  const searchState = {
    query: entry.query,
    results: searchResults,
    cursor: '',
    loading: entry.loading,
    loadingMore: false,
  }

  return {
    searchValue,
    searchState,
    searchResults,
    searchVirtualItems,
    searchVirtualCollection,
    searchCursor: '',
    searchLoading: entry.loading,
    searchLoadingMore: false,
    searchSortMatches: !searchActive || entry.sortSignature === sortSignature,
    changeSearchValue,
    clearSearch,
    submitSearch,
    loadMoreSearch: async () => {},
  }
}
