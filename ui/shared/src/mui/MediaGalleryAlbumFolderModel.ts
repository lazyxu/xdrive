import type { MediaAlbum, MediaAlbumFolder } from '../models'

// Gallery album folders are logical metadata, not filesystem Sync Folders.
// Keep UI traversal bounded; Server enforces owner, sibling names and cycles.
export function mediaAlbumFolderPath(
  folders: readonly MediaAlbumFolder[],
  activeID: number,
): MediaAlbumFolder[] {
  const byID = new Map(folders.map(folder => [folder.id, folder]))
  const seen = new Set<number>()
  const reverse: MediaAlbumFolder[] = []
  let current = activeID
  while (current > 0 && reverse.length < 64) {
    if (seen.has(current)) return []
    seen.add(current)
    const folder = byID.get(current)
    if (!folder) return []
    reverse.push(folder)
    current = folder.parent_id
  }
  return current === 0 ? reverse.reverse() : []
}

export function mediaAlbumFolderChildren(
  folders: readonly MediaAlbumFolder[],
  parentID: number,
): MediaAlbumFolder[] {
  return folders.filter(folder => folder.parent_id === parentID)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id)
}

export function mediaAlbumFolderDestinations(
  folders: readonly MediaAlbumFolder[],
  movingFolderID = 0,
): MediaAlbumFolder[] {
  const children = new Map<number, number[]>()
  for (const folder of folders) {
    const siblings = children.get(folder.parent_id) ?? []
    siblings.push(folder.id)
    children.set(folder.parent_id, siblings)
  }
  const excluded = new Set<number>()
  const pending = movingFolderID > 0 ? [movingFolderID] : []
  while (pending.length > 0) {
    const id = pending.pop()!
    if (excluded.has(id)) continue
    excluded.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return folders.filter(folder => !excluded.has(folder.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id)
}

export function mediaAlbumsInFolder(
  albums: readonly MediaAlbum[],
  folderID: number,
  searching: boolean,
): MediaAlbum[] {
  return albums.filter(album => (
    searching || (album.album_folder_id ?? 0) === folderID
  ))
}

export function mediaAlbumFolderCanDelete(
  folders: readonly MediaAlbumFolder[],
  albums: readonly MediaAlbum[],
  folderID: number,
): boolean {
  if (!Number.isSafeInteger(folderID) || folderID <= 0) return false
  if (folders.some(folder => folder.parent_id === folderID)) return false
  return !albums.some(album => (album.album_folder_id ?? 0) === folderID)
}
