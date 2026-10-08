import type { XDriveFileExplorerSearchFilters } from './file-explorer-search'

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
  tags: XDriveFileTag[]
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
