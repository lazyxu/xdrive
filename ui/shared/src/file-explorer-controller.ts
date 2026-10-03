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

export type XDriveFileExplorerSelectionItem = { id: string | number }
export type XDriveFileExplorerOperationNode = Pick<Node, 'id' | 'revision' | 'parent_id'>
export type XDriveFileExplorerOperationRef = { id: number; revision: number }
export type XDriveFileExplorerClipboardMode = 'copy' | 'cut'
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
