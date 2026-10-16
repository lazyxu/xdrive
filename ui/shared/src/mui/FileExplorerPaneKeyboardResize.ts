/** Keyboard-aware resize for actual focusable shared FileExplorer splitters.
 * Unrecognized or system-modified keys are left to browser/Desktop commands.
 */
export type XDriveFileExplorerKeyboardResizeInput = {
  key: string
  width: number
  minWidth: number
  maxWidth: number
  expandArrow: 'ArrowLeft' | 'ArrowRight'
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}
export function xDriveFileExplorerKeyboardResizeWidth({
  key, width, minWidth, maxWidth, expandArrow,
  shiftKey = false, ctrlKey = false, altKey = false, metaKey = false,
}: XDriveFileExplorerKeyboardResizeInput): number | null {
  if (ctrlKey || altKey || metaKey ||
      !['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(key)) return null
  if (![width, minWidth, maxWidth].every(Number.isFinite) || minWidth > maxWidth) return null
  const min = Math.ceil(minWidth)
  const max = Math.floor(maxWidth)
  if (min > max) return null
  if (key === 'Home') return min
  if (key === 'End') return max
  const current = Math.max(min, Math.min(max, Math.round(width)))
  const distance = shiftKey ? 32 : 16
  return Math.max(min, Math.min(max, current + (key === expandArrow ? distance : -distance)))
}
