/**
 * A host-neutral, read-only FileExplorer item admission projection.
 * It MUST NOT confer Owner, Root, native mount or media permissions:
 * Browser/DSM/Electron still authorize each actual network/native request.
 *
 * Preserve the canonical FileExplorer's string/number row-ID vocabulary,
 * but never send a missing, non-finite, fractional, zero or unsafe ID to a
 * Host read. An invalid virtual/placeholder/directory row is not a file.
 */
export type XDriveFileExplorerReadonlyItem = Readonly<{
  id: string | number
  kind: 'dir' | 'file'
}>

export function xDriveFileExplorerReadNodeID(
  item: XDriveFileExplorerReadonlyItem,
  allowed = true,
): number | null {
  if (!allowed || item.kind !== 'file') return null
  const nodeID = Number(item.id)
  return Number.isSafeInteger(nodeID) && nodeID > 0 ? nodeID : null
}
