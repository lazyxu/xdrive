import type { Node } from './models'

export type XDriveFileExplorerPathNode = Pick<Node, 'id' | 'name' | 'type'>
export type XDriveFileExplorerPathCrumb = { id: number; name: string }

export function xDriveFileExplorerPathParts(rawPath: string, rootName: string) {
  const parts = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts[0] === rootName || parts[0] === '我的文件') parts.shift()
  return parts
}

export async function xDriveResolveFileExplorerPath<
  TNode extends XDriveFileExplorerPathNode,
>({
  rawPath,
  rootID,
  rootName,
  listChildren,
}: {
  rawPath: string
  rootID: number
  rootName: string
  listChildren: (parentID: number) => Promise<TNode[]>
}): Promise<XDriveFileExplorerPathCrumb[]> {
  const parts = xDriveFileExplorerPathParts(rawPath, rootName)
  let parentID = rootID
  const crumbs: XDriveFileExplorerPathCrumb[] = [{ id: rootID, name: rootName }]

  for (const part of parts) {
    const children = await listChildren(parentID)
    const next = children.find((node) => node.type === 'dir' && node.name === part)
    if (!next) throw new Error(`找不到文件夹：${part}`)
    parentID = next.id
    crumbs.push({ id: next.id, name: next.name })
  }

  return crumbs
}

export const XDRIVE_FILE_EXPLORER_SEARCH_MIN_CHARS = 2
export const XDRIVE_FILE_EXPLORER_SEARCH_PAGE_SIZE = 200

export type XDriveFileExplorerSearchDecision =
  | { kind: 'clear'; query: '' }
  | { kind: 'invalid'; query: string; message: string }
  | { kind: 'search'; query: string }

export function xDriveFileExplorerSearchDecision(
  rawQuery: string,
  minChars = XDRIVE_FILE_EXPLORER_SEARCH_MIN_CHARS,
): XDriveFileExplorerSearchDecision {
  const query = rawQuery.trim()
  if (!query) return { kind: 'clear', query: '' }
  if ([...query].length < minChars) {
    return {
      kind: 'invalid',
      query,
      message: `搜索关键字至少需要 ${minChars} 个字符。`,
    }
  }
  return { kind: 'search', query }
}

export type XDriveFileExplorerSearchResultLike = {
  node: { id: number }
}

export function xDriveFileExplorerMergeSearchResults<
  TResult extends XDriveFileExplorerSearchResultLike,
>(
  current: readonly TResult[],
  page: readonly TResult[],
): TResult[] {
  const merged = new Map(current.map((item) => [item.node.id, item] as const))
  for (const item of page) merged.set(item.node.id, item)
  return [...merged.values()]
}

export type XDriveFileExplorerSearchPage<
  TResult extends XDriveFileExplorerSearchResultLike,
> = {
  items: readonly TResult[]
  next_cursor?: string | null
}

export function xDriveFileExplorerSearchPageState<
  TResult extends XDriveFileExplorerSearchResultLike,
>(
  current: readonly TResult[] | null,
  page: XDriveFileExplorerSearchPage<TResult>,
  append: boolean,
) {
  const items = append
    ? xDriveFileExplorerMergeSearchResults(current ?? [], page.items)
    : [...page.items]
  const cursor = page.next_cursor ?? ''
  return {
    items,
    cursor,
    hasMore: Boolean(cursor),
  }
}

export type XDriveFileExplorerSearchState<
  TResult extends XDriveFileExplorerSearchResultLike,
> = {
  query: string
  results: TResult[] | null
  cursor: string
  loading: boolean
  loadingMore: boolean
}

export function xDriveFileExplorerIdleSearchState<
  TResult extends XDriveFileExplorerSearchResultLike,
>(): XDriveFileExplorerSearchState<TResult> {
  return {
    query: '',
    results: null,
    cursor: '',
    loading: false,
    loadingMore: false,
  }
}

export function xDriveFileExplorerStartSearchState<
  TResult extends XDriveFileExplorerSearchResultLike,
>(query: string): XDriveFileExplorerSearchState<TResult> {
  return {
    query,
    results: [],
    cursor: '',
    loading: true,
    loadingMore: false,
  }
}

export function xDriveFileExplorerStartSearchLoadMoreState<
  TResult extends XDriveFileExplorerSearchResultLike,
>(
  current: XDriveFileExplorerSearchState<TResult>,
): XDriveFileExplorerSearchState<TResult> {
  return {
    ...current,
    loadingMore: true,
  }
}

export function xDriveFileExplorerApplySearchPageState<
  TResult extends XDriveFileExplorerSearchResultLike,
