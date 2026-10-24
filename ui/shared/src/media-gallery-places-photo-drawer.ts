import type { MediaBaiduNativeCellSelection, MediaItemRange } from './models'
import { xDriveValidBaiduNativeCellRangePage } from './media-gallery-baidu-jsapi4-cell-range'
import { xDriveBaiduCellReturnMatchesFreshSelection } from './media-gallery-baidu-cell-return-session'
import {
  xDriveBaiduMapPhotoScopeKey, xDriveCopyBaiduMapPhotoScope,
} from './media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from './media-gallery-baidu-map-photo-scope'

/** An Owner-authenticated Cell Range, NOT the anonymous SDK labels, owns the drawer. */
export const XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT = 12
export const XDRIVE_PLACES_DRAWER_RETURN_TTL_MS = 10 * 60 * 1000
const maxOwners = 8

export type XDrivePlacesDrawerPresentation = Readonly<{
  expanded: boolean
  scrollTop: number
  scrollLeft: number
}>

export type XDrivePlacesDrawerReturn = Readonly<{
  selection: MediaBaiduNativeCellSelection
  photoScope: XDriveBaiduMapPhotoScope
  presentation: XDrivePlacesDrawerPresentation
}>

const defaultPresentation: XDrivePlacesDrawerPresentation =
  { expanded: false, scrollTop: 0, scrollLeft: 0 }

function safePresentation(value?: XDrivePlacesDrawerPresentation):
  XDrivePlacesDrawerPresentation | null {
  if (value === undefined) return { ...defaultPresentation }
  if (!value || typeof value.expanded !== 'boolean' ||
      ![value.scrollTop, value.scrollLeft].every(n =>
        Number.isSafeInteger(n) && n >= 0 && n <= 10_000)) return null
  return { expanded: value.expanded, scrollTop: value.scrollTop,
    scrollLeft: value.scrollLeft }
}

const sessions = new Map<string, { snapshot: XDrivePlacesDrawerReturn; seen: number }>()

function validSelection(selection: MediaBaiduNativeCellSelection): boolean {
  const bounds = selection?.bounds
  return Boolean(bounds && bounds.coordinate_space === 'bd09ll' &&
    [bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) &&
    bounds.west >= -180 && bounds.west <= 180 &&
    bounds.east >= -180 && bounds.east <= 180 &&
    bounds.south >= -90 && bounds.north <= 90 && bounds.south < bounds.north &&
    bounds.west !== bounds.east && !(bounds.west === 180 && bounds.east === -180) &&
    Number.isInteger(selection.cell_x) && selection.cell_x >= 0 && selection.cell_x < 8 &&
    Number.isInteger(selection.cell_y) && selection.cell_y >= 0 && selection.cell_y < 8 &&
    [selection.asset_id, selection.node_id, selection.node_revision, selection.photo_count]
      .every(value => Number.isSafeInteger(value) && value > 0))
}

/** The range must still represent the same signed Owner Cell count and real Nodes.
 * No fallback to a stale pin, a different album, or the user's full library. */
export function xDrivePlacesDrawerValidRange(
  selection: MediaBaiduNativeCellSelection,
  range: MediaItemRange,
  limit = XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,
): boolean {
  if (!validSelection(selection) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !xDriveValidBaiduNativeCellRangePage(range, limit, 0) ||
      range.total_count !== selection.photo_count ||
      range.items.length < 1 ||
      range.items.length !== Math.min(limit, range.total_count)) return false
  const seen = new Set<number>()
  return range.items.every(item => {
    if (!Number.isSafeInteger(item?.node?.revision) || item.node.revision <= 0 ||
        seen.has(item.node.id)) return false
    seen.add(item.node.id)
    return true
  })
}

const cloneSelection = (s: MediaBaiduNativeCellSelection): MediaBaiduNativeCellSelection =>
  { const b = s.bounds
    return { ...s, bounds: { coordinate_space:'bd09ll', west:b.west, south:b.south,
      east:b.east, north:b.north } }
  }

function sweep(now: number): void {
  for (const [owner, entry] of sessions) {
    if (entry.seen > now || now - entry.seen >= XDRIVE_PLACES_DRAWER_RETURN_TTL_MS)
      sessions.delete(owner)
  }
}

/** Store only one ephemeral Viewer->Map visual intent per Owner, never media bytes.
 * The caller MUST obtain a fresh matching /cells snapshot before using it. */
export function xDriveRememberPlacesDrawerViewerReturn(
  owner: string, selection: MediaBaiduNativeCellSelection,
  photoScope: XDriveBaiduMapPhotoScope, now = Date.now(),
  presentation?: XDrivePlacesDrawerPresentation,
): boolean {
  const scope = xDriveCopyBaiduMapPhotoScope(photoScope)
  const safeView = safePresentation(presentation)
  if (!owner || owner.length > 1024 || !Number.isFinite(now) || now < 0 ||
      !validSelection(selection) || !scope || !safeView) return false
  sweep(now)
  sessions.delete(owner)
  sessions.set(owner, { snapshot: { selection: cloneSelection(selection), photoScope: scope,
    presentation: safeView }, seen: now })
  while (sessions.size > maxOwners) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  return true
}

/** One-shot hint. Never treat it as evidence of photo ownership or consent. */
export function xDriveTakePlacesDrawerViewerReturn(
  owner: string, now = Date.now(),
): XDrivePlacesDrawerReturn | undefined {
  if (!owner || owner.length > 1024 || !Number.isFinite(now) || now < 0) return
  sweep(now)
  const entry = sessions.get(owner)
  if (!entry) return
  sessions.delete(owner)
  const scope = xDriveCopyBaiduMapPhotoScope(entry.snapshot.photoScope)
  if (!scope || !validSelection(entry.snapshot.selection)) return
  const view = safePresentation(entry.snapshot.presentation)
  if (!view) return
  return { selection: cloneSelection(entry.snapshot.selection), photoScope: scope,
    presentation: view }
}

/** Explicitly leaving Places or selecting another Cell invalidates an unconsumed
 * Viewer return hint; no private media, bytes or GPS are persisted. */
export function xDriveClearPlacesDrawerViewerReturn(owner: string): void {
  if (owner && owner.length <= 1024) sessions.delete(owner)
}

/** Matching the selected identity is visual-only, NEVER a bypass around Owner Range. */
export function xDrivePlacesDrawerMatchesFresh(
  hint: XDrivePlacesDrawerReturn,
  currentScope: XDriveBaiduMapPhotoScope,
  fresh: MediaBaiduNativeCellSelection,
): boolean {
  return Boolean(hint && validSelection(hint.selection) && validSelection(fresh) &&
    xDriveBaiduMapPhotoScopeKey(hint.photoScope) ===
      xDriveBaiduMapPhotoScopeKey(currentScope) &&
    xDriveBaiduCellReturnMatchesFreshSelection(hint.selection, fresh))
}
