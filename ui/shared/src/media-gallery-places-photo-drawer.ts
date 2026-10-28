import type { MediaBaiduNativeCellSelection, MediaItemRange } from './models'
import { xDriveValidBaiduNativeCellRangePage } from './media-gallery-baidu-jsapi4-cell-range'
import { xDriveBaiduCellReturnMatchesFreshSelection } from './media-gallery-baidu-cell-return-session'
import {
  xDriveBaiduMapPhotoScopeKey, xDriveCopyBaiduMapPhotoScope,
} from './media-gallery-baidu-map-photo-scope'
import type { XDriveBaiduMapPhotoScope } from './media-gallery-baidu-map-photo-scope'

/** An Owner-authenticated Cell Range, NOT the anonymous SDK labels, owns the drawer. */
export const XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT = 48
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
  { expanded: true, scrollTop: 0, scrollLeft: 0 }

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

/** A Cell /cells photo_count counts authorised PhotoAssets. The existing
 * Gallery /cell-items Range can fold Live motion into a smaller logical set.
 * Match the existing Server cap, NEVER permit a wider Range or a zero result.
 * Identity/consent are still rechecked by the original signed Owner API. */
export function xDrivePlacesCellAcceptsLogicalRangeCount(
  selection: MediaBaiduNativeCellSelection, logicalCount: unknown,
): boolean {
  return validSelection(selection) && typeof logicalCount === 'number' &&
    Number.isSafeInteger(logicalCount) && logicalCount > 0 &&
    logicalCount <= selection.photo_count
}

/** The range must still represent the same signed Owner Cell count and real Nodes.
 * No fallback to a stale pin, a different album, or the user's full library. */
export function xDrivePlacesDrawerValidRange(
  selection: MediaBaiduNativeCellSelection,
  range: MediaItemRange,
  limit = XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,
): boolean {
  if (!xDrivePlacesCellAcceptsLogicalRangeCount(selection, range?.total_count) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !xDriveValidBaiduNativeCellRangePage(range, limit, 0) ||
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

/**
 * Rotation can change the signed viewport's eight-by-eight Cell geometry:
 * its bounds/index/count need NOT be identical. Restore only the SAME
 * representative PhotoAsset, Node and revision in a NEW authenticated
 * Owner /cells page with the identical album/filter scope.
 *
 * This predicate is a visual-intent match ONLY, never a media grant.
 * The caller still must use the fresh Cell selector for a new signed
 * /cell-items Range, whose count and Node revisions are checked separately.
 */
export function xDrivePlacesDrawerMatchesResizedCell(
  hint: XDrivePlacesDrawerReturn,
  currentScope: XDriveBaiduMapPhotoScope,
  fresh: MediaBaiduNativeCellSelection,
): boolean {
  if (!hint || !validSelection(hint.selection) || !validSelection(fresh) ||
      xDriveBaiduMapPhotoScopeKey(hint.photoScope) !==
        xDriveBaiduMapPhotoScopeKey(currentScope)) return false
  return hint.selection.node_id === fresh.node_id &&
    hint.selection.asset_id === fresh.asset_id &&
    hint.selection.node_revision === fresh.node_revision
}
