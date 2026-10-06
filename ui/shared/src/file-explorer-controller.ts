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

export function xDriveFileExplorerPathLookupPageOptions(name: string) {
  return {
    limit: 1,
    sort: 'name' as const,
    order: 'asc' as const,
    name,
  }
}

export function xDriveFileExplorerCaseInsensitiveNameLookupPageOptions(name: string) {
  return {
    limit: 1,
    sort: 'name' as const,
    order: 'asc' as const,
    nameInsensitive: name,
  }
}

export async function xDriveResolveFileExplorerPath<
  TNode extends XDriveFileExplorerPathNode,
>({
  rawPath,
  rootID,
  rootName,
  findChildDirectory,
}: {
  rawPath: string
  rootID: number
  rootName: string
  findChildDirectory: (parentID: number, name: string) => Promise<TNode | null | undefined>
}): Promise<XDriveFileExplorerPathCrumb[]> {
  const parts = xDriveFileExplorerPathParts(rawPath, rootName)
  let parentID = rootID
  const crumbs: XDriveFileExplorerPathCrumb[] = [{ id: rootID, name: rootName }]

  for (const part of parts) {
    const next = await findChildDirectory(parentID, part)
    if (!next || next.type !== 'dir' || next.name !== part) {
      throw new Error(`找不到文件夹：${part}`)
    }
    parentID = next.id
    crumbs.push({ id: next.id, name: next.name })
  }

  return crumbs
}

export type XDriveFileExplorerPathRoot = { id: number }

export async function xDriveFileExplorerSubmitPath<
  TNode extends XDriveFileExplorerPathNode,