>(
  current: XDriveFileExplorerSearchState<TResult>,
  page: XDriveFileExplorerSearchPage<TResult>,
  append: boolean,
): XDriveFileExplorerSearchState<TResult> {
  const nextPage = xDriveFileExplorerSearchPageState(current.results, page, append)
  return {
    ...current,
    results: nextPage.items,
    cursor: nextPage.cursor,
    loading: false,
    loadingMore: false,
  }
}

export function xDriveFileExplorerSettleSearchState<
  TResult extends XDriveFileExplorerSearchResultLike,
>(
  current: XDriveFileExplorerSearchState<TResult>,
  append: boolean,
): XDriveFileExplorerSearchState<TResult> {
  return append
    ? { ...current, loadingMore: false }
    : { ...current, loading: false }
}

export function xDriveFileExplorerCanLoadMoreSearch<
  TResult extends XDriveFileExplorerSearchResultLike,
>(
  results: readonly TResult[] | null,
  cursor: string,
  loadingMore: boolean,
) {
  return results !== null && Boolean(cursor) && !loadingMore
}

export function xDriveFileExplorerPaginationPresentation({
  searchActive,
  searchCursor,
  searchLoadingMore,
  directoryHasMore,
  directoryLoadingMore,
}: {
  searchActive: boolean
  searchCursor: string
  searchLoadingMore: boolean
  directoryHasMore: boolean
  directoryLoadingMore: boolean
}) {
  return searchActive
    ? {
        mode: 'search' as const,
        hasMore: Boolean(searchCursor),
        loadingMore: searchLoadingMore,
      }
    : {
        mode: 'directory' as const,
        hasMore: directoryHasMore,
        loadingMore: directoryLoadingMore,
      }
}

export type XDriveFileExplorerSelectionItem = { id: string | number }
export type XDriveFileExplorerOperationNode = Pick<Node, 'id' | 'revision' | 'parent_id'>
export type XDriveFileExplorerOperationRef = { id: number; revision: number }
export type XDriveFileExplorerClipboardMode = 'copy' | 'cut'

export type XDriveFileExplorerClipboard<
  TNode extends Pick<Node, 'id'>,
> = {
  mode: XDriveFileExplorerClipboardMode
  nodes: TNode[]
}

export function xDriveFileExplorerClipboardFromItems<
  TNode extends Pick<Node, 'id'>,
>(
  mode: XDriveFileExplorerClipboardMode,
  selected: XDriveFileExplorerSelectionItem[],
  nodeByID: ReadonlyMap<number, TNode>,
): XDriveFileExplorerClipboard<TNode> | null {
  const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
  return nodes.length > 0 ? { mode, nodes } : null
}

export function xDriveFileExplorerCanPaste<
  TNode extends Pick<Node, 'id'>,
>(
  clipboard: XDriveFileExplorerClipboard<TNode> | null | undefined,
  busy: boolean,
) {
  return Boolean(clipboard?.nodes.length) && !busy
}
export type XDriveFileExplorerCopyMoveOperation = 'copy' | 'move'

export function xDriveFileExplorerNodesForItems<TNode extends Pick<Node, 'id'>>(
  selected: XDriveFileExplorerSelectionItem[],
  nodeByID: ReadonlyMap<number, TNode>,
): TNode[] {
  return selected
    .map((item) => nodeByID.get(Number(item.id)))
    .filter((node): node is TNode => Boolean(node))
}

export function xDriveFileExplorerClipboardOperationPlan<
  TNode extends XDriveFileExplorerOperationNode,
>(
  mode: XDriveFileExplorerClipboardMode,
  nodes: TNode[],
  targetParentID: number,
) {
  const operation: XDriveFileExplorerCopyMoveOperation = mode === 'cut' ? 'move' : 'copy'
  const effectiveNodes = mode === 'cut'
    ? nodes.filter((node) => node.parent_id !== targetParentID)
    : nodes

  return {
    operation,
    parentID: targetParentID,
    items: effectiveNodes.map((node) => ({ id: node.id, revision: node.revision })),
    count: effectiveNodes.length,
    clearClipboard: mode === 'cut',
  }
}

export function xDriveFileExplorerDropOperationPlan<
  TNode extends XDriveFileExplorerOperationNode,
>(
  operation: XDriveFileExplorerCopyMoveOperation,
  nodes: TNode[],
  targetParentID: number,
) {
  const effectiveNodes = nodes.filter((node) => node.id !== targetParentID)
  return {
    operation,
    parentID: targetParentID,
    items: effectiveNodes.map((node) => ({ id: node.id, revision: node.revision })),
    count: effectiveNodes.length,
  }
}

