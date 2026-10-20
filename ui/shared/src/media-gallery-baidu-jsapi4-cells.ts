import type { MediaBaiduNativeCellsPage, MediaBaiduNativeViewportBounds } from './models'

export type XDriveBaiduNativePhotoCellsRequest = (
  bounds: MediaBaiduNativeViewportBounds, signal: AbortSignal,
) => Promise<MediaBaiduNativeCellsPage>
type Cell = MediaBaiduNativeCellsPage['cells'][number]
type Identity = { assetID: number; nodeID: number }
type Point = { lng: number; lat: number }
type Label = {
  setStyle(style: Record<string, string>): void
  addEventListener(name: 'click', fn: () => void): void
  removeEventListener(name: 'click', fn: () => void): void
}
type MapPort = {
  addOverlay(label: Label): void
  removeOverlay(label: Label): void
  centerAndZoom(point: Point, zoom: number): void
  getZoom(): number
}
type Namespace = {
  Point: new (lng: number, lat: number) => Point
  Label: new (text: string, opts: { position: Point }) => Label
}
const safeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const positive = (v: unknown): v is number => safeInt(v) && v > 0

/** A3c20: never display Server-supplied cell counts without checking all 64
 * representative/quantity pairs and BD09 Owner response framing. All 100k
 * locations stay on the Server. This validator does NOT authorize resources. */
export function xDriveValidBaiduNativeCellsPage(
  value: unknown, bounds: MediaBaiduNativeViewportBounds,
): value is MediaBaiduNativeCellsPage {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !bounds || bounds.coordinate_space !== 'bd09ll' ||
      ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
      bounds.west < -180 || bounds.west > 180 || bounds.east < -180 ||
      bounds.east > 180 || bounds.south < -90 || bounds.north > 90 ||
      bounds.south >= bounds.north || bounds.west === bounds.east ||
      (bounds.west === 180 && bounds.east === -180)) return false
  const p = value as Partial<MediaBaiduNativeCellsPage>
  const keys = ['coordinate_space','index_scope','grid_columns','grid_rows','total_count','cells']
  if (Object.keys(p).length !== keys.length || Object.keys(p).some(k => !keys.includes(k)) ||
      p.coordinate_space !== 'bd09ll' || p.index_scope !== 'explicit_opt_in_only' ||
      p.grid_columns !== 8 || p.grid_rows !== 8 || !safeInt(p.total_count) ||
      p.total_count < 0 || !Array.isArray(p.cells) || p.cells.length > 64) return false
  const width = bounds.east > bounds.west ? bounds.east - bounds.west :
    bounds.east + 360 - bounds.west
  const used = new Set<string>(), assets = new Set<number>(), nodes = new Set<number>()
  let total = 0
  for (const c of p.cells) {
    if (!c || typeof c !== 'object' || Array.isArray(c) ||
        (Object.keys(c).length !== 7 && Object.keys(c).length !== 8) ||
        Object.keys(c).some(k => !['cell_x','cell_y','photo_count','asset_id',
          'node_id','node_revision','latitude','longitude'].includes(k)) ||
        ('node_revision' in c && !positive(c.node_revision)) ||
        !safeInt(c.cell_x) || c.cell_x < 0 || c.cell_x >= 8 ||
        !safeInt(c.cell_y) || c.cell_y < 0 || c.cell_y >= 8 ||
        !positive(c.photo_count) || !positive(c.asset_id) || !positive(c.node_id) ||
        !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) ||
        Math.abs(c.latitude) > 85 || Math.abs(c.longitude) > 180 ||
        c.latitude < bounds.south || c.latitude > bounds.north) return false
    const offset = c.longitude >= bounds.west ? c.longitude - bounds.west :
      c.longitude + 360 - bounds.west
    if (offset < 0 || offset > width + 1e-9) return false
    // Recheck exact 8x8 placement of the genuine representative point:
    // a forged cell index must never misstate the position of a count bubble.
    const gridX = Math.min(7, Math.max(0, Math.floor(offset / (width / 8))))
    const gridY = Math.min(7, Math.max(0,
      Math.floor((c.latitude - bounds.south) / ((bounds.north - bounds.south) / 8))))
    if (gridX !== c.cell_x || gridY !== c.cell_y) return false
    const bin = c.cell_x + ':' + c.cell_y
    if (used.has(bin) || assets.has(c.asset_id) || nodes.has(c.node_id) ||
        total > Number.MAX_SAFE_INTEGER - c.photo_count) return false
    used.add(bin); assets.add(c.asset_id); nodes.add(c.node_id)
    total += c.photo_count
  }
  return total === p.total_count
}

