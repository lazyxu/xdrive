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
 * Cursor pages have no random-access count. Fail closed on malformed or
 * non-advancing responses BEFORE a shared Files controller publishes rows.
 * Transport, Owner ACL and token redaction are still the Host's responsibility.
 * Keep the authentic returned object unchanged (no invented range/count).
 */
function verifyCursorPage<TNode extends { id: number }>(
  page: { items: TNode[]; has_more: boolean; next_cursor?: string },
  requestedLimit: number,
  requestedCursor: string,
): void {
  if (!page || !Array.isArray(page.items) || typeof page.has_more !== 'boolean' ||
      page.items.length > requestedLimit) {
    throw new Error('Invalid Files Host cursor page')
  }
  const seen = new Set<number>()
  for (const item of page.items) {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || seen.has(item.id)) {
      throw new Error('Invalid or duplicate Files Host cursor node')
    }
    seen.add(item.id)
  }
  const cursor = page.next_cursor
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 1024 ||
      /[\\x00-\\x1f\\x7f]/.test(cursor))) {
    throw new Error('Invalid Files Host cursor token')
  }
  if (page.has_more && (!cursor || cursor === requestedCursor)) {
    throw new Error('Non-advancing Files Host cursor page')
  }
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
    // Reject invalid paging input before invoking an authenticated Host port.
    // A cursor is an opaque token, never an offset or a client-side guess.
    if (!Number.isSafeInteger(request.parentID) || request.parentID <= 0 ||
        !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000 ||
        typeof request.cursor !== 'string' || request.cursor.length > 1024 ||
        /[\\x00-\\x1f\\x7f]/.test(request.cursor)) {
      throw new Error('Invalid Files Host cursor request')
    }
    const page = await port.readPage(
      request.parentID, request.limit, request.sort, request.cursor, request.signal,
    )
    verifyCursorPage(page, request.limit, request.cursor)
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
