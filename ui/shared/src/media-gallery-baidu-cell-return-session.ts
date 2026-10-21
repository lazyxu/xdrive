import type { MediaBaiduNativeCellSelection } from './models'

/** W3b2a: bounded, ephemeral UI return state. This is NEVER an authorization
 * token, map SDK payload, persisted URL, Storage entry or replacement for
 * a freshly signed Owner /cells and /cell-items request. */
export type XDriveBaiduCellReturnSort = Readonly<{
  by: 'captured' | 'added'
  dir: 'asc' | 'desc'
}>
export interface XDriveBaiduCellReturnSnapshot {
  selection: MediaBaiduNativeCellSelection
  sort: XDriveBaiduCellReturnSort
  anchorNodeID?: number
  anchorIndex?: number
}

export const XDRIVE_BAIDU_CELL_RETURN_TTL_MS = 10 * 60 * 1000
const maxOwnerSessions = 8
const sessions = new Map<string, { snapshot: XDriveBaiduCellReturnSnapshot; seen: number }>()

function validScope(scope: string): boolean {
  return typeof scope === 'string' && scope.length > 0 && scope.length <= 1024
}
function positiveID(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function validReturn(snapshot: XDriveBaiduCellReturnSnapshot): boolean {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.sort ||
      (snapshot.sort.by !== 'captured' && snapshot.sort.by !== 'added') ||
      (snapshot.sort.dir !== 'asc' && snapshot.sort.dir !== 'desc')) return false
  const cell = snapshot.selection
  const bounds = cell?.bounds
  if (!cell || !bounds || bounds.coordinate_space !== 'bd09ll' ||
      ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
      bounds.west < -180 || bounds.west > 180 || bounds.east < -180 ||
      bounds.east > 180 || bounds.south < -90 || bounds.north > 90 ||
      bounds.south >= bounds.north || bounds.west === bounds.east ||
      (bounds.west === 180 && bounds.east === -180) ||
      !Number.isSafeInteger(cell.cell_x) || cell.cell_x < 0 || cell.cell_x > 7 ||
      !Number.isSafeInteger(cell.cell_y) || cell.cell_y < 0 || cell.cell_y > 7 ||
      !positiveID(cell.asset_id) || !positiveID(cell.node_id) ||
      !positiveID(cell.node_revision) || !positiveID(cell.photo_count)) return false
  return (snapshot.anchorNodeID === undefined || positiveID(snapshot.anchorNodeID)) &&
    (snapshot.anchorIndex === undefined ||
      (Number.isSafeInteger(snapshot.anchorIndex) &&
        snapshot.anchorIndex >= 0 && snapshot.anchorIndex <= 10_000_000))
}

function clone(snapshot: XDriveBaiduCellReturnSnapshot): XDriveBaiduCellReturnSnapshot {
  const c = snapshot.selection
  const b = c.bounds
  return {
    selection: {
      cell_x: c.cell_x, cell_y: c.cell_y,
      asset_id: c.asset_id, node_id: c.node_id,
      node_revision: c.node_revision, photo_count: c.photo_count,
      bounds: { coordinate_space: 'bd09ll', west: b.west, south: b.south,
        east: b.east, north: b.north },
    },
    sort: { by: snapshot.sort.by, dir: snapshot.sort.dir },
    ...(snapshot.anchorNodeID !== undefined
      ? { anchorNodeID: snapshot.anchorNodeID } : {}),
    ...(snapshot.anchorIndex !== undefined
      ? { anchorIndex: snapshot.anchorIndex } : {}),
  }
}
function sweep(now: number): void {
  for (const [scope, entry] of sessions) {
    if (entry.seen > now || now - entry.seen >= XDRIVE_BAIDU_CELL_RETURN_TTL_MS) {
      sessions.delete(scope)
    }
  }
}

export function xDriveReadBaiduCellReturn(
  scope: string, now = Date.now(),
): XDriveBaiduCellReturnSnapshot | undefined {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0) return undefined
  sweep(now)
  const entry = sessions.get(scope)
  if (!entry || !validReturn(entry.snapshot)) return undefined
  sessions.delete(scope)
  sessions.set(scope, entry)
  return clone(entry.snapshot)
}

export function xDriveRememberBaiduCellReturn(
  scope: string, snapshot: XDriveBaiduCellReturnSnapshot, now = Date.now(),
): boolean {
  if (!validScope(scope) || !Number.isFinite(now) || now < 0 ||
      !validReturn(snapshot)) return false
  sweep(now)
  sessions.delete(scope)
  sessions.set(scope, { snapshot: clone(snapshot), seen: now })
  while (sessions.size > maxOwnerSessions) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}

/** Tiny logical anchor only; it does not preload, revalidate or expose media. */
export function xDriveRememberBaiduCellAnchor(
  scope: string, nodeID: number, index?: number, now = Date.now(),
): boolean {
  if (!positiveID(nodeID) ||
      (index !== undefined && (!Number.isSafeInteger(index) ||
        index < 0 || index > 10_000_000))) return false
  const current = xDriveReadBaiduCellReturn(scope, now)
  if (!current) return false
  return xDriveRememberBaiduCellReturn(scope, {
    ...current, anchorNodeID: nodeID,
    ...(index !== undefined ? { anchorIndex: index } : {}),
  }, now)
}

export function xDriveClearBaiduCellReturn(scope: string): void {
  if (validScope(scope)) sessions.delete(scope)
}

/** Call only AFTER xDriveSelectBaiduNativeCell has validated a fresh Owner
 * /cells page: equality is a visual selection hint, not data membership. */
export function xDriveBaiduCellReturnMatchesFreshSelection(
  remembered: MediaBaiduNativeCellSelection | undefined,
  fresh: MediaBaiduNativeCellSelection | null,
): boolean {
  if (!remembered || !fresh) return false
  const a = remembered.bounds, b = fresh.bounds
  return Boolean(a && b && a.coordinate_space === 'bd09ll' &&
    b.coordinate_space === 'bd09ll' &&
    a.west === b.west && a.south === b.south &&
    a.east === b.east && a.north === b.north &&
    remembered.cell_x === fresh.cell_x &&
    remembered.cell_y === fresh.cell_y &&
    remembered.asset_id === fresh.asset_id &&
    remembered.node_id === fresh.node_id &&
    remembered.node_revision === fresh.node_revision &&
    remembered.photo_count === fresh.photo_count)
}
