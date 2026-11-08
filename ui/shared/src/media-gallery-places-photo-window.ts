import type { MediaBaiduNativeCellSelection, MediaItem, MediaItemRange } from './models'
import { xDriveValidBaiduNativeCellRangePage } from './media-gallery-baidu-jsapi4-cell-range'
import {
  XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,
  XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT,
  xDrivePlacesCellAcceptsLogicalRangeCount,
} from './media-gallery-places-photo-drawer'

/** Resident pixels/identities are at most ten real signed pages, even when
 * a single Owner place has 100,000 photos. The logical depth is separate:
 * skipped/evicted rows are placeholders and must be re-read before activation.
 */
export const XDRIVE_PLACES_DRAWER_WINDOW_ITEM_LIMIT = XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT

export type XDrivePlacesPhotoWindow = Readonly<{
  start: number
  items: readonly MediaItem[]
  depth: number
  total: number
}>

export function xDrivePlacesPhotoWindowBound(window: XDrivePlacesPhotoWindow):
  XDrivePlacesPhotoWindow {
  const count = window.items.length
  const extra = Math.max(0, count - XDRIVE_PLACES_DRAWER_WINDOW_ITEM_LIMIT)
  const drop = extra > 0
    ? Math.min(count, Math.ceil(extra / XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT) *
        XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT) : 0
  return {
    start: window.start + drop,
    items: window.items.slice(drop),
    depth: window.depth,
    total: window.total,
  }
}

function acceptsPage(
  selection: MediaBaiduNativeCellSelection,
  window: XDrivePlacesPhotoWindow,
  page: MediaItemRange,
  offset: number,
): boolean {
  const limit = XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT
  if (!xDrivePlacesCellAcceptsLogicalRangeCount(selection, window.total) ||
      !Number.isSafeInteger(offset) || offset < 0 || offset >= window.total ||
      page?.total_count !== window.total ||
      !xDriveValidBaiduNativeCellRangePage(page, limit, offset) ||
      page.items.length !== Math.min(limit, window.total - offset)) return false

  const ids = new Set<number>()
  return page.items.every(item => {
    const id = item.node.id
    const revision = item.node.revision
    if (!Number.isSafeInteger(revision) || revision <= 0 || ids.has(id)) return false
    ids.add(id)
    return true
  })
}

/** Explicit next cursor. Never infer it from the bounded resident item count.
 * A far-back viewport may be resident while new records are read after depth.
 */
export function xDrivePlacesPhotoWindowAppend(
  selection: MediaBaiduNativeCellSelection,
  window: XDrivePlacesPhotoWindow,
  page: MediaItemRange,
): XDrivePlacesPhotoWindow | null {
  const offset = window.depth
  if (!acceptsPage(selection, window, page, offset)) return null
  const residentEnd = window.start + window.items.length
  // When a user revisits an old page and then asks for new media, only a newly
  // verified signed range may become visible; never retain a gap's stale IDs.
  const contiguous = offset === residentEnd
  const oldItems = contiguous ? window.items : []
  const seen = new Set(oldItems.map(item => item.node.id))
  if (page.items.some(item => seen.has(item.node.id))) return null
  return xDrivePlacesPhotoWindowBound({
    start: contiguous ? window.start : offset,
    items: [...oldItems, ...page.items],
    depth: offset + page.items.length,
    total: window.total,
  })
}

/** Rehydrate any logical page requested by Gallery's real virtual viewport.
 * The first signed /cell-items Range establishes the exact authorized total.
 * A direct seek never pretends that intervening pages were visited: depth
 * remains the length of the contiguous prefix starting at zero. All newly
 * returned identities still pass the signed Owner/Node/revision verifier.
 */
export function xDrivePlacesPhotoWindowRehydrate(
  selection: MediaBaiduNativeCellSelection,
  window: XDrivePlacesPhotoWindow,
  page: MediaItemRange,
): XDrivePlacesPhotoWindow | null {
  const offset = page?.offset
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      offset >= window.total ||
      !acceptsPage(selection, window, page, offset)) return null
  const currentEnd = window.start + window.items.length
  if (offset >= window.start && offset + page.items.length <= currentEnd) {
    const existing = window.items.slice(offset - window.start,
      offset - window.start + page.items.length)
    if (existing.length !== page.items.length ||
        existing.some((x, i) =>
          x.node.id !== page.items[i].node.id ||
          x.node.revision !== page.items[i].node.revision)) return null
    return window
  }
  // A newly visited adjacent prefix page may advance the sequential cursor,
  // while a deep random seek must NOT mark thousands of skipped rows visited.
  if (offset === window.depth) {
    return xDrivePlacesPhotoWindowAppend(selection, window, page)
  }
  // Adjacent windows keep continuity and permit normal reversible scrolling.
  if (offset + page.items.length === window.start) {
    if (page.items.some(item => window.items.some(old =>
      old.node.id === item.node.id))) return null
    const combined = [...page.items, ...window.items]
    return { start: offset,
      items: combined.slice(0, XDRIVE_PLACES_DRAWER_WINDOW_ITEM_LIMIT),
      depth: window.depth, total: window.total }
  }
  if (offset === currentEnd) {
    if (page.items.some(item => window.items.some(old =>
      old.node.id === item.node.id))) return null
    return xDrivePlacesPhotoWindowBound({
      start: window.start, items: [...window.items, ...page.items],
      depth: window.depth, total: window.total,
    })
  }
  // A nonadjacent seek keeps only this freshly authenticated signed page.
  // Earlier positions remain virtual placeholders until explicitly read.
  return { start: offset, items: [...page.items],
    depth: window.depth, total: window.total }
}

export function xDrivePlacesPhotoWindowMissingOffset(
  window: XDrivePlacesPhotoWindow,
  start: number,
  end: number,
): number | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end >= window.total ||
      window.items.length < 1 || window.total <= 0) return null
  const residentEnd = window.start + window.items.length
  if (start < window.start) {
    return Math.floor(start / XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT) *
      XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT
  }
  // A first-time far scroll, Viewer return or resize can land thousands of
  // pages ahead of the contiguous prefix. Use the FIRST signed total for the
  // full virtual range and seek the visible page directly; do not fabricate
  // cached identities or issue thousands of intervening requests.
  if (start >= residentEnd) {
    return Math.floor(start / XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT) *
      XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT
  }
  if (end >= residentEnd && residentEnd < window.total) {
    return Math.floor(residentEnd / XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT) *
      XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT
  }
  return null
}