export function xDriveFileExplorerDropItemsPlan<
  TNode extends XDriveFileExplorerOperationNode & Pick<Node, 'type'>,
>(
  operation: XDriveFileExplorerCopyMoveOperation,
  selected: XDriveFileExplorerSelectionItem[],
  target: XDriveFileExplorerSelectionItem,
  nodeByID: ReadonlyMap<number, TNode>,
) {
  const targetNode = xDriveFileExplorerNodeForItem(target, nodeByID)
  if (!targetNode || targetNode.type !== 'dir') return null
  const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
  const plan = xDriveFileExplorerDropOperationPlan(operation, nodes, targetNode.id)
  return plan.count > 0 ? plan : null
}

export function xDriveFileExplorerOperationQueuedMessage(
  operation: XDriveFileExplorerCopyMoveOperation,
  count: number,
) {
  return operation === 'copy'
    ? `已将 ${count} 个项目加入复制任务。`
    : `已将 ${count} 个项目加入移动任务。`
}

export type XDriveFileExplorerDownloadNode = Pick<Node, 'id' | 'name' | 'type'>

export function xDriveFileExplorerDownloadPlan<TNode extends XDriveFileExplorerDownloadNode>(
  nodes: TNode[],
) {
  const files = nodes.filter((node) => node.type === 'file')
  return {
    files,
    items: files.map((node) => ({ id: node.id, name: node.name })),
    skippedFolders: nodes.length - files.length,
  }
}

export type XDriveFileExplorerFeedback = {
  tone: 'good' | 'warning'
  message: string
}

export function xDriveFileExplorerWebDownloadFeedback(
  fileCount: number,
  skippedFolders: number,
): XDriveFileExplorerFeedback {
  return skippedFolders > 0
    ? {
        tone: 'warning',
        message: `已下载 ${fileCount} 个文件，跳过 ${skippedFolders} 个文件夹。`,
      }
    : {
        tone: 'good',
        message: `已开始下载 ${fileCount} 个文件。`,
      }
}

export function xDriveFileExplorerDesktopDownloadFeedback({
  downloaded,
  failed,
  skippedFolders,
}: {
  downloaded: number
  failed: number
  skippedFolders: number
}): XDriveFileExplorerFeedback {
  if (failed > 0) {
    return {
      tone: 'warning',
      message: `已下载 ${downloaded} 个文件，${failed} 个失败。`,
    }
  }
  if (skippedFolders > 0) {
    return {
      tone: 'warning',
      message: `已下载 ${downloaded} 个文件，跳过 ${skippedFolders} 个文件夹。`,
    }
  }
  return {
    tone: 'good',
    message: `已下载 ${downloaded} 个文件。`,
  }
}

export function xDriveFileExplorerExternalDropParentID<
  TNode extends Pick<Node, 'id' | 'type'>,
>(
  currentParentID: number,
  target: XDriveFileExplorerSelectionItem | undefined,
  nodeByID: ReadonlyMap<number, TNode>,
) {
  const targetNode = target ? nodeByID.get(Number(target.id)) : undefined
  return targetNode?.type === 'dir' ? targetNode.id : currentParentID
}

export type XDriveFileExplorerCrumb = { id: number; name: string }

export function xDriveFileExplorerNormalizeCrumbs(
  crumbs: readonly XDriveFileExplorerCrumb[],
  rootName = '我的文件',
): XDriveFileExplorerCrumb[] {
  return crumbs.map((crumb, index) => ({
    id: crumb.id,
    name: index === 0 && !crumb.name ? rootName : crumb.name,
  }))
}

export function xDriveFileExplorerDirectoryCrumbs<
  TNode extends Pick<Node, 'id' | 'name'>,
>(
  node: TNode,
  currentCrumbs: readonly XDriveFileExplorerCrumb[],
  searchCrumbs?: readonly XDriveFileExplorerCrumb[],
): XDriveFileExplorerCrumb[] {
  if (searchCrumbs && searchCrumbs.length > 0) {
    return xDriveFileExplorerNormalizeCrumbs(searchCrumbs)
  }
  return [...currentCrumbs, { id: node.id, name: node.name }]
}

export function xDriveFileExplorerNodeForItem<
  TNode extends Pick<Node, 'id'>,
>(
  item: XDriveFileExplorerSelectionItem,
  nodeByID: ReadonlyMap<number, TNode>,
): TNode | undefined {
  return nodeByID.get(Number(item.id))
}

