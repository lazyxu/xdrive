import type { XDriveFileExplorerSearchFilters } from '../../ui/shared/src/file-explorer-search'

export type XDriveMobileFilesSearchReturn = {
  query: string
  filters: XDriveFileExplorerSearchFilters
  directoryID?: number
}

// Only ephemeral navigation hints survive a Web Mobile Files-tab unmount.
// Source is the live, authenticated Browser API object, not a URL or username.
// The next search always performs a new Owner-authorized counted Server Range.
const confirmedSearches = new WeakMap<object, XDriveMobileFilesSearchReturn & {
  owner: string
}>()

function hasFilters(f: XDriveFileExplorerSearchFilters): boolean {
  return Boolean(f.kind || f.modifiedFrom || f.modifiedTo ||
    f.minSize !== undefined || f.maxSize !== undefined ||
    f.sourceID || f.tagID || f.availability)
}

export function xDriveRememberMobileFilesSearchReturn(
  source: object,
  owner: string,
  query: string,
  filters: XDriveFileExplorerSearchFilters,
  directoryID?: number,
): void {
  if (!owner) return
  const trimmed = query.trim()
  if ((!trimmed && !hasFilters(filters)) || (trimmed && trimmed.length < 2)) {
    confirmedSearches.delete(source)
    return
  }
  if (trimmed.length > 512) return
  confirmedSearches.set(source, {
    owner,
    query: trimmed,
    filters: { ...filters },
    directoryID: directoryID && Number.isSafeInteger(directoryID) &&
      directoryID > 0 ? directoryID : undefined,
  })
}

export function xDriveReadMobileFilesSearchReturn(
  source: object,
  owner: string,
  requestedDirectoryID?: number,
): XDriveMobileFilesSearchReturn | null {
  if (!owner) return null
  const saved = confirmedSearches.get(source)
  if (!saved) return null
  // Observing Owner B on an existing API object revokes A, including A→B→A.
  if (saved.owner !== owner) {
    confirmedSearches.delete(source)
    return null
  }
  if (requestedDirectoryID && saved.directoryID &&
      requestedDirectoryID !== saved.directoryID) return null
  return { query: saved.query, filters: { ...saved.filters },
    directoryID: saved.directoryID }
}

export function xDriveClearMobileFilesSearchReturn(
  source: object,
  owner: string,
): void {
  if (owner && confirmedSearches.get(source)?.owner === owner) {
    confirmedSearches.delete(source)
  }
}
