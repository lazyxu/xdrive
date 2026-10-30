import {
  xDriveFindVerifiedOwnerSelection,
  type XDriveOwnerSelectableItem,
} from './FileExplorerVerifiedOwnerSelection'

/**
 * Shared, *read-only* admission for a verified current Owner Files download.
 * This is UI preflight only: Server, Agent and DSM CGI reauthorize the exact
 * Owner/Node/revision and check all bytes before an actual user-initiated save.
 * It never creates a write, shares a token or grants an unavailable Host action.
 */
export function xDriveFileExplorerReadOnlyDownloadReason<
  TRow extends XDriveOwnerSelectableItem,
>({
  selected,
  count = selected.length,
  rows,
  ownerCurrent,
  scopeVerified,
  downloadActive,
  maxBytes,
  sizeLimitLabel,
}: {
  selected: readonly XDriveOwnerSelectableItem[]
  count?: number
  rows: readonly TRow[]
  ownerCurrent: boolean
  scopeVerified: boolean
  downloadActive: boolean
  maxBytes: number
  sizeLimitLabel: string
}): string | null {
  if (!ownerCurrent || !scopeVerified) return '当前 Server Owner 目录尚未验证'
  if (downloadActive) return '已有正在执行的文件下载'
  if (count !== 1 || selected.length !== 1) return '暂仅支持单个文件下载'
  const item = selected[0]
  if (!item || item.kind !== 'file' || typeof item.size !== 'number' ||
      !Number.isSafeInteger(item.size) || item.size < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || item.size > maxBytes) {
    return `仅支持大小为 1 B～${sizeLimitLabel} 的单个原始文件下载`
  }
  const current = xDriveFindVerifiedOwnerSelection(item, rows)
  if (!current || current.type !== 'file') {
    return '该文件不属于当前已核实的 Server Owner 目录'
  }
  return null
}
