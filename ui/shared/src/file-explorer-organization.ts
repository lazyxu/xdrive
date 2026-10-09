import {
  xDriveFileExplorerSearchFilterLabels,
  xDriveFileExplorerSearchFiltersActive,
  xDriveFileExplorerSearchFiltersSignature,
} from './file-explorer-search'
import type {
  XDriveFileExplorerSearchFilterLabelOptions,
  XDriveFileExplorerSearchFilters,
} from './file-explorer-search'

export type XDriveFileTag = {
  id: number
  name: string
  color?: string
  item_count: number
  created_at: string
  updated_at: string
}

export type XDriveFileNodeTags = {
  node_id: number
  tags: XDriveFileTag[] | null
}

export type XDriveFileSavedSearch = {
  id: number
  name: string
  query: string
  filters: XDriveFileExplorerSearchFilters
  position: number
  created_at: string
  updated_at: string
}

export type XDriveFileSavedSearchInput = {
  name: string
  query: string
  filters: XDriveFileExplorerSearchFilters
}

export type XDriveFileExplorerOrganizationPort = {
  listTags: () => Promise<XDriveFileTag[]>
  createTag: (name: string, color: string) => Promise<XDriveFileTag>
  updateTag: (id: number, input: { name?: string; color?: string }) => Promise<XDriveFileTag>
  deleteTag: (id: number) => Promise<unknown>
  queryNodeTags: (nodeIDs: number[]) => Promise<XDriveFileNodeTags[]>
  addTagNodes: (tagID: number, nodeIDs: number[]) => Promise<unknown>
  removeTagNodes: (tagID: number, nodeIDs: number[]) => Promise<unknown>
  listSavedSearches: () => Promise<XDriveFileSavedSearch[]>
  createSavedSearch: (input: XDriveFileSavedSearchInput) => Promise<XDriveFileSavedSearch>
  updateSavedSearch: (id: number, input: XDriveFileSavedSearchInput) => Promise<XDriveFileSavedSearch>
  deleteSavedSearch: (id: number) => Promise<unknown>
  reorderSavedSearches: (ids: number[]) => Promise<unknown>
}

export function xDriveFileExplorerPersistedSearchFilters(
  filters: XDriveFileExplorerSearchFilters,
): XDriveFileExplorerSearchFilters {
  const {
    availability: _availability,
    ...serverFilters
  } = filters
  return serverFilters
}

export function xDriveFileExplorerSavedSearchSignature(
  query: string,
  filters: XDriveFileExplorerSearchFilters,
) {
  return JSON.stringify([
    query.trim(),
    xDriveFileExplorerSearchFiltersSignature(xDriveFileExplorerPersistedSearchFilters(filters)),
  ])
}

export function xDriveFileExplorerOrganizationSearchState({
  active,
  query,
  filters,
  savedSearches,
}: {
  active: boolean
  query: string
  filters: XDriveFileExplorerSearchFilters
  savedSearches: readonly XDriveFileSavedSearch[]
}) {
  const portableFilters = xDriveFileExplorerPersistedSearchFilters(filters)
  const canSaveCurrentSearch = active && Boolean(query.trim() || xDriveFileExplorerSearchFiltersActive(portableFilters))
  const signature = xDriveFileExplorerSavedSearchSignature(query, portableFilters)
  const matching = active ? savedSearches.filter((saved) => (
    xDriveFileExplorerSavedSearchSignature(saved.query, saved.filters) === signature
  )) : []
  const notices: string[] = []
  if (active && filters.availability) {
    notices.push('可用性仅在此设备生效，不包含在保存规则中。')
    if (!canSaveCurrentSearch) notices.push('请添加关键词或可跨设备筛选后再保存。')
  }
  if (canSaveCurrentSearch && !matching.length) {
    notices.push(savedSearches.length
      ? '当前条件与已保存规则不同，可保存为新规则或更新已有规则。'
      : '当前搜索尚未保存，可保存为智能文件夹。')
  }
  return {
    activeSavedSearchID: matching[0]?.id ?? null,
    matchingSavedSearchIDs: matching.map((saved) => saved.id),
    activeTagID: active ? filters.tagID ?? null : null,
    canSaveCurrentSearch,
    currentSearchNotice: notices.join(' '),
  }
}

export function xDriveFileExplorerSavedSearchRuleLabels(
  saved: Pick<XDriveFileSavedSearch, 'query' | 'filters'>,
  options: XDriveFileExplorerSearchFilterLabelOptions = {},
): string[] {
  return [
    ...(saved.query.trim() ? [`搜索：“${saved.query.trim()}”`] : []),
    ...xDriveFileExplorerSearchFilterLabels(xDriveFileExplorerPersistedSearchFilters(saved.filters), options),
  ]
}
