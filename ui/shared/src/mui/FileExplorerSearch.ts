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

export function useXDriveFileExplorerSearch<
  TResult extends XDriveFileExplorerSearchResultLike,
>({
  loadPage,
  onError,
}: {
  loadPage: XDriveFileExplorerSearchLoader<TResult>
  onError: (error: unknown) => void
}) {
  const requestRef = useRef(0)
  const [searchValue, setSearchValueState] = useState('')
  const [searchState, setSearchState] = useState<XDriveFileExplorerSearchState<TResult>>(
    () => xDriveFileExplorerIdleSearchState<TResult>(),
  )

  const clearSearch = () => {
    requestRef.current += 1
    setSearchValueState('')
    setSearchState(xDriveFileExplorerIdleSearchState<TResult>())
  }

  const changeSearchValue = (value: string) => {
    if (!value.trim()) {
      clearSearch()
      return
    }
    setSearchValueState(value)
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

    const requestID = ++requestRef.current
    setSearchState(xDriveFileExplorerStartSearchState<TResult>(decision.query))
    try {
      const page = await loadPage(decision.query)
      if (requestID !== requestRef.current) return
      setSearchState((current) => (
        xDriveFileExplorerApplySearchPageState(current, page, false)
      ))
    } catch (error) {
      if (requestID === requestRef.current) onError(error)
    } finally {
      if (requestID === requestRef.current) {
        setSearchState((current) => (
          xDriveFileExplorerSettleSearchState(current, false)
        ))
      }
    }
  }

  const loadMoreSearch = async () => {
    if (!xDriveFileExplorerCanLoadMoreSearch(
      searchState.results,
      searchState.cursor,
      searchState.loadingMore,
    )) return
    if (!searchState.query) return

    const requestID = requestRef.current
    setSearchState((current) => xDriveFileExplorerStartSearchLoadMoreState(current))
    try {
      const page = await loadPage(searchState.query, searchState.cursor)
      if (requestID !== requestRef.current) return
      setSearchState((current) => (
        xDriveFileExplorerApplySearchPageState(current, page, true)
      ))
    } catch (error) {
      if (requestID === requestRef.current) onError(error)
    } finally {
      if (requestID === requestRef.current) {
        setSearchState((current) => (
          xDriveFileExplorerSettleSearchState(current, true)
        ))
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
