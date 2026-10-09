export type XDriveFileExplorerSearchKind =
  | 'folder'
  | 'file'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'code'
  | 'text'
  | 'other'

export type XDriveFileExplorerSearchAvailability =
  | 'local'
  | 'always-local'
  | 'online-only'
  | 'cloud'
  | 'mixed'
  | 'syncing'

export type XDriveFileExplorerSearchFilters = {
  kind?: XDriveFileExplorerSearchKind
  modifiedFrom?: string
  modifiedTo?: string
  minSize?: number
  maxSize?: number
  sourceID?: number
  tagID?: number
  availability?: XDriveFileExplorerSearchAvailability
}

export type XDriveFileExplorerSearchSourceOption = {
  id: number
  name: string
}

export type XDriveFileExplorerSearchTagOption = {
  id: number
  name: string
  color?: string
}

export type XDriveFileExplorerSearchAvailabilityOption = {
  value: XDriveFileExplorerSearchAvailability
  label: string
}

export const xDriveFileExplorerSearchKindLabels: Record<XDriveFileExplorerSearchKind, string> = {
  folder: '文件夹',
  file: '全部文件',
  image: '图片',
  video: '视频',
  audio: '音频',
  pdf: 'PDF',
  document: '文档',
  spreadsheet: '表格',
  presentation: '演示文稿',
  archive: '压缩文件',
  code: '代码',
  text: '文本',
  other: '其他文件',
}

export type XDriveFileExplorerSearchFilterLabelOptions = {
  sourceOptions?: readonly XDriveFileExplorerSearchSourceOption[]
  tagOptions?: readonly XDriveFileExplorerSearchTagOption[]
  availabilityOptions?: readonly XDriveFileExplorerSearchAvailabilityOption[]
}

export function xDriveFileExplorerSearchSizeLabel(
  filters: XDriveFileExplorerSearchFilters,
  detailed = false,
) {
  const min = filters.minSize
  const max = filters.maxSize
  if (min === undefined && max === undefined) return '大小'
  if (min === 0 && max === (1 << 20) - 1) return '大小：< 1 MiB'
  if (min === 1 << 20 && max === (100 << 20) - 1) return '大小：1–100 MiB'
  if (min === 100 << 20 && max === (1 << 30) - 1) return '大小：100 MiB–1 GiB'
  if (min === 1 << 30 && max === undefined) return '大小：≥ 1 GiB'
  if (!detailed) return '大小：已筛选'
  return `大小：${[
    min !== undefined ? `至少 ${min.toLocaleString()} 字节` : '',
    max !== undefined ? `至多 ${max.toLocaleString()} 字节` : '',
  ].filter(Boolean).join(' · ')}`
}

function modifiedLabel(filters: XDriveFileExplorerSearchFilters) {
  const format = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }
  const bounds = [
    filters.modifiedFrom ? `起 ${format(filters.modifiedFrom)}` : '',
    filters.modifiedTo ? `止 ${format(filters.modifiedTo)}` : '',
  ].filter(Boolean)
  return bounds.length > 0 ? `修改时间：${bounds.join(' · ')}` : '修改时间'
}

// The filter editor and committed Search summary share names and exact bounds.
// Missing option records retain the active ID/value until the user clears it.
export function xDriveFileExplorerSearchFilterFieldLabels(
  filters: XDriveFileExplorerSearchFilters,
  { sourceOptions = [], tagOptions = [], availabilityOptions = [] }: XDriveFileExplorerSearchFilterLabelOptions = {},
) {
  const sourceName = sourceOptions.find((item) => item.id === filters.sourceID)?.name
  const tagName = tagOptions.find((item) => item.id === filters.tagID)?.name
  const availabilityName = availabilityOptions.find((item) => item.value === filters.availability)?.label
  return {
    kind: filters.kind ? `类型：${xDriveFileExplorerSearchKindLabels[filters.kind]}` : '类型',
    modified: modifiedLabel(filters),
    size: xDriveFileExplorerSearchSizeLabel(filters, true),
    availability: filters.availability ? `可用性：${availabilityName ?? filters.availability}` : '可用性',
    source: filters.sourceID ? `同步文件夹：${sourceName ?? filters.sourceID}` : '同步文件夹',
    tag: filters.tagID ? `标签：${tagName ?? filters.tagID}` : '标签',
  }
}

export function xDriveFileExplorerSearchFilterLabels(
  filters: XDriveFileExplorerSearchFilters | null | undefined,
  options: XDriveFileExplorerSearchFilterLabelOptions = {},
): string[] {
  if (!filters) return []
  const fields = xDriveFileExplorerSearchFilterFieldLabels(filters, options)
  const labels: string[] = []
  if (filters.kind) labels.push(fields.kind)
  if (filters.modifiedFrom || filters.modifiedTo) labels.push(fields.modified)
  if (filters.minSize !== undefined || filters.maxSize !== undefined) labels.push(fields.size)
  if (filters.availability) labels.push(fields.availability)
  if (filters.sourceID) labels.push(fields.source)
  if (filters.tagID) labels.push(fields.tag)
  return labels
}

export function xDriveFileExplorerSearchFiltersActive(
  filters: XDriveFileExplorerSearchFilters | null | undefined,
) {
  return Boolean(
    filters?.kind ||
    filters?.modifiedFrom ||
    filters?.modifiedTo ||
    filters?.minSize !== undefined ||
    filters?.maxSize !== undefined ||
    filters?.sourceID ||
    filters?.tagID ||
    filters?.availability,
  )
}

export function xDriveFileExplorerSearchFiltersSignature(
  filters: XDriveFileExplorerSearchFilters | null | undefined,
) {
  return [
    filters?.kind ?? '',
    filters?.modifiedFrom ?? '',
    filters?.modifiedTo ?? '',
    filters?.minSize ?? '',
    filters?.maxSize ?? '',
    filters?.sourceID ?? '',
    filters?.tagID ?? '',
    filters?.availability ?? '',
  ].join('|')
}

export function xDriveFileExplorerSearchFilterCount(
  filters: XDriveFileExplorerSearchFilters | null | undefined,
) {
  let count = 0
  if (filters?.kind) count += 1
  if (filters?.modifiedFrom || filters?.modifiedTo) count += 1
  if (filters?.minSize !== undefined || filters?.maxSize !== undefined) count += 1
  if (filters?.sourceID) count += 1
  if (filters?.tagID) count += 1
  if (filters?.availability) count += 1
  return count
}
