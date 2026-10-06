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
}: {
  itemCount: number
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  headerHeight: number
  overscan: number
}): XDriveFileExplorerVirtualWindow {
  const count = nonNegativeInteger(itemCount)
  const row = positiveInteger(rowHeight, 1)
  const header = nonNegativeInteger(headerHeight)
  const extra = nonNegativeInteger(overscan)
  if (count === 0) return { start: 0, end: 0, before: 0, after: 0 }

  const effectiveHeight = Math.max(nonNegativeInteger(viewportHeight), row * 8)
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
