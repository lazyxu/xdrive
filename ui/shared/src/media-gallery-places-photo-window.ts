import type { MediaBaiduNativeCellSelection, MediaItem, MediaItemRange, MediaTimelineGroupSets, MediaTimelineGroupIndex } from './models'
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

/** Rehydrate an evicted page requested by Gallery's real virtual viewport.
 * Signed Owner/Node/revision validation happens on every request, and this
 * helper never changes the maximum visited depth or admits SDK-provided data.
 */
export function xDrivePlacesPhotoWindowRehydrate(
  selection: MediaBaiduNativeCellSelection,
  window: XDrivePlacesPhotoWindow,
  page: MediaItemRange,
): XDrivePlacesPhotoWindow | null {
  const offset = page?.offset
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      offset >= window.depth ||
      !acceptsPage(selection, window, page, offset)) return null
  // A rehydrated range may ONLY materialize previously visited rows.
  // A valid Owner-signed page at an unusual offset can otherwise straddle
  // depth and turn inert future placeholders into clickable identities.
  // Append (not rehydrate) is the only operation that advances depth.
  if (offset + page.items.length > window.depth) return null
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


/** Explicit first-time seek beyond the visited prefix. Preserve #4127:
 * rehydration must never materialize unvisited rows; a separate seek can
 * use a newly verified 48-item aligned signed Owner page. */
export function xDrivePlacesPhotoWindowSeek(
  selection: MediaBaiduNativeCellSelection,
  window: XDrivePlacesPhotoWindow,
  page: MediaItemRange,
): XDrivePlacesPhotoWindow | null {
  const offset = page?.offset
  if (!Number.isSafeInteger(offset) || offset < window.depth ||
      offset >= window.total ||
      offset % XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT !== 0 ||
      !acceptsPage(selection, window, page, offset)) return null
  if (offset === window.depth)
    return xDrivePlacesPhotoWindowAppend(selection, window, page)
  const residentEnd = window.start + window.items.length
  const duplicate = page.items.some(item => window.items.some(old =>
    old.node.id === item.node.id))
  if ((offset === residentEnd ||
       offset + page.items.length === window.start) && duplicate) return null
  if (offset === residentEnd) {
    return xDrivePlacesPhotoWindowBound({
      start: window.start, items: [...window.items, ...page.items],
      depth: window.depth, total: window.total,
    })
  }
  if (offset + page.items.length === window.start) {
    const combined = [...page.items, ...window.items]
    return { start: offset,
      items: combined.slice(0, XDRIVE_PLACES_DRAWER_WINDOW_ITEM_LIMIT),
      depth: window.depth, total: window.total }
  }
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
  // A fast scroll, calendar jump or Viewer return can land thousands of
  // already-visited pages ahead of a small rehydrated resident window.
  // Seek the *visible* signed page directly instead of issuing every
  // intervening 48-item /cell-items request.
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

/** Admit only a COMPLETE Owner-signed timeline index for this Cell. A 48-item
 * sparse page cannot be grouped by dates locally: it would fabricate the
 * missing date boundaries and could make a 100k location appear smaller.
 * This index is display-only and cannot authorize an unloaded photo.
 */
/** Old servers can omit the date index. Only infer it from a COMPLETE,
 * Owner-verified <=48-item page; never invent groups for a sparse 100k range.
 * Unknown dates are allowed at the beginning or end, not in the middle.
 */
export function xDrivePlacesPhotoLegacyCompleteTimeline(
  page: MediaItemRange,
): MediaTimelineGroupSets | null {
  if (page?.offset !== 0 || !Number.isSafeInteger(page.total_count) ||
      page.total_count < 1 || page.total_count > XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT ||
      !Array.isArray(page.items) || page.items.length !== page.total_count ||
      page.timeline_group_sets != null) return null
  const days = page.items.map(item => {
    const raw = item.metadata?.captured_at
    const matched = typeof raw === 'string'
      ? /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(raw) : null
    if (!matched) return 'unknown'
    const day = matched[1]
    const date = new Date(day + 'T00:00:00Z')
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === day ? day : 'unknown'
  })
  const known = days.filter(day => day !== 'unknown')
  const descending = known.length < 2 || known[0] >= known[known.length - 1]
  if (known.some((day, i) => i > 0 &&
    (descending ? day > known[i - 1] : day < known[i - 1]))) return null
  const seenKnown = days.map((v, i) => v === 'unknown' ? i : -1).filter(i => i >= 0)
  if (seenKnown.length && seenKnown.some((index, i) => i > 0 &&
    index !== seenKnown[i - 1] + 1)) return null
  const unknownFirst = seenKnown[0] ?? -1
  if (unknownFirst > 0 && unknownFirst + seenKnown.length < days.length) return null
  const output = {} as MediaTimelineGroupSets
  for (const scale of ['year', 'month', 'day'] as const) {
    const groups: MediaTimelineGroupIndex[] = []
    const keys = new Set<string>()
    for (let i = 0; i < days.length; i++) {
      const day = days[i]
      const key = day === 'unknown' ? day :
        scale === 'year' ? day.slice(0, 4) :
        scale === 'month' ? day.slice(0, 7) : day
      const last = groups[groups.length - 1]
      if (last?.key === key) last.item_count++
      else {
        if (keys.has(key)) return null
        keys.add(key)
        groups.push({key, item_count: 1, start_index: i})
      }
    }
    output[scale] = groups
  }
  return output
}

export function xDrivePlacesPhotoTimelineGroups(
  page: MediaItemRange,
): MediaTimelineGroupSets | null {
  if (page?.offset !== 0 || !Number.isSafeInteger(page.total_count) ||
      page.total_count < 1) return null
  if (page.timeline_group_sets == null) return xDrivePlacesPhotoLegacyCompleteTimeline(page)
  const input = page.timeline_group_sets
  const output = {} as MediaTimelineGroupSets
  const formats: ReadonlyArray<keyof MediaTimelineGroupSets> = ['year','month','day']
  for (const scale of formats) {
    const groups = input[scale]
    if (!Array.isArray(groups) || groups.length < 1 ||
        groups.length > page.total_count) return null
    const accepted: MediaTimelineGroupIndex[] = []
    let count = 0
    const datePattern = scale === 'year' ? /^\d{4}$/ :
      scale === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/
    for (const group of groups) {
      if (!group || typeof group.key !== 'string' ||
          !(group.key === 'unknown' || datePattern.test(group.key)) ||
          !Number.isSafeInteger(group.item_count) || group.item_count < 1 ||
          !Number.isSafeInteger(group.start_index) ||
          group.start_index !== count ||
          group.item_count > page.total_count - count) return null
      accepted.push({
        key: group.key, item_count: group.item_count,
        start_index: group.start_index,
      })
      count += group.item_count
    }
    if (count !== page.total_count) return null
    output[scale] = accepted
  }
  return output
}
