/**
 * Shared touch intent thresholds for Files and Gallery. Ordinary scrolling
 * always wins before the long-press timer; after a hold, move can start drag
 * only if the owning application has a valid drop operation.
 */
export const XDRIVE_MOBILE_ITEM_HOLD_MS = 450
export const XDRIVE_MOBILE_ITEM_MOVE_PX = 10

export type XDriveMobileItemPoint = { x: number; y: number }

export function xDriveMobileItemMoved(
  start: XDriveMobileItemPoint,
  current: XDriveMobileItemPoint,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > XDRIVE_MOBILE_ITEM_MOVE_PX
}
