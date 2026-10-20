import { xDriveValidBaiduNativeCellsPage } from './media-gallery-baidu-jsapi4-cells'
import type {
  MediaBaiduNativeCellSelection, MediaBaiduNativeCellsPage,
  MediaBaiduNativeViewportBounds, MediaItemRange,
} from './models'

type Cell = MediaBaiduNativeCellsPage['cells'][number]
export type XDriveBaiduCellRangeSort = Readonly<{
  by: 'captured' | 'added'
  dir: 'asc' | 'desc'
  anchorNodeID?: number
}>

/** Only capture cells of the exact current Server /cells response; never
 * recalculate the range from a moved map, grid center or provider event. */
export function xDriveSelectBaiduNativeCell(
  page: MediaBaiduNativeCellsPage,
  bounds: MediaBaiduNativeViewportBounds,
  clicked: Cell,
): MediaBaiduNativeCellSelection | null {
  if (!clicked || !xDriveValidBaiduNativeCellsPage(page, bounds)) return null
  const source = page.cells.find(cell =>
    cell.cell_x === clicked.cell_x && cell.cell_y === clicked.cell_y)
  if (!source || source.asset_id !== clicked.asset_id ||
      source.node_id !== clicked.node_id ||
      source.node_revision !== clicked.node_revision ||
      source.photo_count !== clicked.photo_count ||
      !Number.isSafeInteger(source.node_revision) ||
      (source.node_revision ?? 0) <= 0) return null
  return {
    bounds: { ...bounds },
    cell_x: source.cell_x, cell_y: source.cell_y,
    asset_id: source.asset_id, node_id: source.node_id,
    node_revision: source.node_revision!, photo_count: source.photo_count,
  }
}

/** Strict fixed-shape query for signed Owner W1 /cell-items. Never a new
 * authority: the Server rejects stale/revoked claims even if URL is well-formed. */
export function xDriveBaiduNativeCellRangeParams(
  selection: MediaBaiduNativeCellSelection,
  limit: number,
  offset: number,
  sort: XDriveBaiduCellRangeSort,
): URLSearchParams | null {
  const b = selection?.bounds
  if (!b || b.coordinate_space !== 'bd09ll' ||
      ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
      b.west < -180 || b.west > 180 || b.east < -180 || b.east > 180 ||
      b.south < -90 || b.north > 90 || b.south >= b.north ||
      b.west === b.east || (b.west === 180 && b.east === -180) ||
      !Number.isSafeInteger(selection.cell_x) ||
      selection.cell_x < 0 || selection.cell_x > 7 ||
      !Number.isSafeInteger(selection.cell_y) ||
      selection.cell_y < 0 || selection.cell_y > 7 ||
      ![selection.asset_id, selection.node_id, selection.node_revision,
        selection.photo_count].every(n => Number.isSafeInteger(n) && n > 0) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000 ||
      !sort || (sort.by !== 'captured' && sort.by !== 'added') ||
      (sort.dir !== 'asc' && sort.dir !== 'desc') ||
      (sort.anchorNodeID !== undefined &&
        (!Number.isSafeInteger(sort.anchorNodeID) || sort.anchorNodeID <= 0))) {
    return null
  }
  const query = new URLSearchParams({
    west: String(b.west), south: String(b.south),
    east: String(b.east), north: String(b.north),
    cell_x: String(selection.cell_x), cell_y: String(selection.cell_y),
    asset_id: String(selection.asset_id), node_id: String(selection.node_id),
    node_revision: String(selection.node_revision),
    photo_count: String(selection.photo_count),
    limit: String(limit), offset: String(offset), range: 'true',
    sort_by: sort.by, sort_dir: sort.dir,
  })
  if (sort.anchorNodeID !== undefined)
    query.set('anchor_node_id', String(sort.anchorNodeID))
  return query
}

export function xDriveValidBaiduNativeCellRangePage(
  page: unknown, limit: number, offset: number,
): page is MediaItemRange {
  if (!page || typeof page !== 'object') return false
  const p = page as Partial<MediaItemRange>
  return Number.isSafeInteger(p.total_count) && (p.total_count ?? -1) >= 0 &&
    p.limit === limit && p.offset === offset && Array.isArray(p.items) &&
    p.items.length <= limit && p.items.length <= (p.total_count ?? -1) &&
    p.items.every(item => Number.isSafeInteger(item?.node?.id) &&
      item.node.id > 0)
}
