export const XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE = 200
export const XDRIVE_VIRTUAL_COLLECTION_DEFAULT_OVERSCAN_PAGES = 1

export type XDriveVirtualCollectionRange = {
  offset: number
  limit: number
}

export type XDriveVirtualCollectionPage<TItem> = {
  items: readonly TItem[]
  offset: number
  limit: number
  totalCount: number
}

export type XDriveVirtualCollectionSnapshot<TItem> = {
  generation: number
  queryKey: string
  totalCount: number | null
  items: ReadonlyMap<number, TItem>
}

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function positiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : fallback
}

export function xDriveVirtualCollectionRangeKey(range: XDriveVirtualCollectionRange) {
  return `${range.offset}:${range.limit}`
}

export function xDriveVirtualCollectionRangesForViewport({
  startIndex,
  endIndex,
  totalCount = null,
  pageSize = XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE,
  overscanPages = XDRIVE_VIRTUAL_COLLECTION_DEFAULT_OVERSCAN_PAGES,
}: {
  startIndex: number
  endIndex: number
  totalCount?: number | null
  pageSize?: number
  overscanPages?: number
}): XDriveVirtualCollectionRange[] {
  const normalizedPageSize = positiveInteger(
    pageSize,
    XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE,
  )
  const normalizedOverscan = nonNegativeInteger(overscanPages)
  const normalizedTotal = totalCount === null
    ? null
    : nonNegativeInteger(totalCount)
  if (normalizedTotal === 0) return []

  const start = nonNegativeInteger(startIndex)
  let end = nonNegativeInteger(endIndex)
  if (end < start) return []
  if (normalizedTotal !== null) {
    if (start >= normalizedTotal) return []
    end = Math.min(end, normalizedTotal - 1)
  }

  const firstVisiblePage = Math.floor(start / normalizedPageSize)
  const lastVisiblePage = Math.floor(end / normalizedPageSize)
  const firstPage = Math.max(0, firstVisiblePage - normalizedOverscan)
  const lastPage = lastVisiblePage + normalizedOverscan
  const ranges: XDriveVirtualCollectionRange[] = []

  for (let page = firstPage; page <= lastPage; page += 1) {
    const offset = page * normalizedPageSize
    if (normalizedTotal !== null && offset >= normalizedTotal) break
    ranges.push({ offset, limit: normalizedPageSize })
  }
  return ranges
}

export function xDriveCreateVirtualCollectionSnapshot<TItem>(
  queryKey: string,
  generation = 1,
): XDriveVirtualCollectionSnapshot<TItem> {
  return {
    generation: Math.max(1, Math.trunc(generation) || 1),
    queryKey,
    totalCount: null,
    items: new Map<number, TItem>(),
  }
}

export function xDriveVirtualCollectionNextGeneration<TItem>(
  current: XDriveVirtualCollectionSnapshot<TItem>,
  queryKey: string,
) {
  return xDriveCreateVirtualCollectionSnapshot<TItem>(
    queryKey,
    current.generation + 1,
  )
}

export function xDriveVirtualCollectionApplyPage<TItem>(
  current: XDriveVirtualCollectionSnapshot<TItem>,
  generation: number,
  page: XDriveVirtualCollectionPage<TItem>,
): XDriveVirtualCollectionSnapshot<TItem> {
  if (generation !== current.generation) return current

  const totalCount = nonNegativeInteger(page.totalCount)
  const offset = nonNegativeInteger(page.offset)
  const limit = positiveInteger(page.limit, page.items.length || 1)
  const items = new Map(current.items)

  const clearEnd = Math.min(totalCount, offset + limit)
  for (let index = offset; index < clearEnd; index += 1) items.delete(index)
  for (const index of [...items.keys()]) {
    if (index >= totalCount) items.delete(index)
  }

  const accepted = Math.min(
    page.items.length,
    Math.max(0, totalCount - offset),
    limit,
  )
  for (let index = 0; index < accepted; index += 1) {
    items.set(offset + index, page.items[index])
  }

  return {
    ...current,
    totalCount,
    items,
  }
}

export function xDriveVirtualCollectionLoadedCount<TItem>(
  snapshot: XDriveVirtualCollectionSnapshot<TItem>,
) {
  return snapshot.items.size
}
