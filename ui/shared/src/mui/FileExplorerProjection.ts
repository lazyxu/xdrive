import { useMemo } from 'react'
import type { Node } from '../models'
import type {
  XDriveFileExplorerCrumb,
  XDriveFileExplorerItem,
} from './FileExplorer'

export type XDriveFileExplorerSearchProjection<TNode extends Node = Node> = {
  node: TNode
  path: string
}

export function useXDriveFileExplorerProjection<
  TNode extends Node,
  TSearch extends XDriveFileExplorerSearchProjection<TNode>,
  TCrumb extends XDriveFileExplorerCrumb,
>({
  items,
  crumbs,
  searchResults,
}: {
  items: TNode[]
  crumbs: TCrumb[]
  searchResults?: TSearch[] | null
}) {
  const activeNodes = useMemo(
    () => (searchResults ? searchResults.map((result) => result.node) : items),
    [items, searchResults],
  )
  const nodeByID = useMemo(
    () => new Map(activeNodes.map((node) => [node.id, node] as const)),
    [activeNodes],
  )
  const searchByID = useMemo(
    () => new Map((searchResults ?? []).map((result) => [result.node.id, result] as const)),
    [searchResults],
  )
  const explorerItems = useMemo<XDriveFileExplorerItem[]>(
    () => activeNodes.map((node) => {
      const result = searchByID.get(node.id)
      return {
        id: node.id,
        name: node.name,
        kind: node.type,
        size: node.size,
        updatedAt: node.updated_at,
        secondaryLabel: result?.path || undefined,
        path: result?.path || [...crumbs.map((crumb) => crumb.name), node.name].join('/'),
        revision: node.revision,
      }
    }),
    [activeNodes, crumbs, searchByID],
  )
  const explorerCrumbs = useMemo<XDriveFileExplorerCrumb[]>(
    () => crumbs.map((crumb) => ({ id: crumb.id, name: crumb.name })),
    [crumbs],
  )

  return {
    activeNodes,
    nodeByID,
    searchByID,
    explorerItems,
    explorerCrumbs,
  }
}
