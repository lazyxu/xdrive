import type { XDriveCloudFilesPosition } from '../cloud-files'
import { xDriveCloudFilesPositionMatchesRequest } from '../cloud-files'
import type { XDriveFileExplorerGrouping } from '../file-explorer-grouping'
import type { XDriveFileExplorerItem, XDriveFileExplorerSort } from './FileExplorer'

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
  if (!rows || rows.length !== 1 || Number(rows[0].id) !== nodeID ||
    Number(rows[0].revision) !== position.revision) return null
  return { index: position.index, item: rows[0] }
}