>({
  rawPath,
  currentCrumbs,
  loadRoot,
  findChildDirectory,
  navigate,
}: {
  rawPath: string
  currentCrumbs: readonly XDriveFileExplorerPathCrumb[]
  loadRoot: () => Promise<XDriveFileExplorerPathRoot>
  findChildDirectory: (parentID: number, name: string) => Promise<TNode | null | undefined>
  navigate: (crumbs: XDriveFileExplorerPathCrumb[]) => Promise<void>
}) {
  const root = await loadRoot()
  const rootName = currentCrumbs[0]?.name || '我的文件'
  const nextCrumbs = await xDriveResolveFileExplorerPath({
    rawPath,
    rootID: root.id,
    rootName,
    findChildDirectory,
  })
  await navigate(nextCrumbs)
  return nextCrumbs
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

export function xDriveFileExplorerPaginationPresentation({
  directoryHasMore,
  directoryLoadingMore,
}: {
  directoryHasMore: boolean
  directoryLoadingMore: boolean
}) {
  return {
    mode: 'directory' as const,
    hasMore: directoryHasMore,
    loadingMore: directoryLoadingMore,
  }
}

export function xDriveFileExplorerPaginationController<TID, TSort>({
  directoryHasMore,
  directoryLoadingMore,
  currentID,
  sort,
  loadMoreDirectory,
}: {
  directoryHasMore: boolean
  directoryLoadingMore: boolean
  currentID: TID | null | undefined
  sort: TSort
  loadMoreDirectory: (id: TID, sort: TSort) => void | Promise<void>
}) {
  const presentation = xDriveFileExplorerPaginationPresentation({
    directoryHasMore,
    directoryLoadingMore,
  })

  const onLoadMore = () => {
    if (currentID === null || currentID === undefined) return
    void loadMoreDirectory(currentID, sort)
  }

  return {
    ...presentation,
    onLoadMore,
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
  const effectiveNodes = nodes.filter((node) => (
    node.id !== targetParentID &&
    (operation !== 'move' || node.parent_id !== targetParentID)
  ))
  return {
    operation,
    parentID: targetParentID,
    items: effectiveNodes.map((node) => ({ id: node.id, revision: node.revision })),
    count: effectiveNodes.length,
  }
}

export function xDriveFileExplorerDropItemsToParentPlan<
  TNode extends XDriveFileExplorerOperationNode,
>(
  operation: XDriveFileExplorerCopyMoveOperation,
  selected: XDriveFileExplorerSelectionItem[],
  targetParentID: number,
  nodeByID: ReadonlyMap<number, TNode>,
) {
  const nodes = xDriveFileExplorerNodesForItems(selected, nodeByID)
  const plan = xDriveFileExplorerDropOperationPlan(operation, nodes, targetParentID)
  return plan.count > 0 ? plan : null
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
  return xDriveFileExplorerDropItemsToParentPlan(
    operation,
    selected,
    targetNode.id,
    nodeByID,
  )
}

export function xDriveFileExplorerDragAutoScrollDelta(
  pointerY: number,
  top: number,
  bottom: number,
  edgeSize = 56,
  maxSpeed = 24,
) {
  const height = bottom - top
  if (!Number.isFinite(pointerY) || !Number.isFinite(height) || height <= 0) return 0
  const edge = Math.max(1, Math.min(edgeSize, height / 2))
  const speed = Math.max(1, maxSpeed)

  const topDistance = Math.max(0, pointerY - top)
  if (topDistance < edge) {
    return -Math.max(1, Math.ceil(speed * (1 - topDistance / edge)))
  }

  const bottomDistance = Math.max(0, bottom - pointerY)
  if (bottomDistance < edge) {
    return Math.max(1, Math.ceil(speed * (1 - bottomDistance / edge)))
  }

  return 0
}

export function xDriveFileExplorerOperationQueuedMessage(
  operation: XDriveFileExplorerCopyMoveOperation,
  count: number,
) {
  return operation === 'copy'
    ? `已将 ${count} 个项目加入复制任务。`
    : `已将 ${count} 个项目加入移动任务。`
}

export type XDriveFileExplorerQueuedOperationPlan = {
  operation: XDriveFileExplorerCopyMoveOperation
  parentID: number
  items: XDriveFileExplorerOperationRef[]
  count: number
}

export async function xDriveFileExplorerRunQueuedOperation<TQueued>({
  plan,
  submit,
  onQueued,
  onFeedback,
  onComplete,
  onError,
}: {
  plan: XDriveFileExplorerQueuedOperationPlan
  submit: () => Promise<TQueued>
  onQueued: (queued: TQueued) => void
  onFeedback: (tone: 'good', message: string) => void
  onComplete: () => void
  onError: (error: unknown) => void
}) {
  try {
    if (plan.count > 0) {
      const queued = await submit()
      onQueued(queued)
      onFeedback('good', xDriveFileExplorerOperationQueuedMessage(plan.operation, plan.count))
    }
    onComplete()
    return true
  } catch (error) {
    onError(error)
    return false
  }
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

export type XDriveFileExplorerArchiveDownloadPlan<
  TNode extends XDriveFileExplorerDownloadNode,
> =
  | { kind: 'none' }
  | { kind: 'file'; file: TNode }
  | { kind: 'archive'; ids: number[]; filename: string; selectedCount: number }

export function xDriveFileExplorerArchiveDownloadPlan<
  TNode extends XDriveFileExplorerDownloadNode,
>(
  nodes: TNode[],
): XDriveFileExplorerArchiveDownloadPlan<TNode> {
  if (nodes.length === 0) return { kind: 'none' }
  if (nodes.length === 1 && nodes[0].type === 'file') {
    return { kind: 'file', file: nodes[0] }
  }
  return {
    kind: 'archive',
    ids: nodes.map((node) => node.id),
    filename: nodes.length === 1 && nodes[0].type === 'dir'
      ? `${nodes[0].name}.zip`
      : 'xDrive-download.zip',
    selectedCount: nodes.length,
  }
}

export type XDriveFileExplorerWebDownloadPlan<
  TNode extends XDriveFileExplorerDownloadNode,
> = XDriveFileExplorerArchiveDownloadPlan<TNode>

export function xDriveFileExplorerWebDownloadPlan<
  TNode extends XDriveFileExplorerDownloadNode,
>(
  nodes: TNode[],
): XDriveFileExplorerWebDownloadPlan<TNode> {
  return xDriveFileExplorerArchiveDownloadPlan(nodes)
}

export type XDriveFileExplorerFeedback = {
  tone: 'good' | 'warning'
  message: string
}

export function xDriveFileExplorerWebDownloadFeedback<
  TNode extends XDriveFileExplorerDownloadNode,
>(
  plan: XDriveFileExplorerWebDownloadPlan<TNode>,
): XDriveFileExplorerFeedback {
  switch (plan.kind) {
    case 'file':
      return { tone: 'good', message: `已下载 ${plan.file.name}。` }
    case 'archive':
      return { tone: 'good', message: `已下载 ${plan.filename}。` }
    default:
      return { tone: 'warning', message: '没有可下载的项目。' }
  }
}

export function xDriveFileExplorerDesktopArchiveDownloadFeedback(
  downloaded: number,
): XDriveFileExplorerFeedback {
  if (downloaded <= 0) {
    return { tone: 'warning', message: '没有下载任何项目。' }
  }
  return { tone: 'good', message: `已下载 ${downloaded} 个项目。` }
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

export async function xDriveFileExplorerDispatchOpenItem<
  TNode extends XDriveFileExplorerOpenItemNode,
>({
  item,
  nodeByID,
  currentCrumbs,
  searchCrumbsForNode,
  openFile,
  navigate,
}: {
  item: XDriveFileExplorerSelectionItem
  nodeByID: ReadonlyMap<number, TNode>
  currentCrumbs: readonly XDriveFileExplorerCrumb[]
  searchCrumbsForNode?: (node: TNode) => readonly XDriveFileExplorerCrumb[] | undefined
  openFile: (node: TNode) => void | Promise<void>
  navigate: (crumbs: XDriveFileExplorerCrumb[]) => void | Promise<void>
}): Promise<XDriveFileExplorerOpenItemPlan<TNode> | null> {
  const node = xDriveFileExplorerNodeForItem(item, nodeByID)
  if (!node) return null

  const plan = xDriveFileExplorerOpenItemPlan(
    node,
    currentCrumbs,
    searchCrumbsForNode?.(node),
  )
  if (plan.kind === 'file') {
    await openFile(plan.node)
  } else {
    await navigate(plan.crumbs)
  }
  return plan
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

export type XDriveFileExplorerKeyboardViewMode = 'details' | 'grid'

export type XDriveFileExplorerKeyboardNavigationKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'

export function xDriveFileExplorerKeyboardTargetIndex({
  key,
  currentIndex,
  itemCount,
  viewMode,
  gridColumns = 1,
  pageSize = 1,
}: {
  key: XDriveFileExplorerKeyboardNavigationKey
  currentIndex: number
  itemCount: number
  viewMode: XDriveFileExplorerKeyboardViewMode
  gridColumns?: number
  pageSize?: number
}) {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) return null
  const columns = Math.max(1, Math.trunc(gridColumns))
  const page = Math.max(1, Math.trunc(pageSize))

  let target = currentIndex
  switch (key) {
    case 'ArrowUp':
      if (viewMode === 'grid' && currentIndex < columns) return currentIndex
      target = currentIndex - (viewMode === 'grid' ? columns : 1)
      break
    case 'ArrowDown':
      if (viewMode === 'grid' && currentIndex + columns >= itemCount) return currentIndex
      target = currentIndex + (viewMode === 'grid' ? columns : 1)
      break
    case 'ArrowLeft':
      if (viewMode !== 'grid') return null
      target = currentIndex - 1
      break
    case 'ArrowRight':
      if (viewMode !== 'grid') return null
      target = currentIndex + 1
      break
    case 'Home':
      target = 0
      break
    case 'End':
      target = itemCount - 1
      break
    case 'PageUp':
      target = currentIndex - page
      break
    case 'PageDown':
      target = currentIndex + page
      break
    default:
      return null
  }

  return Math.max(0, Math.min(itemCount - 1, target))
}

export const XDRIVE_FILE_EXPLORER_TYPE_SELECT_TIMEOUT_MS = 900

export function xDriveFileExplorerTypeSelectTargetIndex({
  names,
  currentIndex,
  query,
  cycle = false,
}: {
  names: readonly string[]
  currentIndex: number
  query: string
  cycle?: boolean
}) {
  if (names.length === 0) return null
  const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase()
  if (!normalizedQuery) return null

  const hasCurrent = currentIndex >= 0 && currentIndex < names.length
  const start = hasCurrent
    ? cycle ? (currentIndex + 1) % names.length : currentIndex
    : 0

  for (let offset = 0; offset < names.length; offset += 1) {
    const index = (start + offset) % names.length
    const normalizedName = names[index].normalize('NFKC').toLocaleLowerCase()
    if (normalizedName.startsWith(normalizedQuery)) return index
  }
  return null
}

export function xDriveFileExplorerRenameSelectionEnd(
  name: string,
  kind: 'dir' | 'file',
) {
  if (kind === 'dir') return name.length
  const dot = name.lastIndexOf('.')
  return dot > 0 ? dot : name.length
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
  knownIDs?: Set<number>,
): TItem[] {
  if (knownIDs) {
    const pageIDs = new Set<number>()
    let hasDuplicate = false
    for (const item of pageItems) {
      if (knownIDs.has(item.id) || pageIDs.has(item.id)) {
        hasDuplicate = true
        break
      }
      pageIDs.add(item.id)
    }
    if (!hasDuplicate) {
      for (const id of pageIDs) knownIDs.add(id)
      return [...currentItems, ...pageItems]
    }
  }

  const merged = new Map(currentItems.map((item) => [item.id, item] as const))
  for (const item of pageItems) merged.set(item.id, item)
  if (knownIDs) {
    knownIDs.clear()
    for (const item of merged.values()) knownIDs.add(item.id)
  }
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
  knownIDs?: Set<number>,
) {
  return {
    pageState: xDriveFileExplorerPageStateFromResult(parentID, page, sort),
    applyItems: (currentItems: readonly TItem[]) => {
      if (append) return xDriveFileExplorerMergePageItems(currentItems, page.items, knownIDs)
      if (knownIDs) {
        knownIDs.clear()
        for (const item of page.items) knownIDs.add(item.id)
      }
      return [...page.items]
    },
  }
}

export const XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE = 200

export type XDriveFileExplorerTreePage<TItem> = {
  items: readonly TItem[]
  next_cursor?: string
  has_more: boolean
}

export type XDriveFileExplorerTreePageOptions = {
  limit: number
  cursor?: string
  sort: 'name'
  order: 'asc'
}

export type XDriveFileExplorerTreeDirectoryPage<TItem> = {
  items: TItem[]
  nextCursor: string
  hasMore: boolean
}

export async function xDriveFileExplorerLoadChildDirectoryPage<
  TItem extends { id: number; name: string; type: string },
>({
  parentID,
  cursor = '',
  loadPage,
}: {
  parentID: number
  cursor?: string
  loadPage: (
    parentID: number,
    options: XDriveFileExplorerTreePageOptions,
  ) => Promise<XDriveFileExplorerTreePage<TItem>>
}): Promise<XDriveFileExplorerTreeDirectoryPage<TItem>> {
  const page = await loadPage(parentID, {
    limit: XDRIVE_FILE_EXPLORER_TREE_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
    sort: 'name',
    order: 'asc',
  })

  const directories: TItem[] = []
  let reachedFile = false
  for (const item of page.items) {
    if (item.type !== 'dir') {
      reachedFile = true
      break
    }
    directories.push(item)
  }

  const nextCursor = page.next_cursor?.trim() ?? ''
  if (!reachedFile && page.has_more && !nextCursor) {
    throw new Error('文件夹树分页缺少下一页游标。')
  }
  if (!reachedFile && page.has_more && cursor && nextCursor === cursor) {
    throw new Error('文件夹树分页游标重复。')
  }
  const hasMore = !reachedFile && page.has_more && Boolean(nextCursor)
  return {
    items: directories,
    nextCursor: hasMore ? nextCursor : '',
    hasMore,
  }
}

export type XDriveFileExplorerFolderUploadEntry<TFile> = {
  file: TFile
  relativePath: string
}

export type XDriveFileExplorerFolderUploadDirectory = {
  path: string
  parentPath: string
  name: string
}

export type XDriveFileExplorerFolderUploadFile<TFile> = {
  file: TFile
  relativePath: string
  directoryPath: string
  name: string
}

export type XDriveFileExplorerResolvedFolderUploadFile<TFile> =
  XDriveFileExplorerFolderUploadFile<TFile> & {
    parentID: number
  }

function xDriveFileExplorerFolderUploadPathParts(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/')) {
    throw new Error('文件夹上传路径无效。')
  }
  const parts = normalized.split('/').filter(Boolean)
  if (
    parts.length === 0 ||
    parts.some((part) => part === '.' || part === '..' || part.includes('\0'))
  ) {
    throw new Error('文件夹上传路径无效。')
  }
  return parts
}

export function xDriveFileExplorerFolderUploadPlan<TFile>(
  entries: readonly XDriveFileExplorerFolderUploadEntry<TFile>[],
  explicitDirectoryPaths: readonly string[] = [],
) {
  const directories = new Map<string, XDriveFileExplorerFolderUploadDirectory>()
  const files: XDriveFileExplorerFolderUploadFile<TFile>[] = []

  const registerDirectoryPath = (relativePath: string) => {
    const parts = xDriveFileExplorerFolderUploadPathParts(relativePath)
    let parentPath = ''
    for (const part of parts) {
      const path = parentPath ? `${parentPath}/${part}` : part
      if (!directories.has(path)) directories.set(path, { path, parentPath, name: part })
      parentPath = path
    }
  }

  for (const path of explicitDirectoryPaths) registerDirectoryPath(path)

  for (const entry of entries) {
    const parts = xDriveFileExplorerFolderUploadPathParts(entry.relativePath)
    const name = parts.at(-1)!
    const directoryParts = parts.slice(0, -1)
    if (directoryParts.length > 0) registerDirectoryPath(directoryParts.join('/'))
    const directoryPath = directoryParts.join('/')
    files.push({
      file: entry.file,
      relativePath: parts.join('/'),
      directoryPath,
      name,
    })
  }

  return {
    directories: [...directories.values()].sort((left, right) => {
      const depth = left.path.split('/').length - right.path.split('/').length
      return depth || left.path.localeCompare(right.path, undefined, { numeric: true })
    }),
    files,
  }
}

export async function xDriveFileExplorerEnsureUploadDirectory<
  TNode extends { id: number; name: string; type: string },
>({
  parentID,
  name,
  createDirectory,
  findExistingDirectory,
}: {
  parentID: number
  name: string
  createDirectory: (parentID: number, name: string) => Promise<TNode>
  findExistingDirectory: (parentID: number, name: string) => Promise<TNode | null | undefined>
}) {
  try {
    return (await createDirectory(parentID, name)).id
  } catch (createError) {
    try {
      const existing = await findExistingDirectory(parentID, name)
      if (existing?.type === 'dir') return existing.id
    } catch {
      // Preserve the original create error when fallback lookup also fails.
    }
    throw createError
  }
}

export async function xDriveFileExplorerResolveFolderUploadTargets<TFile>({
  rootParentID,
  entries,
  directoryPaths = [],
  ensureDirectory,
}: {
  rootParentID: number
  entries: readonly XDriveFileExplorerFolderUploadEntry<TFile>[]
  directoryPaths?: readonly string[]
  ensureDirectory: (parentID: number, name: string) => Promise<number>
}): Promise<XDriveFileExplorerResolvedFolderUploadFile<TFile>[]> {
  const plan = xDriveFileExplorerFolderUploadPlan(entries, directoryPaths)
  const directoryIDs = new Map<string, number>([['', rootParentID]])

  for (const directory of plan.directories) {
    const parentID = directoryIDs.get(directory.parentPath)
    if (parentID === undefined) throw new Error(`文件夹上传路径无法解析：${directory.path}`)
    const id = await ensureDirectory(parentID, directory.name)
    directoryIDs.set(directory.path, id)
  }

  return plan.files.map((file) => {
    const parentID = directoryIDs.get(file.directoryPath)
    if (parentID === undefined) throw new Error(`文件夹上传路径无法解析：${file.relativePath}`)
    return { ...file, parentID }
  })
}
