import type { QuotaUsage } from './models'
import type {
  XDriveFileExplorerGroupIndex,
  XDriveFileExplorerGrouping,
} from './file-explorer-grouping'
import type {
  XDriveFileExplorerPageRequestOptions,
  XDriveFileExplorerPageSort,
} from './file-explorer-controller'

export type XDriveCloudFilesSortKey = 'name' | 'updated' | 'type' | 'size'
export type XDriveCloudFilesSortDirection = 'asc' | 'desc'

export type XDriveCloudFilesPageOptions = {
  limit?: number
  cursor?: string
  sort?: XDriveCloudFilesSortKey
  order?: XDriveCloudFilesSortDirection
  name?: string
  nameInsensitive?: string
}

export type XDriveCloudFilesPage<TNode extends { id: number }> = {
  items: TNode[]
  next_cursor?: string
  has_more: boolean
  sort: XDriveCloudFilesSortKey
  order: XDriveCloudFilesSortDirection
}

export type XDriveCloudFilesRange<TNode extends { id: number }> = {
  items: TNode[]
  total_count: number
  total_count_included?: boolean
  offset: number
  limit: number
  sort: XDriveCloudFilesSortKey
  order: XDriveCloudFilesSortDirection
  groups?: XDriveFileExplorerGroupIndex[]
}

export type XDriveCloudFilesCrumb = {
  id: number
  name: string
}

export type XDriveCloudFilesSearchResult<TNode extends { id: number }> = {
  node: TNode
  path: string
  crumbs: XDriveCloudFilesCrumb[]
}

export type XDriveCloudFilesSearchPage<TNode extends { id: number }> = {
  items: XDriveCloudFilesSearchResult<TNode>[]
  next_cursor?: string
}

export type XDriveCloudFilesSearchRange<TNode extends { id: number }> = {
  items: XDriveCloudFilesSearchResult<TNode>[]
  total_count: number
  offset: number
  limit: number
  sort: XDriveCloudFilesSortKey
  order: XDriveCloudFilesSortDirection
  groups?: XDriveFileExplorerGroupIndex[]
}

export type XDriveFileQuickAccessItem<TNode extends { id: number }> = {
  node: TNode
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  position: number
  pinned_at: string
}

export type XDriveFileFavoriteItem<TNode extends { id: number }> = {
  node: TNode
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  favorited_at: string
}

export type XDriveFileRecentItem<TNode extends { id: number }> = {
  node: TNode
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  accessed_at: string
}

export type XDriveCloudFilesChange<TNode extends { id: number }> = {
  cursor: number
  node_id: number
  operation: 'upsert' | 'delete'
  affected_parent_ids: number[]
  path?: string
  node?: TNode
}

export type XDriveCloudFilesChangePage<TNode extends { id: number }> = {
  changes: XDriveCloudFilesChange<TNode>[]
  next_cursor: number
  latest_cursor: number
  has_more: boolean
  reset_required?: boolean
}

export function xDriveCloudFilesChangeAffectsParent(
  change: Pick<XDriveCloudFilesChange<{ id: number }>, 'affected_parent_ids'>,
  parentID: number,
) {
  return change.affected_parent_ids.includes(parentID)
}

export interface XDriveCloudFilesPort<
  TNode extends { id: number },
  TQuota extends QuotaUsage = QuotaUsage,
  TSort extends XDriveFileExplorerPageSort = XDriveFileExplorerPageSort,
> {
  getRoot: () => Promise<TNode>
  getPage: (
    parentID: number,
    options: XDriveFileExplorerPageRequestOptions<TSort>,
  ) => Promise<XDriveCloudFilesPage<TNode>>
  getRange: (
    parentID: number,
    offset: number,
    limit: number,
    sort: TSort,
    includeCount: boolean,
    grouping: XDriveFileExplorerGrouping,
  ) => Promise<XDriveCloudFilesRange<TNode>>
  getChanges?: (
    after: number,
    limit: number,
  ) => Promise<XDriveCloudFilesChangePage<TNode>>
  getQuota: () => Promise<TQuota>
}
