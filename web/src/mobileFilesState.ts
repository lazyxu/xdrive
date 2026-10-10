import { xDriveFileExplorerDetailsVirtualWindow } from '../../ui/shared/src/mui/FileExplorerVirtualSurface'

export type MobileFilesSection = 'recent' | 'browse' | 'favorites'
export type MobileFilesSavedState = {
  section: MobileFilesSection
  folderID: number | null
  scrollTop: number
  view: 'details' | 'grid'
}

export const MOBILE_FILES_HOLD_MS = 450
export const MOBILE_FILES_MOVE_PX = 10
export const MOBILE_FILES_ROW_HEIGHT = 68
export const MOBILE_FILES_GRID_ROW_HEIGHT = 150

// Actual leading edge of file text in List/Recent/Favorites. MUI 2-unit
// horizontal padding (16px) + 44px thumbnail slot + 12px gap; selection
// inserts a 24px circle and another 12px gap. Inline disclosure adds 16px
// per level, capped at the same four levels as the rendered row indentation.
// Keep separators aligned without changing the shared 68px virtual row height.
export function mobileFilesRowTextInset(selectionMode: boolean, depth = 0): number {
  const level = Number.isFinite(depth) ? Math.max(0, Math.min(4, Math.floor(depth))) : 0
  return 16 + level * 16 + 44 + 12 + (selectionMode ? 24 + 12 : 0)
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
    return { section, folderID, scrollTop, view: value.view === 'grid' ? 'grid' : 'details' }
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
