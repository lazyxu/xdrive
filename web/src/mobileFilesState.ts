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
  const count = Math.max(0, Math.floor(total))
  const row = Math.max(1, rowHeight)
  const first = Math.min(Math.max(0, count - 1), Math.max(0, Math.floor(scrollTop / row)))
  const start = count ? Math.max(0, first - overscan) : 0
  const end = count ? Math.min(count, first + Math.ceil(Math.max(300, viewportHeight) / row) + overscan) : 0
  return { start, end, before: start * row, after: Math.max(0, count - end) * row }
}
