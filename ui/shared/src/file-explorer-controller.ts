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


export type XDriveFileExplorerClipboardMode = 'copy' | 'cut'
export type XDriveFileExplorerMutationOperation = 'copy' | 'move'
export type XDriveFileExplorerMutationNode = Pick<Node, 'id' | 'revision' | 'parent_id'>
export type XDriveFileExplorerMutationRef = Pick<Node, 'id' | 'revision'>

export type XDriveFileExplorerClipboard<TNode extends XDriveFileExplorerMutationNode> = {
  mode: XDriveFileExplorerClipboardMode
  nodes: TNode[]
}

export type XDriveFileExplorerMutationPlan<TNode extends XDriveFileExplorerMutationNode> = {
  operation: XDriveFileExplorerMutationOperation
  nodes: TNode[]
  refs: XDriveFileExplorerMutationRef[]
}

export function xDriveFileExplorerNodesForItems<TNode extends Pick<Node, 'id'>>(
  selected: readonly { id: string | number }[],
  nodeByID: ReadonlyMap<number, TNode>,
): TNode[] {
  return selected
    .map((item) => nodeByID.get(Number(item.id)))
    .filter((node): node is TNode => Boolean(node))
}

export function xDriveFileExplorerMutationRefs(
  nodes: readonly XDriveFileExplorerMutationNode[],
): XDriveFileExplorerMutationRef[] {
  return nodes.map((node) => ({ id: node.id, revision: node.revision }))
}

export function xDriveFileExplorerClipboardPlan<
  TNode extends XDriveFileExplorerMutationNode,
>(
  clipboard: XDriveFileExplorerClipboard<TNode>,
  targetParentID: number,
): XDriveFileExplorerMutationPlan<TNode> {
  const nodes = clipboard.mode === 'cut'
    ? clipboard.nodes.filter((node) => node.parent_id !== targetParentID)
    : [...clipboard.nodes]

  return {
    operation: clipboard.mode === 'cut' ? 'move' : 'copy',
    nodes,
    refs: xDriveFileExplorerMutationRefs(nodes),
  }
}

export function xDriveFileExplorerDropPlan<
  TNode extends XDriveFileExplorerMutationNode,
>(
  nodes: readonly TNode[],
  targetNodeID: number,
  operation: XDriveFileExplorerMutationOperation,
): XDriveFileExplorerMutationPlan<TNode> {
  const eligible = nodes.filter((node) => node.id !== targetNodeID)
  return {
    operation,
    nodes: eligible,
    refs: xDriveFileExplorerMutationRefs(eligible),
  }
}
