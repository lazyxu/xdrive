import { useMemo, useRef } from 'react'
import type { Node } from '../models'
import {
  xDriveFileExplorerSearchFilterCount,
  xDriveFileExplorerSearchFiltersSignature,
} from '../file-explorer-search'
import {
  xDriveFileExplorerGroupingSignature,
} from '../file-explorer-grouping'
import type {
  XDriveFileExplorerGroupIndex,
  XDriveFileExplorerGrouping,
} from '../file-explorer-grouping'
import {
  xDriveFileExplorerDirectoryCrumbs,
  xDriveFileExplorerDispatchOpenItem,
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
import type {
  XDriveFileExplorerNavigationState,
} from './FileExplorerNavigation'
import {
  useXDriveFileExplorerProjection,
  xDriveProjectFileExplorerNode,
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
  collectRange: (startIndex: number, endIndex: number) => Promise<TNode[] | null>
  groups: readonly XDriveFileExplorerGroupIndex[]
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
  onLoadDirectory,
  loadSearchRange,
  loadRoot,
  findChildDirectory,
  searchCrumbsForResult,
  initialNavigationState,
  onNavigationStateChange,
  onDirectoryAccess,
  onFileAccess,
  onError,
}: {
  items: TNode[]
  crumbs: XDriveFileExplorerWorkspaceCrumb[]
  directoryVirtualCollection?: XDriveFileExplorerWorkspaceVirtualDirectory<TNode> | null
  viewModeStorageKey: string
  onLoadDirectory: (
    id: number,
    crumbs: XDriveFileExplorerWorkspaceCrumb[],
    sort: XDriveFileExplorerSort,
    grouping: XDriveFileExplorerGrouping,
  ) => Promise<boolean | void>
  loadSearchRange: XDriveFileExplorerSearchLoader<TSearch>
  loadRoot: () => Promise<{ id: number }>
  findChildDirectory: (parentID: number, name: string) => Promise<TNode | null | undefined>
  searchCrumbsForResult?: (
    result: TSearch,
  ) => readonly XDriveFileExplorerWorkspaceCrumb[] | undefined
  initialNavigationState?: XDriveFileExplorerNavigationState<XDriveFileExplorerWorkspaceCrumb>
  onNavigationStateChange?: (
    state: XDriveFileExplorerNavigationState<XDriveFileExplorerWorkspaceCrumb>,
  ) => void
  onDirectoryAccess?: (nodeID: number) => void | Promise<void>
  onFileAccess?: (nodeID: number) => void | Promise<void>
  onError: (error: unknown) => void
}) {
  const searchActiveRef = useRef(false)
  const clearSearchRef = useRef<() => void>(() => {})
  const interactionNodeCacheRef = useRef(new Map<number, TNode>())
  const interactionSearchCacheRef = useRef(new Map<number, TSearch>())
  const interactionCacheKeyRef = useRef('')

  const navigation = useXDriveFileExplorerNavigation({
    crumbs,
    viewModeStorageKey,
    searchActive: () => searchActiveRef.current,
    onLoadDirectory,
    initialNavigationState,
    onNavigationStateChange,
    onAfterNavigate: (nextCrumbs) => {
      clearSearchRef.current()
      const target = nextCrumbs.at(-1)
      if (target && nextCrumbs.length > 1) void onDirectoryAccess?.(target.id)
    },
  })

  const search = useXDriveFileExplorerSearch<TSearch>({
    loadRange: loadSearchRange,
    sort: navigation.sort,
    grouping: navigation.grouping,
    onError,
    workspaceKey: navigation.activeTabID,
  })
  searchActiveRef.current = search.searchResults !== null
  clearSearchRef.current = search.clearSearch

  const directoryVirtualItems = search.searchResults === null
    ? directoryVirtualCollection?.loadedItems
    : undefined
  const interactionCacheKey = [
    navigation.activeTabID,
    crumbs.at(-1)?.id ?? 0,
    search.searchResults === null ? '' : search.searchState.query,
    search.searchResults === null ? '' : xDriveFileExplorerSearchFiltersSignature(search.searchState.filters),
    xDriveFileExplorerGroupingSignature(navigation.grouping),
    navigation.sort.key,
    navigation.sort.direction,
  ].join(':')
  if (interactionCacheKeyRef.current !== interactionCacheKey) {
    interactionCacheKeyRef.current = interactionCacheKey
    interactionNodeCacheRef.current.clear()
    interactionSearchCacheRef.current.clear()
  }

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

  for (const [id, node] of interactionNodeCacheRef.current) {
    projection.nodeByID.set(id, node)
  }
  for (const [id, result] of interactionSearchCacheRef.current) {
    projection.searchByID.set(id, result)
  }

  const explorerVirtualCollection = useMemo<XDriveFileExplorerVirtualCollection | undefined>(() => {
    const activeCollection = search.searchResults !== null
      ? search.searchVirtualCollection
      : directoryVirtualCollection
    if (!activeCollection || !projection.virtualExplorerItems) return undefined
    const loadedItems = projection.virtualExplorerItems
    const pathPrefix = crumbs.length > 0
      ? `${crumbs.map((crumb) => crumb.name).join('/')}/`
      : ''
    return {
      interactionKey: interactionCacheKey,
      itemCount: activeCollection.itemCount,
      groups: activeCollection.groups ?? [],
      loadedItems,
      itemAt: (index) => loadedItems.get(index),
      onRangeChange: (startIndex, endIndex) => (
        activeCollection.ensureViewport(startIndex, endIndex)
      ),
      retainInteractionIDs: (ids) => {
        const retained = new Set(ids.map((id) => Number(id)))
        for (const id of interactionNodeCacheRef.current.keys()) {
          if (!retained.has(id)) interactionNodeCacheRef.current.delete(id)
        }
        for (const id of interactionSearchCacheRef.current.keys()) {
          if (!retained.has(id)) interactionSearchCacheRef.current.delete(id)
        }
      },
      collectRange: async (startIndex, endIndex) => {
        const rawItems = await activeCollection.collectRange(startIndex, endIndex)
        if (!rawItems) return null
        const projectedItems = new Array<XDriveFileExplorerItem>(rawItems.length)
        for (let offset = 0; offset < rawItems.length; offset += 1) {
          const index = startIndex + offset
          if (search.searchResults !== null) {
            const result = rawItems[offset] as TSearch
            interactionNodeCacheRef.current.set(result.node.id, result.node)
            interactionSearchCacheRef.current.set(result.node.id, result)
            const item = xDriveProjectFileExplorerNode(
              result.node,
              pathPrefix,
              result.path || undefined,
            )
            loadedItems.set(index, item)
            projectedItems[offset] = item
          } else {
            const node = rawItems[offset] as TNode
            interactionNodeCacheRef.current.set(node.id, node)
            const item = xDriveProjectFileExplorerNode(node, pathPrefix)
            loadedItems.set(index, item)
            projectedItems[offset] = item
          }
        }
        return projectedItems
      },
    }
  }, [
    crumbs,
    directoryVirtualCollection,
    interactionCacheKey,
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

  const searchCrumbsForNode = (node: TNode) => {
    const result = projection.searchByID.get(node.id)
    return result && searchCrumbsForResult
      ? searchCrumbsForResult(result)
      : undefined
  }

  const openItem = async (
    item: XDriveFileExplorerItem,
    openFile: (node: TNode) => void | Promise<void>,
  ) => {
    await xDriveFileExplorerDispatchOpenItem({
      item,
      nodeByID: projection.nodeByID,
      currentCrumbs: crumbs,
      searchCrumbsForNode,
      openFile,
      navigate: navigation.navigateTo,
    })
    if (item.kind === 'file') void onFileAccess?.(Number(item.id))
  }

  const openItemInNewTab = async (item: XDriveFileExplorerItem) => {
    const node = projection.nodeByID.get(Number(item.id))
    if (!node || node.type !== 'dir') return false
    const nextCrumbs = xDriveFileExplorerDirectoryCrumbs(
      node,
      crumbs,
      searchCrumbsForNode(node),
    )
    const opened = await navigation.openTab(nextCrumbs)
    if (opened) void onDirectoryAccess?.(node.id)
    return opened
  }



  return {
    ...search,
    ...projection,
    ...clipboard,
    ...navigation,
    submitPath,
    openItem,
    openItemInNewTab,
    explorerVirtualCollection,
    externallySorted: search.searchResults === null || search.searchSortMatches,
    searchStatusText: search.searchResults
      ? [
          search.searchState.query ? `搜索“${search.searchState.query}”` : '筛选结果',
          xDriveFileExplorerSearchFilterCount(search.searchState.filters) > 0
            ? `· ${xDriveFileExplorerSearchFilterCount(search.searchState.filters)} 个筛选`
            : '',
        ].filter(Boolean).join(' ')
      : undefined,
  }
}
