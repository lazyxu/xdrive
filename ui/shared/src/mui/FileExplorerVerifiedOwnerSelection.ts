/**
 * Host-neutral identity gate for actions on already authenticated Owner Files
 * rows. A FileExplorer selection is untrusted: it may outlive a page change,
 * Owner/root revalidation or a cursor refresh. The Host must still authorize
 * each network operation; this only gates the client-side selection.
 *
 * Both projected FileExplorer items (kind) and Owner DTO rows (type) use the
 * same identity. Never coerce string IDs, revisions or byte sizes.
 */
export type XDriveOwnerSelectableItem = Readonly<{
  id: string | number
  name: string
  kind?: string
  type?: string
  // The shared FileExplorer projection permits string revisions. Accept its
  // declared input type but ALWAYS reject nonnumeric revisions at runtime;
  // never coerce strings into privileged Owner identities.
  revision?: string | number
  size?: number
}>

function ownerItemKind(item: XDriveOwnerSelectableItem): 'dir' | 'file' | null {
  if (item.kind !== undefined && item.type !== undefined && item.kind !== item.type) return null
  const value = item.kind ?? item.type
  return value === 'file' || value === 'dir' ? value : null
}

export function xDriveOwnerSelectionMatches(
  selected: XDriveOwnerSelectableItem,
  row: XDriveOwnerSelectableItem,
): boolean {
  if (typeof selected.id !== 'number' || typeof row.id !== 'number' ||
      !Number.isSafeInteger(selected.id) || selected.id <= 0 ||
      !Number.isSafeInteger(row.id) || row.id <= 0) return false
  if (typeof selected.revision !== 'number' || typeof row.revision !== 'number' ||
      !Number.isSafeInteger(selected.revision) || selected.revision <= 0 ||
      !Number.isSafeInteger(row.revision) || row.revision <= 0) return false
  if (typeof selected.size !== 'number' || typeof row.size !== 'number' ||
      !Number.isSafeInteger(selected.size) || selected.size < 0 ||
      !Number.isSafeInteger(row.size) || row.size < 0) return false
  if (typeof selected.name !== 'string' || selected.name.length < 1 ||
      selected.name.length > 512 ||
      typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 512) return false
  const selectedKind = ownerItemKind(selected)
  const rowKind = ownerItemKind(row)
  if (!selectedKind || !rowKind || selectedKind !== rowKind) return false
  return selected.id === row.id && selected.revision === row.revision &&
    selected.size === row.size && selected.name === row.name
}

/**
 * Return ONLY the actual current, authenticated directory row, not the caller's
 * selected object. The caller independently verifies the current Host scope
 * before using it; this function cannot mint Owner permissions.
 */
export function xDriveFindVerifiedOwnerSelection<T extends XDriveOwnerSelectableItem>(
  selected: XDriveOwnerSelectableItem,
  currentRows: readonly T[],
): T | null {
  return currentRows.find(row => xDriveOwnerSelectionMatches(selected, row)) ?? null
}
