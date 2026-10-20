import type { MediaBaiduNativeCellsPage } from './models'

type Cell = MediaBaiduNativeCellsPage['cells'][number]
type Point = { lng: number; lat: number }
type Pixel = { x: number; y: number }
type NativeMap = { pointToPixel(point: Point): Pixel }
type NativeNamespace = { Point: new (lng: number, lat: number) => Point }

export type XDriveBaiduPhotoCoverPin = {
  key: string
  cell: Cell
  x: number
  y: number
}

/** Source-exact photo markers: no extra Owner endpoint, no image URL/HTML
 * passed to Baidu. The official pointToPixel projects ONLY already-approved
 * BD09LL representatives. Actual media bytes stay in the React Gallery pool. */
export const XDRIVE_BAIDU_PHOTO_COVER_MAX = 24
export const XDRIVE_BAIDU_PHOTO_COVER_MIN_SEPARATION = 58

export function xDriveProjectBaiduPhotoCoverPins(
  page: MediaBaiduNativeCellsPage,
  map: NativeMap,
  namespace: unknown,
  width: number,
  height: number,
): XDriveBaiduPhotoCoverPin[] | null {
  const native = namespace as Partial<NativeNamespace> | null
  if (!page || page.coordinate_space !== 'bd09ll' ||
      page.index_scope !== 'explicit_opt_in_only' ||
      !Array.isArray(page.cells) || page.cells.length > 64 ||
      !Number.isFinite(width) || !Number.isFinite(height) ||
      width < 120 || height < 120 ||
      !map || typeof map.pointToPixel !== 'function' ||
      !native || typeof native.Point !== 'function') return null

  // Missing revision means an older Server; it must fall back to the existing
  // numeric/ClusterLayer UI rather than use an unversioned private thumbnail.
  if (page.cells.some(cell => !cell || typeof cell.node_revision !== 'number' ||
      !Number.isSafeInteger(cell.node_revision) || cell.node_revision <= 0 ||
      !Number.isSafeInteger(cell.asset_id) || cell.asset_id <= 0 ||
      !Number.isSafeInteger(cell.node_id) || cell.node_id <= 0 ||
      !Number.isSafeInteger(cell.photo_count) || cell.photo_count <= 0 ||
      !Number.isFinite(cell.latitude) || Math.abs(cell.latitude) > 85 ||
      !Number.isFinite(cell.longitude) || Math.abs(cell.longitude) > 180)) return null

  // Highest true-count clusters win limited screen space, stable tie-break.
  // Suppressed collision cells remain accessible via the complete Owner
  // /cells summary, never described as "only N total photos".
  const ordered = [...page.cells].sort((a, b) =>
    b.photo_count - a.photo_count ||
    a.cell_y - b.cell_y || a.cell_x - b.cell_x)
  const pins: XDriveBaiduPhotoCoverPin[] = []
  for (const cell of ordered) {
    if (pins.length >= XDRIVE_BAIDU_PHOTO_COVER_MAX) break
    let pixel: Pixel
    try {
      pixel = map.pointToPixel(new native.Point(cell.longitude, cell.latitude))
    } catch { return null }
    if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return null
    // Cover badge is 56x62 CSS px and anchored above actual photo position.
    // Do not fabricate a second position by clamping a clipped GPS point.
    if (pixel.x < 30 || pixel.x > width - 30 ||
        pixel.y < 72 || pixel.y > height - 10) continue
    if (pins.some(pin => Math.hypot(pin.x - pixel.x, pin.y - pixel.y) <
        XDRIVE_BAIDU_PHOTO_COVER_MIN_SEPARATION)) continue
    pins.push({ key: cell.cell_x + ':' + cell.cell_y + ':' +
      cell.asset_id + ':' + cell.node_revision,
      cell, x: pixel.x, y: pixel.y })
  }
  return pins
}
