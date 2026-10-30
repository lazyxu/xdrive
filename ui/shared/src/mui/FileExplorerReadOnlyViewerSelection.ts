/**
 * Read-only Files -> QuickLook selection shared by browser Hosts.
 *
 * The Host supplies an already Owner-verified item list and a genuine media
 * support predicate. A selected/preview ticket is not permission to read bytes:
 * the current authenticated Owner/Root/Node/revision must still be enforced
 * by each Host media request. This model never edits or writes file content.
 */
export type XDriveReadOnlyViewerItem = Readonly<{
  id: number | string
  name: string
  revision?: number | string
  size?: number
}>

export type XDriveReadOnlyViewerTicket<
  TItem extends XDriveReadOnlyViewerItem,
  THost extends object,
> = Readonly<{
  item: TItem
  host: THost
  scopeKey: string
  rootRevision: number
  sessionIDs?: readonly (number | string)[]
}>

export function xDriveFileExplorerReadOnlyViewerSelection<
  TItem extends XDriveReadOnlyViewerItem,
  THost extends object,
>({
  items,
  isPreviewable,
  preview,
  host,
  scopeKey,
  rootRevision,
  verified,
}: {
  items: readonly TItem[]
  isPreviewable: (item: TItem) => boolean
  preview: XDriveReadOnlyViewerTicket<TItem, THost> | null
  host: THost
  scopeKey: string
  rootRevision: number
  verified: boolean
}): {
  items: TItem[]
  index: number
  item: TItem | null
  positionLabel: string
} {
  // No displayed rows are admitted while Owner authentication is unverified.
  const candidates = verified ? items.filter(isPreviewable) : []
  const selected = preview?.sessionIDs
  let sessionItems = candidates
  if (selected) {
    const byID = new Map(candidates.map(item => [item.id, item]))
    const seen = new Set<string | number>()
    sessionItems = selected.flatMap(id => {
      if (seen.has(id)) return []
      seen.add(id)
      const item = byID.get(id)
      return item ? [item] : []
    })
  }
  const current = verified && preview != null &&
    preview.host === host && preview.scopeKey === scopeKey &&
    preview.rootRevision === rootRevision
  const index = current
    ? sessionItems.findIndex(item =>
      item.id === preview.item.id && item.revision === preview.item.revision &&
      item.name === preview.item.name && item.size === preview.item.size)
    : -1
  const item = index >= 0 ? sessionItems[index] : null
  const positionLabel = item
    ? `${index + 1} / ${sessionItems.length} ${selected ? '已选择' : '已加载'}` : ''
  return { items: sessionItems, index, item, positionLabel }
}
