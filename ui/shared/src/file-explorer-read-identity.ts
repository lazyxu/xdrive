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

/**
 * A read-only current Node/revision must be an exact positive safe integer,
 * or its canonical base-10 string representation. JavaScript Number(...)
 * also accepts whitespace, signs, hex, exponent and empty strings; those
 * ambiguous aliases are not safe current Owner/Node identity evidence.
 *
 * This is shape validation, not a grant to read another Owner's file.
 */
export function xDriveFileExplorerCanonicalReadNodeID(
  value: number | string | undefined,
): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function xDriveFileExplorerReadNodeID(
  item: XDriveFileExplorerReadonlyItem,
  allowed = true,
): number | null {
  return allowed && item?.kind === 'file'
    ? xDriveFileExplorerCanonicalReadNodeID(item.id)
    : null
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
  const revision = xDriveFileExplorerCanonicalReadNodeID(item.revision)
  return revision !== null ? { nodeID, revision } : { nodeID }
}
