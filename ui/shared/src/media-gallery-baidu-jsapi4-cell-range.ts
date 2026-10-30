import { xDriveValidBaiduNativeCellsPage } from './media-gallery-baidu-jsapi4-cells'
import { xDriveBaiduNativeCellsFilterParams } from './media-gallery-baidu-jsapi4-viewport-range'
import type {
  MediaBaiduNativeCellSelection, MediaBaiduNativeCellsPage,
  MediaBaiduNativeViewportBounds, MediaGalleryQuery, MediaItemRange,
} from './models'

type Cell = MediaBaiduNativeCellsPage['cells'][number]
export type XDriveBaiduCellRangeSort = Readonly<{
  by: 'captured' | 'added'
  dir: 'asc' | 'desc'
  anchorNodeID?: number
  filters?: MediaGalleryQuery
  albumKey?: string
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
    ...(page.grid_scheme ? {grid_scheme:page.grid_scheme} : {}),
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
      (selection.grid_scheme !== undefined &&
        selection.grid_scheme !== 'world_stable_v1') ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000 ||
      !sort || (sort.by !== 'captured' && sort.by !== 'added') ||
      (sort.dir !== 'asc' && sort.dir !== 'desc') ||
      (sort.anchorNodeID !== undefined &&
        (!Number.isSafeInteger(sort.anchorNodeID) || sort.anchorNodeID <= 0))) {
    return null
  }
  // Runtime-invalid input and conflicting map/wall sorts must fail closed.
  // Never drop unknown filters and silently return an unfiltered Cell.
  if (sort.filters !== undefined &&
      (!sort.filters || typeof sort.filters !== 'object' ||
        Array.isArray(sort.filters))) return null
  if ((sort.filters?.sort_by !== undefined && sort.filters.sort_by !== sort.by) ||
      (sort.filters?.sort_dir !== undefined && sort.filters.sort_dir !== sort.dir))
    return null
  const query = xDriveBaiduNativeCellsFilterParams(
    b, { ...sort.filters, sort_by: sort.by, sort_dir: sort.dir },
    sort.albumKey ?? '',
  )
  if (!query) return null
  for (const [key, value] of [
    ['cell_x', selection.cell_x], ['cell_y', selection.cell_y],
    ['asset_id', selection.asset_id], ['node_id', selection.node_id],
    ['node_revision', selection.node_revision],
    ['photo_count', selection.photo_count],
    ['limit', limit], ['offset', offset],
  ] as const) query.set(key, String(value))
  query.set('range', 'true')
  if (sort.anchorNodeID !== undefined)
    query.set('anchor_node_id', String(sort.anchorNodeID))
  return query
}

/** Validate a bounded, possibly sparse signed Owner Cell page before it
 * reaches Web/Desktop/Viewer adapters. The Gallery Drawer separately requires
 * a complete page, but this transport guard must reject overlaps, duplicates
 * and impossible anchors even for callers that do not open the Drawer. */
export function xDriveValidBaiduNativeCellRangePage(
  page: unknown, limit: number, offset: number,
): page is MediaItemRange {
  if (!page || typeof page !== 'object' || Array.isArray(page) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000) return false
  const p = page as Partial<MediaItemRange>
  if (!Number.isSafeInteger(p.total_count) || (p.total_count ?? -1) < 0 ||
      p.limit !== limit || p.offset !== offset || !Array.isArray(p.items) ||
      p.items.length > limit || offset + p.items.length > (p.total_count ?? -1) ||
      (p.anchor_index !== undefined &&
        (!Number.isSafeInteger(p.anchor_index) || p.anchor_index < 0 ||
          p.anchor_index >= (p.total_count ?? -1)))) return false
  const seen = new Set<number>()
  for (const item of p.items) {
    const id = item?.node?.id
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return false
    seen.add(id)
  }
  return true
}
