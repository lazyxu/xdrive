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
  const crumbProjection = useMemo(() => {
    const explorerCrumbs = new Array<XDriveFileExplorerCrumb>(crumbs.length)
    const names = new Array<string>(crumbs.length)
    for (let index = 0; index < crumbs.length; index += 1) {
      const crumb = crumbs[index]
      explorerCrumbs[index] = { id: crumb.id, name: crumb.name }
      names[index] = crumb.name
    }
    return {
      explorerCrumbs,
      pathPrefix: crumbs.length > 0 ? `${names.join('/')}/` : '',
    }
  }, [crumbs])

  const projection = useMemo(() => {
    const results = searchResults ?? undefined
    const sourceLength = results ? results.length : items.length
    const activeNodes = results ? new Array<TNode>(sourceLength) : items
    const nodeByID = new Map<number, TNode>()
    const searchByID = new Map<number, TSearch>()
    const explorerItems = new Array<XDriveFileExplorerItem>(sourceLength)

    for (let index = 0; index < sourceLength; index += 1) {
      const result = results?.[index]
      const node = result ? result.node : items[index]
      if (results) activeNodes[index] = node
      nodeByID.set(node.id, node)
      if (result) searchByID.set(node.id, result)
      const resultPath = result?.path || undefined
      explorerItems[index] = {
        id: node.id,
        name: node.name,
        kind: node.type,
        size: node.size,
        updatedAt: node.updated_at,
        secondaryLabel: resultPath,
        path: resultPath || `${crumbProjection.pathPrefix}${node.name}`,
        revision: node.revision,
      }
    }

    return {
      activeNodes,
      nodeByID,
      searchByID,
      explorerItems,
    }
  }, [crumbProjection.pathPrefix, items, searchResults])

  return {
    ...projection,
    explorerCrumbs: crumbProjection.explorerCrumbs,
  }
}
