import type { XDriveTrustedProjectedMapCells } from './media-gallery-baidu-isolated-frame-host'
import type { MediaBaiduNativeCellSelection, MediaBaiduNativeCellsPage } from './models'

// The strip is a preview of up to TEN true Owner-verified spatial clusters,
// NEVER a substitute for the full sparse Media Range / virtual photo wall.
export const XDRIVE_PLACES_MAP_STRIP_MAX = 10

export function xDriveCurrentMapPhotoCollections(
  page: MediaBaiduNativeCellsPage | null,
  projected: XDriveTrustedProjectedMapCells<MediaBaiduNativeCellSelection> | null,
): ReadonlyArray<Readonly<{selection:MediaBaiduNativeCellSelection;count:number;x:number;y:number}>> {
  if (!page || !projected || page.coordinate_space !== 'bd09ll' ||
      page.index_scope !== 'explicit_opt_in_only' ||
      page.grid_columns !== 8 || page.grid_rows !== 8 ||
      !Array.isArray(page.cells) || page.cells.length > 64 ||
      !Number.isSafeInteger(page.total_count) || page.total_count < 0 ||
      !Number.isSafeInteger(projected.width) || projected.width < 1 || projected.width > 4096 ||
      !Number.isSafeInteger(projected.height) || projected.height < 1 || projected.height > 4096 ||
      !Array.isArray(projected.cells) || projected.cells.length > 64) return []

  // The Child's projected key/position is NOT media authority. Match every
  // representative to the Parent's current accepted /cells snapshot.
  const accepted = new Map<string,MediaBaiduNativeCellsPage['cells'][number]>()
  let total = 0
  for (const cell of page.cells) {
    if (!Number.isInteger(cell.cell_x) || cell.cell_x < 0 || cell.cell_x > 7 ||
        !Number.isInteger(cell.cell_y) || cell.cell_y < 0 || cell.cell_y > 7 ||
        !Number.isSafeInteger(cell.photo_count) || cell.photo_count <= 0 ||
        !Number.isSafeInteger(cell.asset_id) || cell.asset_id <= 0 ||
        !Number.isSafeInteger(cell.node_id) || cell.node_id <= 0 ||
        !Number.isSafeInteger(cell.node_revision) || (cell.node_revision ?? 0) <= 0)
      return []
    const key = cell.cell_x + ':' + cell.cell_y
    if (accepted.has(key)) return []
    accepted.set(key,cell)
    total += cell.photo_count
    if (!Number.isSafeInteger(total)) return []
  }
  if (total !== page.total_count) return []

  const candidates: Array<Readonly<{selection:MediaBaiduNativeCellSelection;count:number;x:number;y:number}>> = []
  const seen = new Set<string>()
  for (const pin of projected.cells) {
    const selection = pin.selection
    if (!selection || selection.bounds?.coordinate_space !== 'bd09ll' ||
        !Number.isSafeInteger(selection.cell_x) || !Number.isSafeInteger(selection.cell_y) ||
        !Number.isFinite(pin.x) || !Number.isFinite(pin.y) ||
        pin.x < 0 || pin.y < 0 || pin.x > projected.width || pin.y > projected.height) continue
    const key = selection.cell_x + ':' + selection.cell_y
    const cell = accepted.get(key)
    if (!cell || seen.has(key) ||
        selection.asset_id !== cell.asset_id || selection.node_id !== cell.node_id ||
        selection.node_revision !== cell.node_revision ||
        selection.photo_count !== cell.photo_count || pin.count !== cell.photo_count) continue
    seen.add(key)
    candidates.push(pin)
  }
  return candidates.sort((a,b) => b.count - a.count ||
    a.selection.cell_y-b.selection.cell_y || a.selection.cell_x-b.selection.cell_x)
    .slice(0,XDRIVE_PLACES_MAP_STRIP_MAX)
}
