import type { XDriveFileExplorerGroupLayout } from '../../ui/shared/src/mui/FileExplorerGroupingLayout'
import { xDriveFileExplorerDetailsVirtualWindow } from '../../ui/shared/src/mui/FileExplorerVirtualSurface'

export type MobileFilesSection = 'recent' | 'browse' | 'favorites'
export type MobileFilesSavedState = {
  section: MobileFilesSection
  folderID: number | null
  scrollTop: number
  // Recent/Favorites are separate sparse collections, not the saved Browse folder.
  // Optional fields keep old account-scoped v1 localStorage records compatible.
  recentScrollTop?: number
  favoritesScrollTop?: number
  view: 'details' | 'grid'
}

export const MOBILE_FILES_HOLD_MS = 450
export const MOBILE_FILES_MOVE_PX = 10
export const MOBILE_FILES_ROW_HEIGHT = 68
export const MOBILE_FILES_GRID_ROW_HEIGHT = 150

/** F02-M: read out a mounted Mobile button's position within the complete
 * logical list, not just the retained virtual window. Buttons are kept for
 * their Open/Quick Look/selection keyboard contract; aria-posinset on a button
 * would be an invalid ARIA role/property combination.
 */
export function mobileFilesLogicalPositionDescription(
  index: number, itemCount: number,
): string | undefined {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0 ||
      !Number.isSafeInteger(index) || index < 0 || index >= itemCount) return undefined
  return `第 ${index + 1} 项，共 ${itemCount} 项`
}

// Actual leading edge of file text in List/Recent/Favorites. iOS 27 List
// uses a 28px outer gutter + 44px thumbnail slot + 12px gap; selection
// inserts a 24px circle and another 12px gap. Inline disclosure adds 16px
// per level, capped at four levels. Keep the 68px virtual-row contract.
// Keep separators aligned without changing the shared 68px virtual row height.
export function mobileFilesRowTextInset(selectionMode: boolean, depth = 0): number {
  const level = Number.isFinite(depth) ? Math.max(0, Math.min(4, Math.floor(depth))) : 0
  return 28 + level * 16 + 44 + 12 + (selectionMode ? 24 + 12 : 0)
}

// Presentation-only projection from the existing authoritative Node fields.
// Keep this O(1) per *mounted virtual row*: no directory scan, document read,
// thumbnail fetch or Mobile-only API is allowed to produce this secondary line.
export type MobileFilesMetadataSource = {
  kind: 'dir' | 'file'
  updatedAt?: string
  size?: number
  secondaryLabel?: string
}

// iOS Files expresses file size in decimal KB/MB rather than the shared
// FileExplorer's IEC KiB/MiB. Only the display string differs; Server byte
// counts, download receipts and Web/Desktop storage calculations do not.
export function mobileFilesNativeSizeLabel(bytes: number): string | null {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null
  if (bytes < 1000) return `${bytes} 字节`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'] as const
  let value = bytes
  let unit = -1
  do {
    value /= 1000
    unit += 1
  } while (value >= 1000 && unit < units.length - 1)
  let displayed = Number(value.toFixed(value < 10 ? 1 : 0))
  if (displayed >= 1000 && unit < units.length - 1) {
    unit += 1
    displayed = 1
  }
  return `${displayed.toLocaleString('zh-CN')} ${units[unit]}`
}

function mobileFilesLocalCalendarOrdinal(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

export function mobileFilesNativeMetadata(
  item: MobileFilesMetadataSource, now: Date = new Date(),
): string | null {
  // Search entries keep their authoritative location path. Never replace it
  // with a date, or synthesize a path from a name or virtual row index.
  const path = item.secondaryLabel?.trim()
  if (path) return path

  const modified = item.updatedAt ? new Date(item.updatedAt) : null
  const validDate = modified !== null && Number.isFinite(modified.getTime())
  let dateLabel: string | null = null
  if (validDate && modified) {
    dateLabel = `${modified.getFullYear()}/${modified.getMonth() + 1}/${modified.getDate()}`
    if (item.kind === 'dir' && Number.isFinite(now.getTime())) {
      const days = mobileFilesLocalCalendarOrdinal(now) -
        mobileFilesLocalCalendarOrdinal(modified)
      if (days === 0) dateLabel = '今天'
      else if (days === 1) dateLabel = '昨天'
      else if (days === 2) dateLabel = '前天'
    }
  }
  if (item.kind === 'dir') return dateLabel
  const size = item.size === undefined ? null : mobileFilesNativeSizeLabel(item.size)
  return [dateLabel, size].filter(Boolean).join(' - ') || null
}

export const mobileFilesDefaultState = (): MobileFilesSavedState => ({
  section: 'browse', folderID: null, scrollTop: 0, view: 'details',
})

export function mobileFilesDecodeState(raw: string | null): MobileFilesSavedState {
  if (!raw) return mobileFilesDefaultState()
  try {
    const value = JSON.parse(raw) as Partial<MobileFilesSavedState>
    const section: MobileFilesSection =
      value.section === 'recent' || value.section === 'favorites' ? value.section : 'browse'
    const folderID = typeof value.folderID === 'number' &&
      Number.isSafeInteger(value.folderID) && value.folderID > 0 ? value.folderID : null
    const scrollTop = typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop)
      ? Math.max(0, Math.min(10_000_000, value.scrollTop)) : 0
    const sectionScroll = (offset: unknown): number | undefined =>
      typeof offset === 'number' && Number.isFinite(offset)
        ? Math.max(0, Math.min(10_000_000, offset)) : undefined
    const recentScrollTop = sectionScroll(value.recentScrollTop)
    const favoritesScrollTop = sectionScroll(value.favoritesScrollTop)
    return {
      section, folderID, scrollTop, view: value.view === 'grid' ? 'grid' : 'details',
      ...(recentScrollTop === undefined ? {} : { recentScrollTop }),
      ...(favoritesScrollTop === undefined ? {} : { favoritesScrollTop }),
    }
  } catch { return mobileFilesDefaultState() }
}

