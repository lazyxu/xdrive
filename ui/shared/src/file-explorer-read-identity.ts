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

/**
 * One current read request for the same FileExplorer thumbnails in Web/PWA
 * and Desktop. Revision may be absent for legacy/cover projections: omit it
 * so the real Server can revalidate ETag, but never send NaN or an unsafe
 * revision into native IPC, cache identity or optional poster backfill.
 * The Host still owns the current Owner, cancellation and authorization.
 */
export function xDriveFileExplorerThumbnailRequest(
  item: XDriveFileExplorerReadonlyItem & Readonly<{ revision?: string | number }>,
  allowed = true,
): Readonly<{ nodeID: number; revision?: number }> | null {
  const nodeID = xDriveFileExplorerReadNodeID(item, allowed)
  if (nodeID === null) return null
  const revision = Number(item.revision)
  return Number.isSafeInteger(revision) && revision > 0
    ? { nodeID, revision }
    : { nodeID }
}
