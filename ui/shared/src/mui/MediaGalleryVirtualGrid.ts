export const XDRIVE_MEDIA_GALLERY_MIN_TILE_WIDTH = 150
export const XDRIVE_MEDIA_GALLERY_GRID_GAP = 4
export const XDRIVE_MEDIA_GALLERY_OVERSCAN_ROWS = 2
// KFS calImageWidth uses max(minColumns, floor(availableWidth / 256)).
// The caller supplies clientWidth, which already excludes its scrollbar.
export const XDRIVE_MEDIA_GALLERY_KFS_REFERENCE_WIDTH = 256

export function xDriveMediaGalleryKfsColumnCount(
  width: number,
  minColumns: number,
  referenceWidth = XDRIVE_MEDIA_GALLERY_KFS_REFERENCE_WIDTH,
) {
  const available = Number.isFinite(width) ? Math.max(0, width) : 0
  const minimum = Number.isFinite(minColumns) ? Math.max(1, Math.ceil(minColumns)) : 1
  const reference = Number.isFinite(referenceWidth) && referenceWidth > 0
    ? referenceWidth : XDRIVE_MEDIA_GALLERY_KFS_REFERENCE_WIDTH
  return Math.max(minimum, Math.floor(available / reference))
}

/** Gestures change a column preference once on release; no per-frame relayout. */
export function xDriveMediaGalleryPinchColumnCount(
  initialColumns: number,
  startDistance: number,
  endDistance: number,
  minColumns = 2,
  maxColumns = 10,
) {
  const current = Number.isFinite(initialColumns) ? Math.max(1, Math.round(initialColumns)) : 3
  if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance) ||
      startDistance < 24 || endDistance < 24) return current
  const ratio = endDistance / startDistance
  if (Math.abs(ratio - 1) < 0.08) return current
  const low = Math.max(1, Math.round(minColumns))
  const high = Math.max(low, Math.round(maxColumns))
  return Math.min(high, Math.max(low, Math.round(current / ratio)))
}

export type XDriveMediaGalleryGridMetrics = {
  columns: number
  columnWidth: number
  rowStep: number
  totalRows: number
  totalHeight: number
}

export type XDriveMediaGalleryGridWindow = {
  start: number
  end: number
  startRow: number
  endRow: number
}

function positive(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : fallback
}

function nonNegative(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

export function xDriveMediaGalleryGridMetrics({
  width,
  itemCount,
  minColumnWidth = XDRIVE_MEDIA_GALLERY_MIN_TILE_WIDTH,
  gap = XDRIVE_MEDIA_GALLERY_GRID_GAP,
  minColumns,
  referenceColumnWidth = XDRIVE_MEDIA_GALLERY_KFS_REFERENCE_WIDTH,
}: {
  width: number
  itemCount: number
  minColumnWidth?: number
  gap?: number
  minColumns?: number
  referenceColumnWidth?: number
}): XDriveMediaGalleryGridMetrics {
  const available = nonNegative(width)
  const count = Math.max(0, Math.trunc(itemCount) || 0)
  const minWidth = positive(minColumnWidth, XDRIVE_MEDIA_GALLERY_MIN_TILE_WIDTH)
  const normalizedGap = nonNegative(gap)
  // KFS-style column-first mode is opt-in: wide Web/Desktop keep the
  // existing minimum-pixel-width behavior without changing their density.
  const columns = minColumns === undefined
    ? Math.max(1, Math.floor((available + normalizedGap) / (minWidth + normalizedGap)))
    : xDriveMediaGalleryKfsColumnCount(available, minColumns, referenceColumnWidth)
  const columnWidth = available > 0
    ? Math.max(1, (available - normalizedGap * (columns - 1)) / columns)
    : minWidth
  const rowStep = columnWidth + normalizedGap
  const totalRows = Math.ceil(count / columns)
  const totalHeight = totalRows > 0
    ? totalRows * columnWidth + Math.max(0, totalRows - 1) * normalizedGap
    : 0
  return { columns, columnWidth, rowStep, totalRows, totalHeight }
}

export function xDriveMediaGalleryGridWindow({
  itemCount,
  columns,
  rowStep,
  visibleTop,
  visibleBottom,
  overscanRows = XDRIVE_MEDIA_GALLERY_OVERSCAN_ROWS,
}: {
  itemCount: number
  columns: number
  rowStep: number
  visibleTop: number
  visibleBottom: number
  overscanRows?: number
}): XDriveMediaGalleryGridWindow {
  const count = Math.max(0, Math.trunc(itemCount) || 0)
  if (count === 0) return { start: 0, end: 0, startRow: 0, endRow: 0 }

  const columnCount = positive(columns, 1)
  const step = Math.max(1, rowStep)
  const totalRows = Math.ceil(count / columnCount)
  const overscan = Math.max(0, Math.trunc(overscanRows) || 0)
  const top = nonNegative(Math.min(visibleTop, visibleBottom))
  const bottom = Math.max(top, nonNegative(Math.max(visibleTop, visibleBottom)))
  const firstVisibleRow = Math.min(totalRows - 1, Math.floor(top / step))
  const lastVisibleRow = Math.min(
    totalRows - 1,
    Math.max(firstVisibleRow, Math.ceil(bottom / step) - 1),
  )
  const startRow = Math.max(0, firstVisibleRow - overscan)
  const endRow = Math.min(totalRows, lastVisibleRow + overscan + 1)
  return {
    start: startRow * columnCount,
    end: Math.min(count, endRow * columnCount),
    startRow,
    endRow,
  }
}
