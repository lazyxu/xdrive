import type { Node } from '../models'
import type { XDriveFileRecentItem, XDriveFileFavoriteItem } from '../cloud-files'
import type { XDriveFileExplorerItem } from './FileExplorer'

/**
 * The same read-only Home recent/favorite node projection for Web/PWA and
 * Desktop/DSM. Only authenticated Host list results may be passed here.
 * This function cannot assert Server Owner access or open any native path.
 */
export function xDriveOverviewProjectFileItem(
  entry: XDriveFileRecentItem<Node> | XDriveFileFavoriteItem<Node>,
): XDriveFileExplorerItem {
  return {
    id: entry.node.id,
    name: entry.node.name,
    kind: entry.node.type === 'dir' ? 'dir' : 'file',
    size: entry.node.size,
    revision: entry.node.revision,
    updatedAt: entry.node.updated_at,
    path: entry.path.replace(/^\/+/, ''),
  }
}
