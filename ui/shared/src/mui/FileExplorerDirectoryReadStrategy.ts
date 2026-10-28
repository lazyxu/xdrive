import type { XDriveCloudFilesRange } from '../cloud-files'
import type { XDriveFileExplorerGrouping } from '../file-explorer-grouping'

/**
 * One typed read boundary for the shared Files workspace. Hosts expose only
 * operations they can really perform; no synthetic random seeking, hidden
 * privilege upgrade, source-token exchange or mutation is provided here.
 */
export type XDriveFileExplorerDirectoryReadSort = { key: string; direction: string }

export type XDriveFileExplorerCursorReadPort<
  TNode extends { id: number }, TSort extends XDriveFileExplorerDirectoryReadSort,
> = {
  mode: 'cursor'
  readPage: (
    parentID: number, limit: number, sort: TSort, cursor: string, signal: AbortSignal,
  ) => Promise<{ items: TNode[]; has_more: boolean; next_cursor?: string }>
}

export type XDriveFileExplorerRangeReadPort<
  TNode extends { id: number }, TSort extends XDriveFileExplorerDirectoryReadSort,
> = {
  mode: 'range'
  readRange: (
    parentID: number, offset: number, limit: number, sort: TSort,
    includeCount: boolean, grouping: XDriveFileExplorerGrouping, signal: AbortSignal,
  ) => Promise<XDriveCloudFilesRange<TNode>>
}

export type XDriveFileExplorerDirectoryReadPort<
  TNode extends { id: number }, TSort extends XDriveFileExplorerDirectoryReadSort,
> = XDriveFileExplorerCursorReadPort<TNode, TSort> |
  XDriveFileExplorerRangeReadPort<TNode, TSort>

export type XDriveFileExplorerDirectoryReadRequest<
  TSort extends XDriveFileExplorerDirectoryReadSort,
> = {
  mode: 'cursor'
  parentID: number
  limit: number
  sort: TSort
  cursor: string
  signal: AbortSignal
} | {
  mode: 'range'
  parentID: number
  offset: number
  limit: number
  sort: TSort
  includeCount: boolean
  grouping: XDriveFileExplorerGrouping
  signal: AbortSignal
}

export type XDriveFileExplorerDirectoryReadResult<TNode extends { id: number }> = {
  mode: 'cursor'
  page: { items: TNode[]; has_more: boolean; next_cursor?: string }
} | {
  mode: 'range'
  page: XDriveCloudFilesRange<TNode>
}

/**
 * Preserve the actual Host response and AbortSignal. Range results are counted
 * for sparse 100k virtual loading; cursor results retain an opaque next_cursor,
 * never a fictitious total or positional offset. A mismatched mode is rejected
 * *before* invoking either authenticated Host read endpoint.
 *
 * Owner ACL and cursor validation remain in the respective Server/Host port.
 */
export async function xDriveFileExplorerReadDirectoryPage<
  TNode extends { id: number },
  TSort extends XDriveFileExplorerDirectoryReadSort,
>(
  port: XDriveFileExplorerDirectoryReadPort<TNode, TSort>,
  request: XDriveFileExplorerDirectoryReadRequest<TSort>,
): Promise<XDriveFileExplorerDirectoryReadResult<TNode>> {
  if (port.mode !== request.mode) {
    throw new Error('Files read strategy does not match this Host capability')
  }
  if (port.mode === 'cursor' && request.mode === 'cursor') {
    const page = await port.readPage(
      request.parentID, request.limit, request.sort, request.cursor, request.signal,
    )
    return { mode: 'cursor', page }
  }
  if (port.mode === 'range' && request.mode === 'range') {
    const page = await port.readRange(
      request.parentID, request.offset, request.limit, request.sort,
      request.includeCount, request.grouping, request.signal,
    )
    return { mode: 'range', page }
  }
  throw new Error('Unsupported Files read strategy')
}
