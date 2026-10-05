import { useRef } from 'react'
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

export type XDriveFileExplorerWorkspaceSearchResult<
  TNode extends Node,
> = XDriveFileExplorerSearchProjection<TNode> & XDriveFileExplorerSearchResultLike

export function useXDriveFileExplorerWorkspace<
  TNode extends Node,
  TSearch extends XDriveFileExplorerWorkspaceSearchResult<TNode>,
>({
  items,
  crumbs,
  viewModeStorageKey,
  directoryHasMore,
  directoryLoadingMore,
  onLoadDirectory,
  onLoadMoreDirectory,
  loadSearchPage,
  loadRoot,
  listChildren,
  searchCrumbsForResult,
  onError,
}: {
  items: TNode[]
  crumbs: XDriveFileExplorerWorkspaceCrumb[]
  viewModeStorageKey: string
  directoryHasMore: boolean
  directoryLoadingMore: boolean
  onLoadDirectory: (
    id: number,
    crumbs: XDriveFileExplorerWorkspaceCrumb[],
    sort: XDriveFileExplorerSort,
  ) => Promise<void>
  onLoadMoreDirectory: (id: number, sort: XDriveFileExplorerSort) => Promise<void>
  loadSearchPage: XDriveFileExplorerSearchLoader<TSearch>
  loadRoot: () => Promise<{ id: number }>
  listChildren: (parentID: number) => Promise<TNode[]>
  searchCrumbsForResult?: (
    result: TSearch,
  ) => readonly XDriveFileExplorerWorkspaceCrumb[] | undefined
  onError: (error: unknown) => void
}) {
  const searchActiveRef = useRef(false)
  const clearSearchRef = useRef<() => void>(() => {})

  const navigation = useXDriveFileExplorerNavigation({
    crumbs,
    viewModeStorageKey,
    searchActive: () => searchActiveRef.current,
    onLoadDirectory,
    onAfterNavigate: () => clearSearchRef.current(),
  })

  const search = useXDriveFileExplorerSearch<TSearch>({
    loadPage: loadSearchPage,
    onError,
    workspaceKey: navigation.activeTabID,
  })
  searchActiveRef.current = search.searchResults !== null
  clearSearchRef.current = search.clearSearch

  const projection = useXDriveFileExplorerProjection<
    TNode,
    TSearch,
    XDriveFileExplorerWorkspaceCrumb
  >({
    items,
    crumbs,
    searchResults: search.searchResults,
  })

  const clipboard = useXDriveFileExplorerClipboard<TNode>({
    nodeByID: projection.nodeByID,
  })

  const submitPath = async (rawPath: string) => {
    try {
      await xDriveFileExplorerSubmitPath({
        rawPath,
        currentCrumbs: crumbs,
        loadRoot,
        listChildren,
        navigate: navigation.navigateTo,
      })
    } catch (error) {
      onError(error)
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
  }

  const explorerPagination = xDriveFileExplorerPaginationController({
    searchActive: search.searchResults !== null,
    searchCursor: search.searchCursor,
    searchLoadingMore: search.searchLoadingMore,
    directoryHasMore,
    directoryLoadingMore,
    currentID: navigation.current?.id,
    sort: navigation.sort,
    loadMoreSearch: search.loadMoreSearch,
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
    externallySorted: search.searchResults === null,
    searchStatusText: search.searchResults
      ? `搜索“${search.searchState.query}”`
      : undefined,
  }
}
