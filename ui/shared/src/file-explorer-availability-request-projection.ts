import type { XDriveFileExplorerHostAvailabilityRequest } from './file-explorer-host-availability'

/**
 * One bounded view of path-bearing *read evidence* from the current Files
 * workspace. It does not resolve permission, perform Agent IPC or read from
 * the device. The Host must still prove its current Owner before querying.
 *
 * Later, explicitly verified navigation/column rows override an older path
 * for the same node. This is the Desktop FileExplorer's existing precedence.
 */
export type XDriveFileExplorerAvailabilityPathItem = Readonly<{
  id: string | number
  path?: string
}>

export function xDriveFileExplorerAvailabilityRequests({
  nodes,
  searchByID,
  crumbs,
  quickAccess,
  favorites,
  recent,
  navigation,
  columns,
}: {
  nodes: Iterable<Readonly<{ id: number; name: string }>>
  searchByID: ReadonlyMap<number, Readonly<{ path?: string }>>
  crumbs: readonly Readonly<{ name: string }>[]
  quickAccess: readonly XDriveFileExplorerAvailabilityPathItem[]
  favorites: readonly XDriveFileExplorerAvailabilityPathItem[]
  recent: readonly XDriveFileExplorerAvailabilityPathItem[]
  navigation: readonly XDriveFileExplorerAvailabilityPathItem[]
  columns: readonly XDriveFileExplorerAvailabilityPathItem[]
}): XDriveFileExplorerHostAvailabilityRequest[] {
  const byID = new Map<number, string>()
  const add = (id: string | number, path: string | undefined) => {
    // UI projection IDs can be numeric strings, but must never be coerced
    // from booleans, empty strings, fractional or unsafe numbers.
    if (typeof id !== 'number' && (typeof id !== 'string' || !/^[1-9]\d*$/.test(id))) return
    const numericID = typeof id === 'number' ? id : Number(id)
    if (!Number.isSafeInteger(numericID) || numericID <= 0 ||
        typeof path !== 'string' || path.length === 0) return
    byID.set(numericID, path)
  }
  const parent = crumbs.slice(1).map(crumb => crumb.name)
  for (const node of nodes) {
    const path = searchByID.get(node.id)?.path ||
      [...parent, node.name].join('/')
    add(node.id, path)
  }
  // Preserve the source order of the existing Desktop read aggregation.
  for (const item of quickAccess) add(item.id, item.path)
  for (const item of favorites) add(item.id, item.path)
  for (const item of recent) add(item.id, item.path)
  for (const item of navigation) add(item.id, item.path)
  for (const item of columns) add(item.id, item.path)
  return [...byID].map(([nodeID, path]) => ({ nodeID, path }))
}
