export type XDriveFileExplorerVirtualWindow = {
  start: number
  end: number
  before: number
  after: number
}

export type XDriveFileExplorerGridVirtualWindow = {
  start: number
  end: number
  startRow: number
  totalRows: number
  totalHeight: number
}

export type XDriveFileExplorerVirtualSlot<TItem> = {
  index: number
  item: TItem | undefined
}

function nonNegativeInteger(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function positiveInteger(value: number, fallback: number) {
  const normalized = Math.trunc(value)
  return Number.isFinite(value) && normalized > 0 ? normalized : fallback
}

export function xDriveFileExplorerDetailsVirtualWindow({
  itemCount,
  scrollTop,
  viewportHeight,
  rowHeight,
  headerHeight,
  overscan,
  minViewportHeight,
}: {
  itemCount: number
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  headerHeight: number
  overscan: number
  /** Keep desktop's default eight-row admission; Mobile may request a 300px floor. */
  minViewportHeight?: number
}): XDriveFileExplorerVirtualWindow {
  const count = nonNegativeInteger(itemCount)
  const row = positiveInteger(rowHeight, 1)
  const header = nonNegativeInteger(headerHeight)
  const extra = nonNegativeInteger(overscan)
  if (count === 0) return { start: 0, end: 0, before: 0, after: 0 }

  const effectiveHeight = Math.max(
    nonNegativeInteger(viewportHeight),
    minViewportHeight === undefined ? row * 8 : nonNegativeInteger(minViewportHeight),
  )
  const rawFirstVisible = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop - header) / row),
  )
  const firstVisible = Math.min(count - 1, rawFirstVisible)
  const visibleCount = Math.ceil(effectiveHeight / row)
  const start = Math.max(0, firstVisible - extra)
  const end = Math.min(count, firstVisible + visibleCount + extra)
  return {
    start,
    end,
    before: start * row,
    after: Math.max(0, (count - end) * row),
  }
}

export function xDriveFileExplorerGridVirtualWindow({
  itemCount,
  scrollTop,
  viewportHeight,
  columns,
  rowHeight,
  rowGap,
  padding,
  overscanRows,
}: {
  itemCount: number
  scrollTop: number
  viewportHeight: number
  columns: number
  rowHeight: number
  rowGap: number
  padding: number
  overscanRows: number
}): XDriveFileExplorerGridVirtualWindow {
  const count = nonNegativeInteger(itemCount)
  const columnCount = positiveInteger(columns, 1)
  const row = positiveInteger(rowHeight, 1)
  const gap = nonNegativeInteger(rowGap)
  const pad = nonNegativeInteger(padding)
  const overscan = nonNegativeInteger(overscanRows)
  const rowStep = row + gap
  const totalRows = Math.ceil(count / columnCount)

  if (count === 0) {
    return {
      start: 0,
      end: 0,
      startRow: 0,
      totalRows: 0,
      totalHeight: pad * 2,
    }
  }

  const firstVisibleRow = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop - pad) / rowStep),
  )
  const visibleRows = Math.max(
    1,
    Math.ceil(Math.max(nonNegativeInteger(viewportHeight), row) / rowStep),
  )
  const startRow = Math.max(0, Math.min(totalRows - 1, firstVisibleRow) - overscan)
  const endRow = Math.min(totalRows, firstVisibleRow + visibleRows + overscan)

  return {
    start: startRow * columnCount,
    end: Math.min(count, endRow * columnCount),
    startRow,
    totalRows,
    totalHeight: (
      pad * 2 +
      totalRows * row +
      Math.max(0, totalRows - 1) * gap
    ),
  }
}

export function xDriveFileExplorerVirtualWindowSlots<TItem>({
  start,
  end,
  itemAt,
}: {
  start: number
  end: number
  itemAt: (index: number) => TItem | undefined
}): XDriveFileExplorerVirtualSlot<TItem>[] {
  const normalizedStart = nonNegativeInteger(start)
  const normalizedEnd = Math.max(normalizedStart, nonNegativeInteger(end))
  const slots = new Array<XDriveFileExplorerVirtualSlot<TItem>>(
    normalizedEnd - normalizedStart,
  )
  for (let index = normalizedStart; index < normalizedEnd; index += 1) {
    slots[index - normalizedStart] = {
      index,
      item: itemAt(index),
    }
  }
  return slots
}


/** ARIA positions describe Server-authoritative logical items, not the tiny
 * mounted viewport. Details header and group captions are separate table rows.
 */
export type XDriveFileExplorerAriaGroup = { startIndex: number; itemCount: number }
export function xDriveFileExplorerAriaTableRowCount(itemCount: number, groupCount: number): number {
  const count = Number.isSafeInteger(itemCount) && itemCount > 0 ? itemCount : 0
  const headings = Number.isSafeInteger(groupCount) && groupCount > 0 ? groupCount : 0
  return count + headings + 1
}
/** Binary search avoids scanning thousands of group headings per visible row. */
function xDriveFileExplorerAriaGroupOrdinal(
  groups: readonly XDriveFileExplorerAriaGroup[], index: number,
): number {
  let lo = 0
  let hi = groups.length - 1
  while (lo <= hi) {
    const middle = (lo + hi) >>> 1
    const group = groups[middle]
    if (index < group.startIndex) hi = middle - 1
    else if (index >= group.startIndex + group.itemCount) lo = middle + 1
    else return middle
  }
  return -1
}
export function xDriveFileExplorerAriaItemRowIndex(
  logicalIndex: number, groups: readonly XDriveFileExplorerAriaGroup[],
): number {
  const index = Math.max(0, Math.trunc(logicalIndex))
  const ordinal = xDriveFileExplorerAriaGroupOrdinal(groups, index)
  return index + 2 + (ordinal >= 0 ? ordinal + 1 : 0)
}
export function xDriveFileExplorerAriaGroupRowIndex(
  startIndex: number, groups: readonly XDriveFileExplorerAriaGroup[],
): number {
  const ordinal = xDriveFileExplorerAriaGroupOrdinal(groups, startIndex)
  return Math.max(0, Math.trunc(startIndex)) + 2 + Math.max(0, ordinal)
}
export function xDriveFileExplorerAriaItemPosition(logicalIndex: number): number {
  return Math.max(0, Math.trunc(logicalIndex)) + 1
}
