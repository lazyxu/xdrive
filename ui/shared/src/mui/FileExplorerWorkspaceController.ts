import { useMemo, useRef } from 'react'
import type { Node } from '../models'
import {
  xDriveFileExplorerDispatchOpenItem,
  xDriveFileExplorerPaginationController,
  xDriveFileExplorerSubmitPath,
} from '../file-explorer-controller'
import type { XDriveFileExplorerSearchResultLike } from '../file-explorer-controller'
import type {
  XDriveFileExplorerItem,
  XDriveFileExplorerSort,
  XDriveFileExplorerVirtualCollection,
} from './FileExplorer'
import {
  useXDriveFileExplorerClipboard,
} from './FileExplorerClipboard'
import {
  useXDriveFileExplorerNavigation,
} from './FileExplorerNavigation'
import {
  useXDriveFileExplorerProjection,
} from './FileExplorerProjection'
import type {
  XDriveFileExplorerSearchProjection,
} from './FileExplorerProjection'
import {
  useXDriveFileExplorerSearch,
} from './FileExplorerSearch'
import type {
  XDriveFileExplorerSearchLoader,
} from './FileExplorerSearch'

export type XDriveFileExplorerWorkspaceCrumb = {
  id: number
  name: string
}

export type XDriveFileExplorerWorkspaceVirtualDirectory<
  TNode extends Node,
> = {
  itemCount: number
  loadedItems: ReadonlyMap<number, TNode>
  itemAt: (index: number) => TNode | undefined
  ensureViewport: (startIndex: number, endIndex: number) => Promise<void>
}

export type XDriveFileExplorerWorkspaceSearchResult<
  TNode extends Node,
> = XDriveFileExplorerSearchProjection<TNode> & XDriveFileExplorerSearchResultLike

export function useXDriveFileExplorerWorkspace<
  TNode extends Node,
  TSearch extends XDriveFileExplorerWorkspaceSearchResult<TNode>,
>({
  items,
  crumbs,
  directoryVirtualCollection,
  viewModeStorageKey,
  directoryHasMore,
  directoryLoadingMore,
  onLoadDirectory,
  onLoadMoreDirectory,
  loadSearchRange,
  loadRoot,
  findChildDirectory,
  searchCrumbsForResult,
  onDirectoryAccess,
  onFileAccess,
  onError,
}: {
  items: TNode[]
  crumbs: XDriveFileExplorerWorkspaceCrumb[]
  directoryVirtualCollection?: XDriveFileExplorerWorkspaceVirtualDirectory<TNode> | null
  viewModeStorageKey: string
  directoryHasMore: boolean
  directoryLoadingMore: boolean
  onLoadDirectory: (
    id: number,
    crumbs: XDriveFileExplorerWorkspaceCrumb[],
    sort: XDriveFileExplorerSort,
  ) => Promise<void>
  onLoadMoreDirectory: (id: number, sort: XDriveFileExplorerSort) => Promise<void>
  loadSearchRange: XDriveFileExplorerSearchLoader<TSearch>
  loadRoot: () => Promise<{ id: number }>
  findChildDirectory: (parentID: number, name: string) => Promise<TNode | null | undefined>
  searchCrumbsForResult?: (
    result: TSearch,
  ) => readonly XDriveFileExplorerWorkspaceCrumb[] | undefined
  onDirectoryAccess?: (nodeID: number) => void | Promise<void>
  onFileAccess?: (nodeID: number) => void | Promise<void>
  onError: (error: unknown) => void
}) {
  const searchActiveRef = useRef(false)
  const clearSearchRef = useRef<() => void>(() => {})

  const navigation = useXDriveFileExplorerNavigation({
    crumbs,
    viewModeStorageKey,
    searchActive: () => searchActiveRef.current,
    onLoadDirectory,
    onAfterNavigate: (nextCrumbs) => {
      clearSearchRef.current()
      const target = nextCrumbs.at(-1)
      if (target && nextCrumbs.length > 1) void onDirectoryAccess?.(target.id)
    },
  })

  const search = useXDriveFileExplorerSearch<TSearch>({
    loadRange: loadSearchRange,
    sort: navigation.sort,
    onError,
    workspaceKey: navigation.activeTabID,
  })
  searchActiveRef.current = search.searchResults !== null
  clearSearchRef.current = search.clearSearch

  const directoryVirtualItems = search.searchResults === null
    ? directoryVirtualCollection?.loadedItems
    : undefined
  const projection = useXDriveFileExplorerProjection<
    TNode,
    TSearch,
    XDriveFileExplorerWorkspaceCrumb
  >({
    items,
    crumbs,
    searchResults: search.searchResults,
    virtualItems: directoryVirtualItems,
    virtualSearchItems: search.searchResults !== null
      ? search.searchVirtualItems
      : undefined,
  })

  const explorerVirtualCollection = useMemo<XDriveFileExplorerVirtualCollection | undefined>(() => {
    const activeCollection = search.searchResults !== null
      ? search.searchVirtualCollection
      : directoryVirtualCollection
    if (!activeCollection || !projection.virtualExplorerItems) return undefined
    const loadedItems = projection.virtualExplorerItems
    return {
      itemCount: activeCollection.itemCount,
      loadedItems,
      itemAt: (index) => loadedItems.get(index),
      onRangeChange: (startIndex, endIndex) => (
        activeCollection.ensureViewport(startIndex, endIndex)
      ),
    }
  }, [
    directoryVirtualCollection,
    projection.virtualExplorerItems,
    search.searchResults,
    search.searchVirtualCollection,
  ])

  const clipboard = useXDriveFileExplorerClipboard<TNode>({
    nodeByID: projection.nodeByID,
  })

  const submitPath = async (rawPath: string) => {
    const navigationIntentID = navigation.beginNavigationIntent()
    try {
      await xDriveFileExplorerSubmitPath({
        rawPath,
        currentCrumbs: crumbs,
        loadRoot,
        findChildDirectory,
        navigate: async (nextCrumbs) => {
          await navigation.navigateTo(nextCrumbs, true, navigationIntentID)
        },
      })
    } catch (error) {
      if (navigation.isNavigationIntentCurrent(navigationIntentID)) onError(error)
    }
  }

  const openItem = async (
    item: XDriveFileExplorerItem,
    openFile: (node: TNode) => void | Promise<void>,
  ) => {
    await xDriveFileExplorerDispatchOpenItem({
      item,
      nodeByID: projection.nodeByID,
      currentCrumbs: crumbs,
      searchCrumbsForNode: (node) => {
        const result = projection.searchByID.get(node.id)
        return result && searchCrumbsForResult
          ? searchCrumbsForResult(result)
          : undefined
      },
      openFile,
      navigate: navigation.navigateTo,
    })
    if (item.kind === 'file') void onFileAccess?.(Number(item.id))
  }

  const explorerPagination = xDriveFileExplorerPaginationController({
    directoryHasMore: search.searchResults === null && directoryHasMore,
    directoryLoadingMore: search.searchResults === null && directoryLoadingMore,
    currentID: navigation.current?.id,
    sort: navigation.sort,
    loadMoreDirectory: onLoadMoreDirectory,
  })

  return {
    ...search,
    ...projection,
    ...clipboard,
    ...navigation,
    submitPath,
    openItem,
    explorerPagination,
    explorerVirtualCollection,
    externallySorted: search.searchResults === null || search.searchSortMatches,
    searchStatusText: search.searchResults
      ? `搜索“${search.searchState.query}”`
      : undefined,
  }
}
