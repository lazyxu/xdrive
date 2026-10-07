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

export function xDriveProjectFileExplorerNode<TNode extends Node>(
  node: TNode,
  pathPrefix: string,
  resultPath?: string,
): XDriveFileExplorerItem {
  return {
    id: node.id,
    name: node.name,
    kind: node.type,
    size: node.size,
    updatedAt: node.updated_at,
    secondaryLabel: resultPath,
    path: resultPath || `${pathPrefix}${node.name}`,
    revision: node.revision,
  }
}

export function useXDriveFileExplorerProjection<
  TNode extends Node,
  TSearch extends XDriveFileExplorerSearchProjection<TNode>,
  TCrumb extends XDriveFileExplorerCrumb,
>({
  items,
  crumbs,
  searchResults,
  virtualItems,
  virtualSearchItems,
}: {
  items: TNode[]
  crumbs: TCrumb[]
  searchResults?: TSearch[] | null
  virtualItems?: ReadonlyMap<number, TNode>
  virtualSearchItems?: ReadonlyMap<number, TSearch>
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
    const virtualSearchActive = searchResults != null && virtualSearchItems !== undefined
    const results = virtualSearchActive ? undefined : searchResults ?? undefined
    const sourceLength = virtualSearchActive
      ? 0
      : results
        ? results.length
        : items.length
    const activeNodes = virtualSearchActive
      ? []
      : results
        ? new Array<TNode>(sourceLength)
        : items
    const nodeByID = new Map<number, TNode>()
    const searchByID = new Map<number, TSearch>()
    const explorerItems = new Array<XDriveFileExplorerItem>(sourceLength)
    const virtualExplorerItems = (
      (virtualSearchActive ? virtualSearchItems : undefined) ||
      (!results && virtualItems)
    )
      ? new Map<number, XDriveFileExplorerItem>()
      : undefined

    for (let index = 0; index < sourceLength; index += 1) {
      const result = results?.[index]
      const node = result ? result.node : items[index]
      if (results) activeNodes[index] = node
      nodeByID.set(node.id, node)
      if (result) searchByID.set(node.id, result)
      const resultPath = result?.path || undefined
      const explorerItem = xDriveProjectFileExplorerNode(
        node,
        crumbProjection.pathPrefix,
        resultPath,
      )
      explorerItems[index] = explorerItem
      virtualExplorerItems?.set(index, explorerItem)
    }

    if (virtualExplorerItems && virtualSearchActive && virtualSearchItems) {
      for (const [index, result] of virtualSearchItems) {
        const node = result.node
        nodeByID.set(node.id, node)
        searchByID.set(node.id, result)
        virtualExplorerItems.set(
          index,
          xDriveProjectFileExplorerNode(
            node,
            crumbProjection.pathPrefix,
            result.path || undefined,
          ),
        )
      }
    } else if (virtualExplorerItems && virtualItems) {
      for (const [index, node] of virtualItems) {
        nodeByID.set(node.id, node)
        const explorerItem = xDriveProjectFileExplorerNode(
          node,
          crumbProjection.pathPrefix,
        )
        virtualExplorerItems.set(index, explorerItem)
        if (index < explorerItems.length) explorerItems[index] = explorerItem
      }
    }

    return {
      activeNodes,
      nodeByID,
      searchByID,
      explorerItems,
      virtualExplorerItems,
    }
  }, [
    crumbProjection.pathPrefix,
    items,
    searchResults,
    virtualItems,
    virtualSearchItems,
  ])

  return {
    ...projection,
    explorerCrumbs: crumbProjection.explorerCrumbs,
  }
}
