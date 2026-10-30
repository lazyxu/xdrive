import type { XDriveCloudFilesPosition } from '../cloud-files'
import { xDriveCloudFilesPositionMatchesRequest } from '../cloud-files'
import type { XDriveFileExplorerGrouping } from '../file-explorer-grouping'
import type { XDriveFileExplorerItem, XDriveFileExplorerSort } from './FileExplorer'

/**
 * An authenticated 1-row Range must match the exact current Node/revision.
 * FileExplorer's legacy projections permit number or decimal-string IDs,
 * but Number(...) alone would also admit empty, whitespace, hex, exponent
 * and other ambiguous identities. Never coerce those into a verified reveal.
 */
function xDriveCanonicalPositiveReadIdentity(value: number | string | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value !== 'string' || !/^[1-9]\\d*$/.test(value)) return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

function xDriveVerifiedReanchorRow(
  rows: readonly XDriveFileExplorerItem[] | null,
  nodeID: number,
  revision: number,
): XDriveFileExplorerItem | null {
  if (!rows || rows.length !== 1) return null
  const row = rows[0]
  return xDriveCanonicalPositiveReadIdentity(row?.id) === nodeID &&
    xDriveCanonicalPositiveReadIdentity(row?.revision) === revision
      ? row : null
}

// The Server owns logical position, and only an exact bounded new Range can
// authorize restoring the old Node identity under the newly committed order.
export async function xDriveFileExplorerVerifiedChildReanchor({
  parentID, nodeID, revision, itemCount, sort, grouping,
  signal, locate, collectRange,
}: {
  parentID: number
  nodeID: number
  revision: number
  itemCount: number
  sort: XDriveFileExplorerSort
  grouping: XDriveFileExplorerGrouping
  signal: AbortSignal
  locate: (
    parentID: number, nodeID: number,
    sort: XDriveFileExplorerSort, grouping: XDriveFileExplorerGrouping,
    signal: AbortSignal,
  ) => Promise<XDriveCloudFilesPosition>
  collectRange: (
    startIndex: number, endIndex: number, signal?: AbortSignal,
  ) => Promise<readonly XDriveFileExplorerItem[] | null>
}): Promise<{ index: number; item: XDriveFileExplorerItem } | null> {
  signal.throwIfAborted()
  if (![parentID, nodeID, revision, itemCount].every(Number.isSafeInteger) ||
    parentID <= 0 || nodeID <= 0 || revision <= 0 || itemCount <= 0) return null
  const position = await locate(parentID, nodeID, sort, grouping, signal)
  signal.throwIfAborted()
  if (!xDriveCloudFilesPositionMatchesRequest(position, {
    nodeID, sort: sort.key, order: sort.direction, grouping,
  }) || position.revision !== revision || position.index >= itemCount) return null
  const rows = await collectRange(position.index, position.index, signal)
  signal.throwIfAborted()
  const verifiedItem = xDriveVerifiedReanchorRow(rows, nodeID, position.revision)
  return verifiedItem ? { index: position.index, item: verifiedItem } : null
}


/** Reveal an exact child in a sparse directory, without materializing its
 * siblings or trusting a Search ordinal. The authenticated position is only
 * usable after a matching one-item Range proves the same Node + revision.
 */
export async function xDriveFileExplorerVerifiedChildReveal({
  parentID, nodeID, itemCount, sort, grouping, signal, locate, collectRange,
}: {
  parentID: number
  nodeID: number
  itemCount: number
  sort: XDriveFileExplorerSort
  grouping: XDriveFileExplorerGrouping
  signal: AbortSignal
  locate: (
    parentID: number, nodeID: number,
    sort: XDriveFileExplorerSort, grouping: XDriveFileExplorerGrouping,
    signal: AbortSignal,
  ) => Promise<XDriveCloudFilesPosition>
  collectRange: (
    startIndex: number, endIndex: number, signal?: AbortSignal,
  ) => Promise<readonly XDriveFileExplorerItem[] | null>
}): Promise<{ index: number; item: XDriveFileExplorerItem } | null> {
  signal.throwIfAborted()
  if (![parentID, nodeID, itemCount].every(Number.isSafeInteger) ||
    parentID <= 0 || nodeID <= 0 || itemCount <= 0) return null
  const position = await locate(parentID, nodeID, sort, grouping, signal)
  signal.throwIfAborted()
  if (!xDriveCloudFilesPositionMatchesRequest(position, {
    nodeID, sort: sort.key, order: sort.direction, grouping,
  }) || position.index >= itemCount) return null
  const rows = await collectRange(position.index, position.index, signal)
  signal.throwIfAborted()
  const verifiedItem = xDriveVerifiedReanchorRow(rows, nodeID, position.revision)
  return verifiedItem ? { index: position.index, item: verifiedItem } : null
}