/** Official JSAPI4 BMap.Label overlay at each ACTUAL authorized photo sample:
 * unlike a synthetic 64-feature ClusterLayer, the label text says the exact
 * Server COUNT for all current opted-in Owner photos in this cell. */
export class XDriveBaiduJSAPI4NativeCellOverlays {
  private readonly map: MapPort
  private readonly ns: Namespace
  private disposed = false
  private generation = 0
  private overlays: Array<{ label: Label; click: () => void }> = []
  private readonly committed = new Map<string, Cell>()
  constructor(map: unknown, ns: unknown, private readonly onOpenPhoto: (id: Identity) => void) {
    const m = map as Partial<MapPort> | null
    const n = ns as Partial<Namespace> | null
    if (!m || !n || typeof m.addOverlay !== 'function' ||
        typeof m.removeOverlay !== 'function' || typeof m.centerAndZoom !== 'function' ||
        typeof m.getZoom !== 'function' || typeof n.Point !== 'function' ||
        typeof n.Label !== 'function' || typeof onOpenPhoto !== 'function') {
      throw new Error('baidu_cells_runtime_unavailable')
    }
    this.map = m as MapPort
    this.ns = n as Namespace
  }
  clear() {
    this.generation++
    this.committed.clear()
    for (const {label, click} of this.overlays) {
      try { label.removeEventListener('click', click) } catch {}
      try { this.map.removeOverlay(label) } catch {}
    }
    this.overlays = []
  }
  /** A3h: confirm Owner cells for trusted React photo-cover pins WITHOUT
   * passing private thumbnail data, Blob URLs or HTML into provider Labels.
   * The existing focusCell still uses current revision-fenced committed IDs. */
  applyCovers(page: MediaBaiduNativeCellsPage, bounds: MediaBaiduNativeViewportBounds,
    signal: AbortSignal): boolean {
    this.clear()
    if (this.disposed || signal.aborted || !xDriveValidBaiduNativeCellsPage(page, bounds) ||
        page.cells.some(cell => !positive(cell.node_revision))) return false
    for (const cell of page.cells) {
      if (signal.aborted || this.disposed) { this.clear(); return false }
      this.committed.set(cell.cell_x + ':' + cell.cell_y, cell)
    }
    return true
  }

  apply(page: MediaBaiduNativeCellsPage, bounds: MediaBaiduNativeViewportBounds,
    signal: AbortSignal): boolean {
    this.clear()
    if (this.disposed || signal.aborted ||
        !xDriveValidBaiduNativeCellsPage(page, bounds) || page.total_count <= 100) return false
    const generation = this.generation
    try {
      for (const cell of page.cells) {
        if (signal.aborted || this.disposed || generation !== this.generation) throw Error('cancel')
        const point = new this.ns.Point(cell.longitude, cell.latitude)
        const label = new this.ns.Label(cell.photo_count.toLocaleString('zh-CN'),
          {position:point})
        label.setStyle({ color: '#fff', backgroundColor: '#287cf4',
          borderRadius:'18px', borderColor:'#fff', borderWidth:'2px',
          padding:'5px 9px', fontSize:'13px', fontWeight:'600',
          cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' })
        const click = () => { if (!this.disposed && generation === this.generation) {
          this.focusCell(cell)
        }}
        label.addEventListener('click', click)
        this.overlays.push({label,click})
        this.map.addOverlay(label)
        this.committed.set(cell.cell_x+':'+cell.cell_y, cell)
      }
      if (signal.aborted || generation !== this.generation) throw Error('cancel')
      return true
    } catch {
      this.clear()
      return false
    }
  }
  /** Same action for official map bubble and accessible external MUI button. */
  focusCell(cell: Cell): void {
    if (this.disposed) return
    const live = this.committed.get(cell.cell_x+':'+cell.cell_y)
    if (!live || live.asset_id !== cell.asset_id || live.node_id !== cell.node_id ||
        live.photo_count !== cell.photo_count ||
        live.node_revision !== cell.node_revision) return
    if (live.photo_count === 1) {
      // Existing Gallery Range/Viewer performs its own new Owner authorization.
      this.onOpenPhoto({assetID:live.asset_id,nodeID:live.node_id})
      return
    }
    try {
      const zoom = this.map.getZoom()
      if (!Number.isFinite(zoom) || zoom >= 21) return
      // Paired real BD09LL representative, NEVER a fabricated grid midpoint.
      this.map.centerAndZoom(new this.ns.Point(live.longitude,live.latitude),
        Math.min(21,Math.max(3,Math.floor(zoom)+2)))
    } catch { /* revoked or no longer interactive: remain fail-closed */ }
  }
  dispose() { if (!this.disposed) { this.disposed=true; this.clear() } }
}