export type XDriveFileExplorerOpenItemNode = Pick<Node, 'id' | 'name' | 'type'>

export type XDriveFileExplorerOpenItemPlan<
  TNode extends XDriveFileExplorerOpenItemNode,
> =
  | { kind: 'file'; node: TNode }
  | { kind: 'directory'; node: TNode; crumbs: XDriveFileExplorerCrumb[] }

export function xDriveFileExplorerOpenItemPlan<
  TNode extends XDriveFileExplorerOpenItemNode,
>(
  node: TNode,
  currentCrumbs: readonly XDriveFileExplorerCrumb[],
  searchCrumbs?: readonly XDriveFileExplorerCrumb[],
): XDriveFileExplorerOpenItemPlan<TNode> {
  if (node.type === 'file') return { kind: 'file', node }
  return {
    kind: 'directory',
    node,
    crumbs: xDriveFileExplorerDirectoryCrumbs(node, currentCrumbs, searchCrumbs),
  }
}

export function xDriveFileExplorerDeleteOperationPlan<
  TNode extends Pick<Node, 'id' | 'revision'>,
>(nodes: readonly TNode[]) {
  const count = nodes.length
  return {
    operation: 'delete' as const,
    items: nodes.map((node) => ({ id: node.id, revision: node.revision })),
    count,
    message: `已将 ${count} 个项目加入删除任务。`,
  }
}

export type XDriveFileExplorerPageSort = {
  key: string
  direction: string
}

export const XDRIVE_FILE_EXPLORER_DEFAULT_SORT = {
  key: 'name',
  direction: 'asc',
} as const satisfies XDriveFileExplorerPageSort

export type XDriveFileExplorerPageState<
  TSort extends XDriveFileExplorerPageSort,
> = {
  parentID: number
  cursor: string
  hasMore: boolean
  sort: TSort
}

export function xDriveFileExplorerCanLoadMore<
  TSort extends XDriveFileExplorerPageSort,
>(
  pageState: XDriveFileExplorerPageState<TSort> | null | undefined,
  parentID: number,
  sort: TSort,
  loadingMore: boolean,
): pageState is XDriveFileExplorerPageState<TSort> {
  return Boolean(
    pageState &&
    pageState.parentID === parentID &&
    pageState.hasMore &&
    pageState.cursor &&
    pageState.sort.key === sort.key &&
    pageState.sort.direction === sort.direction &&
    !loadingMore
  )
}

export function xDriveFileExplorerMergePageItems<
  TItem extends { id: number },
>(
  currentItems: readonly TItem[],
  pageItems: readonly TItem[],
): TItem[] {
  const merged = new Map(currentItems.map((item) => [item.id, item] as const))
  for (const item of pageItems) merged.set(item.id, item)
  return [...merged.values()]
}

export const XDRIVE_FILE_EXPLORER_PAGE_SIZE = 200

export type XDriveFileExplorerPageRequestOptions<
  TSort extends XDriveFileExplorerPageSort,
> = {
  limit: number
  cursor?: string
  sort: TSort['key']
  order: TSort['direction']
}

export function xDriveFileExplorerPageRequestOptions<
  TSort extends XDriveFileExplorerPageSort,
>(
  sort: TSort,
  cursor = '',
): XDriveFileExplorerPageRequestOptions<TSort> {
  return {
    limit: XDRIVE_FILE_EXPLORER_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    sort: sort.key,
    order: sort.direction,
  }
}

export type XDriveFileExplorerPageResult = {
  next_cursor?: string
  has_more: boolean
}

export function xDriveFileExplorerPageStateFromResult<
  TSort extends XDriveFileExplorerPageSort,
>(
  parentID: number,
  page: XDriveFileExplorerPageResult,
  sort: TSort,
): XDriveFileExplorerPageState<TSort> {
  return {
    parentID,
    cursor: page.next_cursor ?? '',
    hasMore: page.has_more,
    sort,
  }
}

export type XDriveFileExplorerDirectoryPage<TItem> = XDriveFileExplorerPageResult & {
  items: readonly TItem[]
}

export function xDriveFileExplorerDirectoryPageTransition<
  TItem extends { id: number },
  TSort extends XDriveFileExplorerPageSort,
>(
  parentID: number,
  page: XDriveFileExplorerDirectoryPage<TItem>,
  sort: TSort,
  append: boolean,
) {
  return {
    pageState: xDriveFileExplorerPageStateFromResult(parentID, page, sort),
    applyItems: (currentItems: readonly TItem[]) => (
      append
        ? xDriveFileExplorerMergePageItems(currentItems, page.items)
        : [...page.items]
    ),
  }
}
