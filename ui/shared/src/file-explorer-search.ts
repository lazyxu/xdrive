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

export type XDriveFileExplorerSearchFilters = {
  kind?: XDriveFileExplorerSearchKind
  modifiedFrom?: string
  modifiedTo?: string
  minSize?: number
  maxSize?: number
  sourceID?: number
}

export type XDriveFileExplorerSearchSourceOption = {
  id: number
  name: string
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
    filters?.sourceID,
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
  return count
}
