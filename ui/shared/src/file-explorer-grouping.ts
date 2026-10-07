export type XDriveFileExplorerGroupBy = 'none' | 'type' | 'modified' | 'size'

export type XDriveFileExplorerGrouping = {
  groupBy: XDriveFileExplorerGroupBy
  foldersFirst: boolean
}

export type XDriveFileExplorerGroupIndex = {
  key: string
  item_count: number
  start_index: number
}

export const XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING: XDriveFileExplorerGrouping = {
  groupBy: 'none',
  foldersFirst: true,
}

export function xDriveFileExplorerGroupingSignature(
  grouping: XDriveFileExplorerGrouping,
) {
  return `${grouping.groupBy}:${grouping.foldersFirst ? 'folders-first' : 'mixed'}`
}

export function xDriveFileExplorerGroupLabel(
  groupBy: XDriveFileExplorerGroupBy,
  key: string,
) {
  if (groupBy === 'type') {
    if (key === 'folder') return '文件夹'
    if (key === 'other') return '其他文件'
    if (key.startsWith('ext:')) {
      const extension = key.slice(4).trim()
      return extension ? extension.toUpperCase() : '其他文件'
    }
  }
  if (groupBy === 'modified') {
    const match = /^month:(\d{4})-(\d{2})$/.exec(key)
    if (match) return `${Number(match[1])}年${Number(match[2])}月`
    return '日期未知'
  }
  if (groupBy === 'size') {
    switch (key) {
      case 'folder': return '文件夹'
      case 'empty': return '空文件'
      case 'tiny': return '小于 1 MiB'
      case 'small': return '1–100 MiB'
      case 'medium': return '100 MiB–1 GiB'
      case 'large': return '1 GiB 及以上'
      default: return '其他大小'
    }
  }
  return key
}

export function xDriveNormalizeFileExplorerGrouping(
  value: Partial<XDriveFileExplorerGrouping> | null | undefined,
): XDriveFileExplorerGrouping {
  const groupBy: XDriveFileExplorerGroupBy = (
    value?.groupBy === 'type' ||
    value?.groupBy === 'modified' ||
    value?.groupBy === 'size'
  ) ? value.groupBy : 'none'
  return {
    groupBy,
    foldersFirst: value?.foldersFirst !== false,
  }
}
