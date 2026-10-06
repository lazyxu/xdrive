import type { QuotaUsage } from './models'
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
  offset: number
  limit: number
  sort: XDriveCloudFilesSortKey
  order: XDriveCloudFilesSortDirection
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

export type XDriveFileQuickAccessItem<TNode extends { id: number }> = {
  node: TNode
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  pinned_at: string
}

export type XDriveFileRecentItem<TNode extends { id: number }> = {
  node: TNode
  path: string
  crumbs: XDriveCloudFilesCrumb[]
  accessed_at: string
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
  ) => Promise<XDriveCloudFilesRange<TNode>>
  getQuota: () => Promise<TQuota>
}
