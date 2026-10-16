/** Presentation-only disabled reasons for common FileExplorer menu items.
 * Do not infer authorization: callers provide the authoritative reason,
 * and unknown disabled state uses a neutral explanation.
 */
export type XDriveFileExplorerMenuAvailability = {
  disabled?: boolean
  disabledReason?: string
}
export function xDriveFileExplorerMenuDisabledReason(
  item: XDriveFileExplorerMenuAvailability,
): string | null {
  if (!item.disabled) return null
  const reason = item.disabledReason?.trim()
  return reason || '此操作当前不可用'
}
export function xDriveFileExplorerMenuReasonLabel(item: XDriveFileExplorerMenuAvailability): string | null {
  const reason = xDriveFileExplorerMenuDisabledReason(item)
  return reason ? '不可用：' + reason : null
}
