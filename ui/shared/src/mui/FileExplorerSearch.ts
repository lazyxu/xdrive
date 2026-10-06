import { useRef, useState } from 'react'
import {
  xDriveFileExplorerApplySearchPageState,
  xDriveFileExplorerCanLoadMoreSearch,
  xDriveFileExplorerIdleSearchState,
  xDriveFileExplorerSearchDecision,
  xDriveFileExplorerSettleSearchState,
  xDriveFileExplorerStartSearchLoadMoreState,
  xDriveFileExplorerStartSearchState,
} from '../file-explorer-controller'
import type {
  XDriveFileExplorerSearchPage,
  XDriveFileExplorerSearchResultLike,
  XDriveFileExplorerSearchState,
} from '../file-explorer-controller'

export type XDriveFileExplorerSearchLoader<
  TResult extends XDriveFileExplorerSearchResultLike,
> = (
  query: string,
  cursor?: string,
) => Promise<XDriveFileExplorerSearchPage<TResult>>

type XDriveFileExplorerWorkspaceSearchEntry<TResult extends XDriveFileExplorerSearchResultLike> = {
  value: string
  state: XDriveFileExplorerSearchState<TResult>
}

function idleWorkspaceSearchEntry<TResult extends XDriveFileExplorerSearchResultLike>(): XDriveFileExplorerWorkspaceSearchEntry<TResult> {
  return {
    value: '',
    state: xDriveFileExplorerIdleSearchState<TResult>(),
  }
}

export function useXDriveFileExplorerSearch<
  TResult extends XDriveFileExplorerSearchResultLike,
>({
  loadPage,
  onError,
  workspaceKey = 'default',
}: {
  loadPage: XDriveFileExplorerSearchLoader<TResult>
  onError: (error: unknown) => void
  workspaceKey?: string
}) {
  const requestRef = useRef<Record<string, number>>({})
  const loadMoreRequestRef = useRef<Record<string, boolean>>({})
  const resultIDsRef = useRef<Record<string, Set<number>>>({})
  const [entries, setEntries] = useState<Record<string, XDriveFileExplorerWorkspaceSearchEntry<TResult>>>({})

  const entry = entries[workspaceKey] ?? idleWorkspaceSearchEntry<TResult>()
  const searchValue = entry.value
  const searchState = entry.state

  const updateEntry = (
    key: string,
    updater: (
      current: XDriveFileExplorerWorkspaceSearchEntry<TResult>,
    ) => XDriveFileExplorerWorkspaceSearchEntry<TResult>,
  ) => {
    setEntries((current) => ({
      ...current,
      [key]: updater(current[key] ?? idleWorkspaceSearchEntry<TResult>()),
    }))
  }

  const nextRequestID = (key: string) => {
    const next = (requestRef.current[key] ?? 0) + 1
    requestRef.current[key] = next
    loadMoreRequestRef.current[key] = false
    return next
  }

  const clearSearch = () => {
    nextRequestID(workspaceKey)
    delete resultIDsRef.current[workspaceKey]
    updateEntry(workspaceKey, () => idleWorkspaceSearchEntry<TResult>())
  }

  const changeSearchValue = (value: string) => {
    if (!value.trim()) {
      clearSearch()
      return
    }
    updateEntry(workspaceKey, (current) => ({ ...current, value }))
  }

  const submitSearch = async (rawQuery: string) => {
    const decision = xDriveFileExplorerSearchDecision(rawQuery)
    if (decision.kind === 'clear') {
      clearSearch()
      return
    }
    if (decision.kind === 'invalid') {
      onError(new Error(decision.message))
      return
    }

    const key = workspaceKey
    const requestID = nextRequestID(key)
    const resultIDs = new Set<number>()
    resultIDsRef.current[key] = resultIDs
    updateEntry(key, (current) => ({
      value: current.value || decision.query,
      state: xDriveFileExplorerStartSearchState<TResult>(decision.query),
    }))
    try {
      const page = await loadPage(decision.query)
      if (requestID !== requestRef.current[key]) return
      updateEntry(key, (current) => ({
        ...current,
        state: xDriveFileExplorerApplySearchPageState(current.state, page, false, resultIDs),
      }))
    } catch (error) {
      if (requestID === requestRef.current[key]) onError(error)
    } finally {
      if (requestID === requestRef.current[key]) {
        updateEntry(key, (current) => ({
          ...current,
          state: xDriveFileExplorerSettleSearchState(current.state, false),
        }))
      }
    }
  }

  const loadMoreSearch = async () => {
    const currentResults = searchState.results
    if (
      !currentResults ||
      !xDriveFileExplorerCanLoadMoreSearch(
        currentResults,
        searchState.cursor,
        searchState.loadingMore,
      )
    ) return
    if (!searchState.query) return

    const key = workspaceKey
    if (loadMoreRequestRef.current[key]) return
    loadMoreRequestRef.current[key] = true
    let resultIDs = resultIDsRef.current[key]
    if (!resultIDs) {
      resultIDs = new Set(currentResults.map((item) => item.node.id))
      resultIDsRef.current[key] = resultIDs
    }
    const requestID = requestRef.current[key] ?? 0
    updateEntry(key, (current) => ({
      ...current,
      state: xDriveFileExplorerStartSearchLoadMoreState(current.state),
    }))
    try {
      const page = await loadPage(searchState.query, searchState.cursor)
      if (requestID !== requestRef.current[key]) return
      updateEntry(key, (current) => ({
        ...current,
        state: xDriveFileExplorerApplySearchPageState(current.state, page, true, resultIDs),
      }))
    } catch (error) {
      if (requestID === requestRef.current[key]) onError(error)
    } finally {
      loadMoreRequestRef.current[key] = false
      if (requestID === requestRef.current[key]) {
        updateEntry(key, (current) => ({
          ...current,
          state: xDriveFileExplorerSettleSearchState(current.state, true),
        }))
      }
    }
  }

  return {
    searchValue,
    searchState,
    searchResults: searchState.results,
    searchCursor: searchState.cursor,
    searchLoading: searchState.loading,
    searchLoadingMore: searchState.loadingMore,
    changeSearchValue,
    clearSearch,
    submitSearch,
    loadMoreSearch,
  }
}