export function mobileFilesEncodeState(state: MobileFilesSavedState): string {
  return JSON.stringify(state)
}

export function mobileFilesIsMoved(start: { x: number; y: number }, current: { x: number; y: number }) {
  return Math.hypot(start.x - current.x, start.y - current.y) > MOBILE_FILES_MOVE_PX
}

/** Bound all row/thumbnail mounts by the visible viewport, never logical itemCount. */
export function mobileFilesWindow(
  total: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = 5,
) {
  // Desktop Details and Mobile List/Grid share one bounded window calculation.
  // Mobile retains its previous 300 CSS px minimum instead of desktop's eight-row floor.
  return xDriveFileExplorerDetailsVirtualWindow({
    itemCount: total, scrollTop, viewportHeight, rowHeight,
    headerHeight: 0, overscan, minViewportHeight: 300,
  })
}

/** U09: preserve a logical item, not a pixel offset, across List/Grid geometry.
 * The sparse Server group index is enough; never walk itemAt() or enumerate 100k.
 */
export type MobileFilesViewportAnchor = { index: number; fraction: number }
export function mobileFilesViewportAnchor(
  itemCount: number, scrollTop: number, rowHeight: number, columns: number,
  grouped: XDriveFileExplorerGroupLayout | null = null,
): MobileFilesViewportAnchor {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) return { index: 0, fraction: 0 }
  const y = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  const row = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1
  const cols = Number.isSafeInteger(columns) && columns > 0 ? columns : 1
  if (grouped?.groups.length) {
    let lo = 0
    let hi = grouped.groups.length - 1
    let ordinal = 0
    while (lo <= hi) {
      const middle = (lo + hi) >>> 1
      if (grouped.groups[middle].top <= y) { ordinal = middle; lo = middle + 1 }
      else hi = middle - 1
    }
    const group = grouped.groups[ordinal]
    if (group.itemCount > 0) {
      const step = Math.max(1, grouped.rowHeight + grouped.rowGap)
      const rowNumber = Math.max(0, Math.min(group.rowCount - 1,
        Math.floor(Math.max(0, y - group.itemsTop) / step)))
      const index = Math.min(itemCount - 1,
        group.startIndex + Math.min(group.itemCount - 1, rowNumber * grouped.columns))
      const rowTop = group.itemsTop + rowNumber * step
      const fraction = Math.max(0, Math.min(0.999, (y - rowTop) / grouped.rowHeight))
      return { index, fraction }
    }
  }
  const rowNumber = Math.floor(y / row)
  return {
    index: Math.min(itemCount - 1, rowNumber * cols),
    fraction: Math.max(0, Math.min(0.999, (y - rowNumber * row) / row)),
  }
}

export function mobileFilesViewportTop(
  anchor: MobileFilesViewportAnchor, rowHeight: number, columns: number,
  grouped: XDriveFileExplorerGroupLayout | null = null,
): number {
  const row = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1
  const cols = Number.isSafeInteger(columns) && columns > 0 ? columns : 1
  const index = Number.isSafeInteger(anchor.index) ? Math.max(0, anchor.index) : 0
  const fraction = Number.isFinite(anchor.fraction)
    ? Math.max(0, Math.min(0.999, anchor.fraction)) : 0
  if (grouped?.groups.length) {
    let lo = 0
    let hi = grouped.groups.length - 1
    while (lo <= hi) {
      const middle = (lo + hi) >>> 1
      const group = grouped.groups[middle]
      if (index < group.startIndex) hi = middle - 1
      else if (index >= group.startIndex + group.itemCount) lo = middle + 1
      else return group.itemsTop +
        Math.floor((index - group.startIndex) / grouped.columns) * (grouped.rowHeight + grouped.rowGap) +
        Math.floor(fraction * grouped.rowHeight)
    }
    // A Server regroup/resort invalidates positional identity: never guess.
    return 0
  }
  return Math.floor(index / cols) * row + Math.floor(fraction * row)
}
