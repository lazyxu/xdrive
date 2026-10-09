export const XDRIVE_FILE_EXPLORER_DRAG_MIME =
  'application/x-xdrive-fileexplorer'

export type XDriveFileExplorerDragID = string | number

export function xDriveFileExplorerEncodeDragItems(
  items: readonly { id: XDriveFileExplorerDragID }[],
) {
  return JSON.stringify({
    version: 1,
    ids: items.map((item) => item.id),
  })
}

export function xDriveFileExplorerDecodeDragIDs(
  value: string,
): XDriveFileExplorerDragID[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown
      ids?: unknown
    }
    if (parsed.version !== 1 || !Array.isArray(parsed.ids)) return []
    const out: XDriveFileExplorerDragID[] = []
    const seen = new Set<string>()
    for (const raw of parsed.ids.slice(0, 10_000)) {
      if (
        !(
          (typeof raw === 'number' && Number.isSafeInteger(raw)) ||
          (typeof raw === 'string' && raw.length > 0)
        )
      ) continue
      const key = typeof raw === 'number' ? `n:${raw}` : `s:${raw}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(raw)
    }
    return out
  } catch {
    return []
  }
}

/**
 * Only the dedicated 44px touch drag handle disables native scrolling.
 * Ordinary file rows keep their browser-owned pan gesture.
 */
export const XDRIVE_FILE_EXPLORER_TOUCH_DRAG_START_DISTANCE = 10

export function xDriveFileExplorerTouchDragActivated(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
) {
  if (![startX, startY, currentX, currentY].every(Number.isFinite)) return false
  return Math.hypot(currentX - startX, currentY - startY) >=
    XDRIVE_FILE_EXPLORER_TOUCH_DRAG_START_DISTANCE
}

export function xDriveFileExplorerTouchDropAllowed(
  items: readonly { id: XDriveFileExplorerDragID }[],
  target: { id: XDriveFileExplorerDragID },
) {
  const key = (id: XDriveFileExplorerDragID) =>
    typeof id === 'number' ? `n:${id}` : `s:${id}`
  return !items.some((item) => key(item.id) === key(target.id))
}
